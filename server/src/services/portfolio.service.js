import mongoose from 'mongoose';
import { Holding } from '../models/Holding.js';
import { LedgerEntry, LEDGER_TYPE } from '../models/LedgerEntry.js';
import { Stock } from '../models/Stock.js';
import { getInstruments, logoFor } from './market.service.js';
import { MarketPrice } from '../models/MarketPrice.js';
import { PortfolioSnapshot } from '../models/PortfolioSnapshot.js';
import { SEED_CASH_CENTS } from '../config/env.js';
import { avgCostCents, costCents, NANOS_PER_CENT, round2 } from '../lib/money.js';

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, ALL: 3650 };

/**
 * NET capital the user has put in: the opening grant, plus every deposit and
 * top-up, MINUS everything withdrawn. The denominator of the return, and the
 * line it is measured from.
 *
 * Withdrawals belong in the sum for the same reason deposits do, in the
 * opposite direction. Leaving them out would make taking money out look like
 * losing it: withdraw $1,000 and portfolio value drops by $1,000 against an
 * unchanged base, so the card reads −$1,000 of return on a payout the user
 * asked for. The entries are already signed — the hold is negative and its
 * reversal positive — so a plain `$sum` over all four types is the net figure
 * and a cancelled withdrawal contributes exactly zero.
 *
 * The grant is a constant rather than a ledger entry because neither the seed
 * nor signup posts an OPENING row — they write a `Transaction`, the display
 * record. `reconcile()`'s `openingCents` parameter exists for the same reason.
 *
 * ADJUSTMENT is deliberately excluded. Nothing posts one today, and when
 * something does it will be an operator correcting a mistake, which is not the
 * user contributing capital.
 */
const CONTRIBUTION_TYPES = [
  LEDGER_TYPE.DEPOSIT,
  LEDGER_TYPE.TOPUP,
  LEDGER_TYPE.WITHDRAWAL,
  LEDGER_TYPE.WITHDRAWAL_REVERSAL,
];

async function contributedCapitalCents(userId) {
  const [row] = await LedgerEntry.aggregate([
    { $match: { userId: toObjectId(userId), type: { $in: CONTRIBUTION_TYPES } } },
    { $group: { _id: null, totalCents: { $sum: '$amountCents' } } },
  ]);

  return SEED_CASH_CENTS + (row?.totalCents ?? 0);
}

/** `$match` needs a real ObjectId; callers pass one or its string form. */
const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

/**
 * Current price and identity for every held instrument, keyed `class:symbol`.
 *
 * TWO SOURCES, because there are two kinds of instrument. Equities are `Stock`
 * documents, which is where their sector and native currency live and what the
 * refresh job writes prices to. Crypto and forex have no document anywhere —
 * their rows exist only in the market service's vendor cache — so they resolve
 * through exactly the call the Markets table and the watchlist use, which is
 * what keeps a position's price from disagreeing with the same row one screen
 * over.
 *
 * The vendor lookup is ONE CALL PER DISTINCT CLASS, not per holding, and it is
 * skipped entirely when a portfolio holds only equities — which is every
 * portfolio that existed before this, including the seeded one the tests pin.
 */
