import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { ApiError } from '../lib/ApiError.js';
import { costCents, nanosToCents, quantizeQty, QTY_EPSILON } from '../lib/money.js';
import { Order } from '../models/Order.js';
import { Stock } from '../models/Stock.js';
import { User } from '../models/User.js';
import { Holding } from '../models/Holding.js';
import { Transaction } from '../models/Transaction.js';
import { invalidateLeaderboard } from './leaderboard.service.js';
import { findInstrument } from './market.service.js';

/**
 * Order execution — the ledger.
 *
 * THE ONE FAILURE MODE THAT CANNOT SHIP is cash debited without a holding
 * credited, or shares removed without cash returned. Two independent mechanisms
 * guard it, and the second is the one that actually holds:
 *
 *   1. A transaction wraps the whole path, so a mid-way crash rolls back.
 *   2. The balance check lives IN THE UPDATE FILTER, not in a preceding read.
 *
 * The second matters because a read-then-write is racy however carefully it is
 * written: two concurrent buys can both read a sufficient balance and both
 * proceed. `findOneAndUpdate({ cashBalanceCents: { $gte: total } }, { $inc: ... })`
 * is a single atomic operation — the loser matches no document and gets null,
 * which becomes a 422. That is race-safe on its own, transaction or not, which
 * is what keeps this correct on a standalone Mongo where `withTransaction`
 * degrades to a plain call.
 *
 * MARKET ORDERS ONLY for now. `Order` already models LIMIT and the sweeper that
 * fills them is described in the plan, but a limit order that never fills is a
 * worse first experience than not offering one.
 */

const TRADABLE_STATUS = new Set(['Listed']);

const ASSET_CLASSES = new Set(['stocks', 'crypto', 'forex']);

/**
 * Resolving the thing being traded, which is not one lookup any more.
 *
 * An equity has a `Stock` document, and that stays the source for it — its
 * status, its native currency and its seeded reference data all live there.
 * Crypto and forex have NO DOCUMENT AT ALL: their rows exist only in the market
 * service's vendor cache, which is also what the Markets table and the
 * watchlist read, so pricing a fill through it is what stops a fill disagreeing
 * with the row the user clicked.
 *
 * Both branches return the same shape, and `priceUsdNanos` is the field the
 * ledger actually multiplies. See lib/money.js for why it is not cents.
 */
async function resolveTradable(assetClass, symbol) {
  if (assetClass === 'stocks') {
    const stock = await Stock.findOne({ symbol }).lean();
    if (!stock) throw ApiError.notFound(`No stock ${symbol}`);
    if (!TRADABLE_STATUS.has(stock.status)) {
      throw ApiError.unprocessable(
        'NOT_TRADABLE',
        `${symbol} is ${stock.status} and cannot be traded`,
      );
    }
    return {
      symbol: stock.symbol,
      name: stock.name,
      currency: stock.currency,
      sector: stock.sector,
      exchange: stock.exchange,
      priceCents: stock.priceCents,
      priceUsdNanos: stock.priceUsdCents * 10_000_000,
    };
  }

  const row = await findInstrument(assetClass, symbol);
  if (!row) throw ApiError.notFound(`No ${assetClass} listing ${symbol}`);
  if (!TRADABLE_STATUS.has(row.status)) {
    throw ApiError.unprocessable('NOT_TRADABLE', `${symbol} cannot be traded`);
  }
  return {
    symbol: row.symbol,
    name: row.name,
    // A crypto row quotes in USD and an FX pair quotes in its own quote
    // currency, but both are PRICED in USD here — the ledger has one currency.
    currency: 'USD',
    sector: assetClass === 'crypto' ? 'Crypto' : 'Forex',
    exchange: row.exchange,
    // Native display price. For forex this is the rate scaled by 10,000, which
    // is why it is never used for arithmetic — see the note on the field.
    priceCents: row.priceCents,
    priceUsdNanos: row.priceUsdNanos,
  };
}

/**
 * Quantity rules, which differ by class because the markets do.
 *
 * Equities are whole units: the design has no fractional shares and no venue
 * here sells them. Crypto and forex must be fractional or they are unreachable
 * — one BTC is roughly eight times a starting account, so a whole-unit minimum
 * would render a Trade button that can never fill, which is the exact problem
 * this change exists to remove.
 */
function validateQuantity(assetClass, raw) {
  const quantity = assetClass === 'stocks' ? Number(raw) : quantizeQty(raw);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw ApiError.badRequest('BAD_QUANTITY', 'Quantity must be a positive number');
  }
  if (assetClass === 'stocks' && !Number.isInteger(quantity)) {
    throw ApiError.badRequest('BAD_QUANTITY', 'Quantity must be a whole number of shares');
  }
  if (assetClass !== 'stocks' && quantity < QTY_EPSILON) {
    throw ApiError.badRequest('BAD_QUANTITY', `Quantity must be at least ${QTY_EPSILON}`);
  }
  return quantity;
}

/**
 * How far the price may move between the quote the user saw and the fill.
 *
 * This is what makes the confirm step meaningful rather than decorative: the
 * modal shows a total, and if the market moves more than this before submit the
 * order is rejected with 409 PRICE_MOVED so the user re-confirms against a real
 * number instead of being filled at a price they never agreed to.
 */
const MAX_SLIPPAGE_PCT = env.MAX_SLIPPAGE_PCT ?? 0.5;

/**
 * @param {{ userId: any, assetClass?: string, symbol: string, side: string,
 *   quantity: number, quotedPriceUsdCents?: number, quotedPriceUsdNanos?: number,
 *   idempotencyKey?: string }} input
 */
export async function placeOrder(input) {
  const assetClass = String(input.assetClass ?? 'stocks').toLowerCase();
  const symbol = String(input.symbol ?? '').toUpperCase();
  const side = String(input.side ?? '').toUpperCase();

  if (!ASSET_CLASSES.has(assetClass)) {
    throw ApiError.badRequest('BAD_ASSET_CLASS', `Unknown asset class ${input.assetClass}`);
  }
  if (side !== 'BUY' && side !== 'SELL') {
    throw ApiError.badRequest('BAD_SIDE', 'Side must be BUY or SELL');
  }

  const quantity = validateQuantity(assetClass, input.quantity);
  const instrument = await resolveTradable(assetClass, symbol);

  const fillPriceUsdNanos = instrument.priceUsdNanos;
  if (!Number.isFinite(fillPriceUsdNanos) || fillPriceUsdNanos <= 0) {
    throw ApiError.unavailable('NO_QUOTE', `No usable price for ${symbol} right now`);
  }
  // Rounded, for the receipt and for the slippage comparison below — the
  // client only ever saw a cents figure, so that is what it can be held to.
  const fillPriceUsdCents = nanosToCents(fillPriceUsdNanos);

  // Slippage, measured against what the client was shown. Skipped when the
  // caller sends no quote — an API consumer that never saw a price cannot be
  // protected by one, and inventing a reference would be worse.
  // Nanos preferred, cents accepted. Comparing in cents is not merely coarser:
  // a coin quoting under a cent rounds to the same integer across a 40% move,
  // so the guard would wave through exactly the drift it exists to catch, while
  // a sub-dollar FX quote would trip it purely on rounding.
  const quotedNanos =
    Number.isFinite(input.quotedPriceUsdNanos) && input.quotedPriceUsdNanos > 0
      ? Number(input.quotedPriceUsdNanos)
      : Number.isFinite(input.quotedPriceUsdCents) && input.quotedPriceUsdCents > 0
        ? input.quotedPriceUsdCents * 10_000_000
        : null;

  if (quotedNanos) {
    const drift = (Math.abs(fillPriceUsdNanos - quotedNanos) / quotedNanos) * 100;
    if (drift > MAX_SLIPPAGE_PCT) {
      throw ApiError.conflict('PRICE_MOVED', `${symbol} moved ${drift.toFixed(2)}% — confirm again`, {
        quotedPriceUsdCents: input.quotedPriceUsdCents,
        currentPriceUsdCents: fillPriceUsdCents,
        currentPriceUsdNanos: fillPriceUsdNanos,
      });
    }
  }

  // THE ONE ROUNDING IN A FILL. quantity may be fractional and the price is in
  // billionths, so this is the single point where the trade becomes an integer
  // number of cents — every balance it touches downstream is already exact.
  const totalCents = costCents(quantity, fillPriceUsdNanos);
  if (totalCents <= 0) {
    throw ApiError.badRequest('BAD_QUANTITY', `${quantity} ${symbol} rounds to nothing`);
  }

  /**
   * INSERT FIRST — the unique partial index on `idempotencyKey` IS the lock.
   * A retried submit collides here (E11000) before any money moves, and the
   * original order is returned instead of the balance being debited twice.
   */
  let order;
  try {
    order = await Order.create({
      userId: input.userId,
      assetClass,
      symbol,
      side,
      orderType: 'MARKET',
      quantity,
      status: 'PENDING',
      currency: instrument.currency,
      ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
    });
  } catch (err) {
    if (err?.code === 11000 && input.idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey }).lean();
      if (existing) return { order: existing, replayed: true };
    }
    throw err;
  }

  try {
    const args = {
      input, assetClass, instrument, order, quantity,
      fillPriceUsdCents, fillPriceUsdNanos, totalCents,
    };
    const result = await withTransaction(async (session) =>
      side === 'BUY' ? executeBuy({ ...args, session }) : executeSell({ ...args, session }),
    );

    // The board is memoised 60s and computed from holdings, so without this a
    // fill takes up to a minute to move the user's own rank.
    invalidateLeaderboard();
    return result;
  } catch (err) {
    // A rejected order is a record, not a disappearance — the user asked for
    // something and was refused, and the Wallet should be able to show that.
    await Order.updateOne(
      { _id: order._id },
      { $set: { status: 'REJECTED', rejectReason: err.code ?? err.message } },
    ).catch(() => {});
    throw err;
  }
}