async function priceHoldings(holdings) {
  const out = new Map();
  const classes = new Set(holdings.map((h) => h.assetClass ?? 'stocks'));

  if (classes.has('stocks')) {
    const symbols = holdings
      .filter((h) => (h.assetClass ?? 'stocks') === 'stocks')
      .map((h) => h.symbol);
    const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
    for (const s of stocks) {
      out.set(`stocks:${s.symbol}`, {
        name: s.name,
        exchange: s.exchange,
        sector: s.sector,
        currency: s.currency,
        // From the same builder `/markets` uses, so a holding cannot show a
        // different mark — or no mark — from the identical row one screen over.
        logoUrl: logoFor(s.symbol),
        priceCents: s.priceCents,
        priceUsdCents: s.priceUsdCents,
        priceUsdNanos: s.priceUsdCents * NANOS_PER_CENT,
        changePct: s.changePct,
      });
    }
  }

  for (const assetClass of ['crypto', 'forex']) {
    if (!classes.has(assetClass)) continue;
    const { items } = await getInstruments({ assetClass, limit: 250 });
    for (const r of items) {
      out.set(`${assetClass}:${r.symbol}`, {
        name: r.name,
        exchange: r.exchange,
        // Neither class has a sector, and the donut groups by one. Their own
        // name is the honest bucket — a coin is not "Technology".
        sector: assetClass === 'crypto' ? 'Crypto' : 'Forex',
        currency: 'USD',
        // CoinGecko ships one per coin; forex has none and falls to a monogram.
        logoUrl: r.logoUrl ?? '',
        priceCents: r.priceCents,
        priceUsdCents: r.priceUsdCents,
        priceUsdNanos: r.priceUsdNanos,
        changePct: r.changePct,
        resolved: true,
      });
    }
  }

  /**
   * LAST KNOWN PRICE, for anything the vendor no longer lists.
   *
   * A crypto row exists only inside CoinGecko's top 50 and that list changes,
   * so a coin can stop resolving while the user still owns it. `MarketPrice`
   * is the Mongo mirror the leaderboard aggregates against, and it doubles as
   * the last price we ever saw — better than the alternative, which was
   * dropping the position and quietly shrinking the portfolio by its value.
   */
  const unresolved = holdings.filter(
    (h) => (h.assetClass ?? 'stocks') !== 'stocks' && !out.has(`${h.assetClass}:${h.symbol}`),
  );

  if (unresolved.length > 0) {
    const rows = await MarketPrice.find({
      $or: unresolved.map((h) => ({ assetClass: h.assetClass, symbol: h.symbol })),
    }).lean();

    for (const r of rows) {
      out.set(`${r.assetClass}:${r.symbol}`, {
        name: r.name || r.symbol,
        exchange: r.exchange,
        sector: r.assetClass === 'crypto' ? 'Crypto' : 'Forex',
        currency: 'USD',
        // The mirror stores no logo, and only crypto and forex reach here, so
        // there is no ticker-derived URL to fall back on either. A monogram is
        // the honest answer for an instrument nothing can currently resolve.
        logoUrl: '',
        priceCents: Math.round(r.priceUsdNanos / NANOS_PER_CENT),
        priceUsdCents: Math.round(r.priceUsdNanos / NANOS_PER_CENT),
        priceUsdNanos: r.priceUsdNanos,
        // NOT `r.changePct`: that figure was current when it was mirrored and
        // says nothing about today. Zero is the honest answer for a price that
        // is no longer moving.
        changePct: 0,
        resolved: false,
      });
    }
  }

  return out;
}

/**
 * What a position is worth when nothing can price it: WHAT WAS PAID FOR IT.
 *
 * The alternatives are worse. Dropping it removes real money from the total.
 * Zero claims the holding became worthless, which is a much stronger statement
 * than "we lost the quote". Valuing at cost shows the position at its book
 * value with a return of exactly zero, and `resolved: false` lets the screen
 * say why rather than presenting it as a live figure.
 */
function atCostBasis(holding) {
  const assetClass = holding.assetClass ?? 'stocks';
  const perUnit = holding.shares ? Math.round(holding.costBasisCents / holding.shares) : 0;
  return {
    name: holding.symbol,
    exchange: '',
    sector: assetClass === 'crypto' ? 'Crypto' : assetClass === 'forex' ? 'Forex' : 'Other',
    currency: 'USD',
    // An equity mark is built from the ticker, so it survives the document
    // going missing — which is the one case that lands here for that class.
    logoUrl: assetClass === 'stocks' ? logoFor(holding.symbol) : '',
    priceCents: perUnit,
    priceUsdCents: perUnit,
    priceUsdNanos: perUnit * NANOS_PER_CENT,
    changePct: 0,
    resolved: false,
  };
}

/**
 * Everything the Portfolio dashboard renders, in one call.
 *
 * All arithmetic uses `priceUsdCents`, never `priceCents` — the latter is
 * native currency and would silently mix yen into a dollar total. Every
 * monetary value returned is integer cents; the client formats.
 */