async function executeBuy({ input, assetClass, instrument, order, quantity,
  fillPriceUsdCents, fillPriceUsdNanos, totalCents, session }) {
  // The guard is the FILTER. A concurrent buy that would overdraw matches no
  // document and returns null — no read-then-check window exists to lose.
  const user = await User.findOneAndUpdate(
    { _id: input.userId, cashBalanceCents: { $gte: totalCents } },
    { $inc: { cashBalanceCents: -totalCents } },
    { new: true, session },
  );

  if (!user) {
    throw ApiError.unprocessable(
      'INSUFFICIENT_FUNDS',
      `Not enough buying power for ${quantity} ${instrument.symbol}`,
    );
  }

  // Upsert with $inc on both fields. COST BASIS IS SUMMED, never averaged —
  // storing an average would round on every partial buy and drift the book
  // value away from what was actually paid. The average is a virtual.
  const holding = await Holding.findOneAndUpdate(
    { userId: input.userId, assetClass, symbol: instrument.symbol },
    { $inc: { shares: quantity, costBasisCents: totalCents } },
    { new: true, upsert: true, session, setDefaultsOnInsert: true },
  );

  return settle({ input, assetClass, instrument, order, quantity, fillPriceUsdCents,
    fillPriceUsdNanos, totalCents, session, user, holding, type: 'Buy', amountCents: -totalCents });
}

async function executeSell({ input, assetClass, instrument, order, quantity,
  fillPriceUsdCents, fillPriceUsdNanos, totalCents, session }) {
  // Same shape as the buy guard, on shares instead of cash: a concurrent sell
  // that would take the position negative matches nothing.
  const before = await Holding.findOneAndUpdate(
    { userId: input.userId, assetClass, symbol: instrument.symbol, shares: { $gte: quantity } },
    { $inc: { shares: -quantity } },
    { new: false, session },
  );

  if (!before) {
    throw ApiError.unprocessable(
      'INSUFFICIENT_SHARES',
      `You do not hold ${quantity} ${instrument.symbol}`,
    );
  }

  // Cost basis is relieved PROPORTIONALLY to the shares sold, so the remaining
  // basis still reflects what was paid for what is left. Taking it off at the
  // current price instead would silently book the gain into the basis.
  /**
   * DUST IS A CLOSE, not a remainder — and this is what fractional quantities
   * made necessary.
   *
   * `shares` is a float for crypto and forex, so a position built from three
   * buys of 0.1 holds 0.30000000000000004, and selling the 0.3 the screen
   * showed leaves 4e-17 of a coin behind. That residue is not a position: it is
   * a row that can never be closed, pollutes the donut and the positions count,
   * and shows the user a holding they cannot get rid of. Anything below one
   * unit of storage precision therefore closes the position and relieves the
   * WHOLE basis, so no cost is stranded either.
   */
  const remaining = before.shares - quantity;
  const closed = remaining < QTY_EPSILON;
  const basisOut = closed
    ? before.costBasisCents
    : Math.round((before.costBasisCents * quantity) / before.shares);

  let holding = null;
  if (closed) {
    // A zero-share row pollutes the donut and the positions count, so the
    // document goes rather than lingering at 0.
    await Holding.deleteOne({ _id: before._id }, { session });
  } else {
    holding = await Holding.findOneAndUpdate(
      { _id: before._id },
      { $inc: { costBasisCents: -basisOut } },
      { new: true, session },
    );
  }

  const user = await User.findOneAndUpdate(
    { _id: input.userId },
    { $inc: { cashBalanceCents: totalCents } },
    { new: true, session },
  );

  return settle({ input, assetClass, instrument, order, quantity, fillPriceUsdCents,
    fillPriceUsdNanos, totalCents, session, user, holding, type: 'Sell', amountCents: totalCents });
}