export async function getPortfolio(userId, cashBalanceCents) {
  const holdings = await Holding.find({ userId }).lean();
  const priced = await priceHoldings(holdings);

  const positions = holdings
    .map((h) => {
      const assetClass = h.assetClass ?? 'stocks';
      // NEVER `return null` here. Dropping an unpriceable position removes real
      // money from `holdingsValueCents`, the allocation donut and the portfolio
      // total at once, with nothing on screen to say a holding went missing.
      const ref = priced.get(`${assetClass}:${h.symbol}`) ?? atCostBasis(h);

      // NANOS, not cents — a coin quoting under a cent would value an entire
      // position at zero if this multiplied the rounded figure. `costCents`
      // rounds once, at the end, exactly as a fill does.
      const marketValueCents = costCents(h.shares, ref.priceUsdNanos);
      const avgCost = avgCostCents(h.costBasisCents, h.shares);

      return {
        assetClass,
        symbol: h.symbol,
        name: ref.name,
        exchange: ref.exchange,
        sector: ref.sector,
        currency: ref.currency,
        logoUrl: ref.logoUrl ?? '',
        shares: h.shares,
        avgCostCents: avgCost,
        costBasisCents: h.costBasisCents,
        priceCents: ref.priceCents,
        priceUsdCents: ref.priceUsdCents,
        priceUsdNanos: ref.priceUsdNanos,
        changePct: round2(ref.changePct),
        // False when the figures above are a last-known price or the cost
        // basis rather than a live quote — the screen labels it.
        resolved: ref.resolved !== false,
        marketValueCents,
        totalReturnCents: marketValueCents - h.costBasisCents,
        totalReturnPct:
          h.costBasisCents > 0
            ? round2(((marketValueCents - h.costBasisCents) / h.costBasisCents) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.marketValueCents - a.marketValueCents);

  const holdingsValueCents = positions.reduce((sum, p) => sum + p.marketValueCents, 0);
  const portfolioValueCents = cashBalanceCents + holdingsValueCents;

  // Today's move is value-weighted, not a plain average: a 1% move on the
  // largest holding matters more than the same move on the smallest.
  const previousValueCents = positions.reduce(
    (sum, p) => sum + p.marketValueCents / (1 + p.changePct / 100),
    0,
  );
  const todayChangePct =
    previousValueCents > 0
      ? round2(((holdingsValueCents - previousValueCents) / previousValueCents) * 100)
      : 0;

  /**
   * RETURN IS MEASURED AGAINST WHAT WAS PUT IN, NOT AGAINST THE OPENING GRANT.
   *
   * This was `portfolioValueCents - SEED_CASH_CENTS`, which counts every
   * deposit as profit: fund the account with $1,000 and the card beside Buying
   * power reads "All-time return +$1,000 (+10%)" without a single trade having
   * happened. Paying money in is not performance, and the one screen where that
   * is unambiguous is the one that shows the deposit landing.
   *
   * So the base is the grant plus everything since contributed to it — which is
   * exactly what the ledger already records, and the reason top-ups had to stop
   * moving cash behind its back.
   */
  const investedCents = await contributedCapitalCents(userId);
  const allTimeReturnCents = portfolioValueCents - investedCents;

  return {
    summary: {
      portfolioValueCents,
      holdingsValueCents,
      buyingPowerCents: cashBalanceCents,
      // What was paid in, so a client can say "+$212 on $10,500 invested"
      // rather than leaving the reader to assume the base is the grant.
      investedCents,
      todayChangePct,
      allTimeReturnCents,
      allTimeReturnPct: investedCents > 0 ? round2((allTimeReturnCents / investedCents) * 100) : 0,
      positionsCount: positions.length,
      exchangeCount: new Set(positions.map((p) => p.exchange)).size,
    },
    holdings: positions,
    allocation: buildAllocation(positions, cashBalanceCents, portfolioValueCents),
  };
}

/** Sector weights plus a synthetic Cash slice — what the donut renders. */
function buildAllocation(positions, cashBalanceCents, portfolioValueCents) {
  const bySector = new Map();
  for (const p of positions) {
    bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + p.marketValueCents);
  }
  if (cashBalanceCents > 0) bySector.set('Cash', cashBalanceCents);

  return [...bySector.entries()]
    .map(([label, valueCents]) => ({
      label,
      valueCents,
      pct: portfolioValueCents > 0 ? round2((valueCents / portfolioValueCents) * 100) : 0,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
}

/** The performance chart series, read from the daily snapshot marks. */
export async function getPerformance(userId, range = '1M') {
  const days = RANGE_DAYS[range] ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await PortfolioSnapshot.find({ userId, date: { $gte: since } })
    .sort({ date: 1 })
    .lean();

  return {
    range,
    points: rows.map((r) => ({ t: r.date.getTime(), valueCents: r.portfolioValueCents })),
  };
}