/**
 * Human-readable quantity. Equities are whole, so they print whole; a coin
 * prints what was actually traded with the trailing zeros trimmed, because
 * "0.50000000 BTC" is noise and "0.5 BTC" is the number the user typed.
 */
const formatQty = (quantity, assetClass) =>
  assetClass === 'stocks' ? String(quantity) : String(Number(quantity.toFixed(8)));

/**
 * Human-readable unit price, from NANOS rather than cents.
 *
 * Two decimals is right for a share and wrong for a coin quoting at $0.0051 —
 * printed from cents that receipt reads "@ $0.01", which is not the price the
 * trade was struck at. Below a dollar the precision follows the number.
 */
function formatUsd(nanos) {
  const usd = nanos / 1_000_000_000;
  if (usd >= 1) return usd.toFixed(2);
  // Enough places to keep four significant figures on a sub-dollar price,
  // capped at the eight the ledger stores.
  const places = Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(usd)) - 1));
  return usd.toFixed(places);
}

/** The half both sides share: mark the order filled and write the ledger row. */
async function settle({
  input, assetClass, instrument, order, quantity, fillPriceUsdCents, fillPriceUsdNanos,
  totalCents, session, user, holding, type, amountCents,
}) {
  const filledAt = new Date();

  const filled = await Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: {
        status: 'FILLED',
        // Native for the receipt, USD for the ledger — the same two-price rule
        // the rest of the product follows. They differ on a non-US listing.
        fillPriceCents: instrument.priceCents,
        fillPriceUsdCents,
        fillPriceUsdNanos,
        totalCents,
        currency: instrument.currency,
        filledAt,
      },
    },
    { new: true, session },
  );

  await Transaction.create(
    [
      {
        userId: input.userId,
        type,
        // The design's own wording: "12 AAPL @ $214.02" — and the same shape
        // holds for "0.5 BTC @ $78879.32" and "1000 EURUSD @ $1.1663".
        detail: `${formatQty(quantity, assetClass)} ${instrument.symbol} @ $${formatUsd(fillPriceUsdNanos)}`,
        amountCents,
        status: 'Filled',
        relatedOrderId: order._id,
      },
    ],
    { session },
  );

  await User.updateOne({ _id: input.userId }, { $inc: { tradeCount: 1 } }, { session });

  return {
    order: filled?.toJSON?.() ?? filled,
    // Returned so the UI updates the balance pill and the position without a
    // refetch — the two things that visibly changed.
    cashBalanceCents: user.cashBalanceCents,
    holding: holding
      ? {
          assetClass: holding.assetClass,
          symbol: holding.symbol,
          shares: holding.shares,
          costBasisCents: holding.costBasisCents,
          avgCostCents: holding.shares ? Math.round(holding.costBasisCents / holding.shares) : 0,
        }
      : null,
    replayed: false,
  };
}

/** Recent orders, newest first — the receipt list and the Wallet's order tab. */
export async function listOrders(userId, { limit = 25 } = {}) {
  const rows = await Order.find({ userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  return rows.map((o) => ({
    id: String(o._id),
    assetClass: o.assetClass ?? 'stocks',
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    quantity: o.quantity,
    status: o.status,
    rejectReason: o.rejectReason,
    fillPriceCents: o.fillPriceCents,
    fillPriceUsdCents: o.fillPriceUsdCents,
    fillPriceUsdNanos: o.fillPriceUsdNanos,
    totalCents: o.totalCents,
    currency: o.currency,
    filledAt: o.filledAt,
    createdAt: o.createdAt,
  }));
}

/** Test seam — mongoose keeps model state per connection, nothing to reset. */
export const __models = { Order, Holding, Transaction, User, mongoose };
