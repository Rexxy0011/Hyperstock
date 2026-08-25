import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import mongoose from 'mongoose';
import { Holding } from '../src/models/Holding.js';
import { Order } from '../src/models/Order.js';
import { placeOrder } from '../src/services/order.service.js';
import { primeMarketCache, resetMarketCache } from '../src/services/market.service.js';
import { getPortfolio } from '../src/services/portfolio.service.js';

/**
 * The ledger, across all three asset classes.
 *
 * Every case here is a defect that WOULD have shipped rather than a
 * hypothetical, and three of them are specifically about the fact that
 * `priceUsdCents` — exact for a share — is not a usable price for the other two
 * classes. See lib/money.js.
 *
 * The vendor rows are primed rather than fetched: crypto and forex have no
 * document to seed, a row IS the cache entry, and a fixed price is the only way
 * to assert an exact number of cents.
 */

/** $79,000 exactly, in billionths of a dollar. */
const BTC_NANOS = 79_000 * 1_000_000_000;
/** A coin quoting well UNDER one cent — the case cents cannot represent. */
const DUST_NANOS = 14_878_830; // $0.01487883
/** EURUSD. Note the cents field is the rate x 10^4, which is not a cent figure. */
const EUR_NANOS = 1_166_398_395; // $1.166398395

const CRYPTO_ROWS = [
  {
    assetClass: 'crypto', symbol: 'BTC', name: 'Bitcoin', exchange: 'Crypto', currency: 'USD',
    priceCents: 7_900_000, priceUsdCents: 7_900_000, priceUsdNanos: BTC_NANOS,
    changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
  },
  {
    assetClass: 'crypto', symbol: 'DUST', name: 'Dustcoin', exchange: 'Crypto', currency: 'USD',
    priceCents: 1, priceUsdCents: 1, priceUsdNanos: DUST_NANOS,
    changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
  },
];

const FOREX_ROWS = [
  {
    assetClass: 'forex', symbol: 'EURUSD', name: 'Euro / US Dollar', exchange: 'FX',
    currency: 'USD', rate: 1.166398395,
    // Deliberately the real shape: 10,000x the rate, NOT cents.
    priceCents: 11_664, priceUsdCents: 11_664, priceUsdNanos: EUR_NANOS,
    changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
  },
];

test('order ledger', async (t) => {
  await connectDb();
  t.after(async () => {
    resetMarketCache();
    await disconnectDb();
  });

  // Same guard as seed.test.js: the next line drops every collection.
  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });
  primeMarketCache('crypto', CRYPTO_ROWS);
  primeMarketCache('forex', FOREX_ROWS);

  const trader = await User.findOne({ username: 'jd_trader' }).lean();
  const userId = trader._id;
  const cashOf = async () => (await User.findById(userId).lean()).cashBalanceCents;
  const basisOf = async () =>
    (await Holding.find({ userId }).lean()).reduce((s, h) => s + h.costBasisCents, 0);

  /* ------------------------------------------------------------------ */

  await t.test('a fractional crypto buy moves cash into basis 1:1', async () => {
    const cash0 = await cashOf();
    const basis0 = await basisOf();

    const { order } = await placeOrder({
      userId, assetClass: 'crypto', symbol: 'BTC', side: 'BUY', quantity: 0.005,
      quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: 'test-btc-buy',
    });

    // 0.005 x $79,000 = $395.00 exactly.
    assert.equal(order.totalCents, 39_500);
    assert.equal(order.status, 'FILLED');
    assert.equal(order.assetClass, 'crypto');
    assert.equal(order.fillPriceUsdNanos, BTC_NANOS);

    // A BUY moves money from cash into basis 1:1 — the sum is conserved. It is
    // NOT conserved across a sell, which moves it by the realised P&L.
    assert.equal((await cashOf()) + (await basisOf()), cash0 + basis0);
    assert.equal(await cashOf(), cash0 - 39_500);
  });

  await t.test('the position is keyed by class, and holds a fractional quantity', async () => {
    const h = await Holding.findOne({ userId, assetClass: 'crypto', symbol: 'BTC' }).lean();
    assert.ok(h, 'crypto position not found under its own class');
    assert.equal(h.shares, 0.005);
    assert.equal(h.costBasisCents, 39_500);
    assert.ok(Number.isInteger(h.costBasisCents), 'basis must stay an integer number of cents');
  });

  /**
   * THE CASE CENTS CANNOT EXPRESS.
   *
   * `priceUsdCents` for this coin is 1. Priced off it, 10,000 units cost
   * $100.00; priced off the real quote they cost $148.79 — a 32.8% error, and
   * silently in the house's favour or the user's depending on the rounding.
   */
  await t.test('a sub-cent coin is priced from nanos, not from rounded cents', async () => {
    const { order } = await placeOrder({
      userId, assetClass: 'crypto', symbol: 'DUST', side: 'BUY', quantity: 10_000,
      quotedPriceUsdNanos: DUST_NANOS, idempotencyKey: 'test-dust-buy',
    });

    assert.equal(order.totalCents, 14_879);
    assert.notEqual(order.totalCents, 10_000 * 1, 'priced off the rounded cent figure');
  });

  /**
   * THE 100x TRAP. A forex row's `priceUsdCents` is the rate scaled by 10,000
   * so the shared table shape has something to hold. Multiplying by it prices
   * 1,000 EURUSD at $116,640 instead of $1,166.40.
   */
  await t.test('forex is priced from the rate, not from its scaled cents field', async () => {
    const { order } = await placeOrder({
      userId, assetClass: 'forex', symbol: 'EURUSD', side: 'BUY', quantity: 1_000,
      quotedPriceUsdNanos: EUR_NANOS, idempotencyKey: 'test-eur-buy',
    });

    assert.equal(order.totalCents, 116_640);
    assert.notEqual(order.totalCents, 1_000 * FOREX_ROWS[0].priceUsdCents);
  });

  /**
   * FLOAT DUST. `shares` is a float for these classes, so three buys of 0.1
   * store 0.30000000000000004 and selling the 0.3 the screen showed would
   * otherwise strand 4e-17 of a coin in a row the user can never close.
   */
  await t.test('selling the displayed quantity closes a float-dusted position', async () => {
    // Close the earlier position first, so this starts from nothing and the
    // legs below are the only thing in it.
    await placeOrder({
      userId, assetClass: 'crypto', symbol: 'BTC', side: 'SELL', quantity: 0.005,
      quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: 'test-dust-reset',
    });

    // 0.0001 x 3 is 0.00030000000000000003 in IEEE-754, which is the whole
    // point — and at $79,000 it is a leg the seeded account can actually fund.
    for (const i of [1, 2, 3]) {
      await placeOrder({
        userId, assetClass: 'crypto', symbol: 'BTC', side: 'BUY', quantity: 0.0001,
        quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: `test-dust-leg-${i}`,
      });
    }

    const before = await Holding.findOne({ userId, assetClass: 'crypto', symbol: 'BTC' }).lean();
    assert.notEqual(
      before.shares,
      0.0003,
      'expected float residue to exist for this test to mean anything',
    );

    // The user sells what the screen showed them, which is the rounded figure.
    await placeOrder({
      userId, assetClass: 'crypto', symbol: 'BTC', side: 'SELL', quantity: 0.0003,
      quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: 'test-dust-close',
    });

    const after = await Holding.findOne({ userId, assetClass: 'crypto', symbol: 'BTC' }).lean();
    assert.equal(after, null, 'a zero-ish position must be deleted, not left holding dust');
  });

  await t.test('equities are still whole units only', async () => {
    await assert.rejects(
      () =>
        placeOrder({
          userId, assetClass: 'stocks', symbol: 'AAPL', side: 'BUY', quantity: 0.5,
          idempotencyKey: 'test-fractional-equity',
        }),
      (err) => /** @type {any} */ (err).code === 'BAD_QUANTITY',
    );
  });

  await t.test('the balance guard still holds for a fractional buy', async () => {
    await assert.rejects(
      () =>
        placeOrder({
          userId, assetClass: 'crypto', symbol: 'BTC', side: 'BUY', quantity: 1_000,
          quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: 'test-overdraw',
        }),
      (err) => /** @type {any} */ (err).code === 'INSUFFICIENT_FUNDS',
    );
  });

  await t.test('a replayed idempotency key does not move money twice', async () => {
    const cash0 = await cashOf();
    const again = await placeOrder({
      userId, assetClass: 'crypto', symbol: 'DUST', side: 'BUY', quantity: 10_000,
      quotedPriceUsdNanos: DUST_NANOS, idempotencyKey: 'test-dust-buy',
    });

    assert.equal(again.replayed, true);
    assert.equal(await cashOf(), cash0, 'a replay must not debit again');
  });

  /**
   * The slippage guard has to compare in nanos too. EURUSD rounded to cents is
   * 117, which is already 0.32% off the real 1.1663 — most of the 0.5%
   * tolerance spent on rounding before the market has moved at all.
   */
  await t.test('slippage is measured against the nanos quote', async () => {
    await assert.rejects(
      () =>
        placeOrder({
          userId, assetClass: 'crypto', symbol: 'BTC', side: 'BUY', quantity: 0.001,
          // 2% below the real price — outside the 0.5% tolerance.
          quotedPriceUsdNanos: Math.round(BTC_NANOS * 0.98),
          idempotencyKey: 'test-slippage',
        }),
      (err) => /** @type {any} */ (err).code === 'PRICE_MOVED',
    );
  });

  await t.test('the portfolio values every class it holds', async () => {
    const cash = await cashOf();
    const p = await getPortfolio(userId, cash);

    const dust = p.holdings.find((h) => h.symbol === 'DUST');
    const eur = p.holdings.find((h) => h.symbol === 'EURUSD');

    assert.ok(dust, 'a crypto position must appear in the portfolio');
    assert.equal(dust.assetClass, 'crypto');
    assert.equal(dust.marketValueCents, 14_879, 'valued from nanos, not rounded cents');
    // No sector exists for either class, and the donut groups by one — their
    // own name is the honest bucket rather than an equity sector.
    assert.equal(dust.sector, 'Crypto');
    assert.ok(eur && eur.sector === 'Forex');

    // Every money field the portfolio returns is still an integer.
    for (const h of p.holdings) {
      for (const field of ['costBasisCents', 'marketValueCents', 'avgCostCents']) {
        assert.ok(Number.isInteger(h[field]), `${h.symbol}.${field} is not an integer`);
      }
    }
    assert.ok(Number.isInteger(p.summary.portfolioValueCents));
  });

  await t.test('the same symbol can be held in two classes at once', async () => {
    // The old {userId, symbol} unique index would refuse the second of these.
    primeMarketCache('crypto', [
      ...CRYPTO_ROWS,
      {
        assetClass: 'crypto', symbol: 'AAPL', name: 'Not Apple', exchange: 'Crypto',
        currency: 'USD', priceCents: 100, priceUsdCents: 100, priceUsdNanos: 1_000_000_000,
        changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
      },
    ]);

    await placeOrder({
      userId, assetClass: 'crypto', symbol: 'AAPL', side: 'BUY', quantity: 1,
      quotedPriceUsdNanos: 1_000_000_000, idempotencyKey: 'test-collide',
    });

    const rows = await Holding.find({ userId, symbol: 'AAPL' }).lean();
    assert.equal(rows.length, 2, 'a symbol in two classes must be two positions');
    assert.deepEqual(
      rows.map((r) => r.assetClass).sort(),
      ['crypto', 'stocks'],
    );
  });

  /**
   * THE MIGRATION GAP, PINNED. A Mongoose `default` applies on creation and
   * never to documents already stored, so a holding written before
   * `assetClass` existed indexes as `(userId, null, 'AAPL')` while a new buy
   * upserts on `(userId, 'stocks', 'AAPL')`. Different keys, no uniqueness
   * violation — and the account silently ends up with the same position split
   * in two. This happened on the development database.
   */
  await t.test('a buy adopts a legacy holding instead of splitting the position', async () => {
    const raw = mongoose.connection.collection('holdings');

    // A row exactly as it existed before the field was introduced.
    await Holding.deleteMany({ userId, symbol: 'MSFT' });
    await raw.insertOne({
      userId,
      symbol: 'MSFT',
      shares: 4,
      costBasisCents: 100_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { backfillAssetClass } = await import('../src/config/db.js');
    await backfillAssetClass();

    const rows = await Holding.find({ userId, symbol: 'MSFT' }).lean();
    assert.equal(rows.length, 1, 'the legacy row was not adopted');
    assert.equal(rows[0].assetClass, 'stocks');
    assert.equal(rows[0].shares, 4, 'shares changed during the backfill');
    assert.equal(rows[0].costBasisCents, 100_000, 'cost basis changed during the backfill');
  });

  await t.test('backfilling merges a position that was already split', async () => {
    const raw = mongoose.connection.collection('holdings');
    await Holding.deleteMany({ userId, symbol: 'NVDA' });

    // The two halves as the gap produced them: one legacy, one classed.
    await raw.insertOne({
      userId, symbol: 'NVDA', shares: 12, costBasisCents: 300_000,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await raw.insertOne({
      userId, assetClass: 'stocks', symbol: 'NVDA', shares: 7, costBasisCents: 200_000,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const { backfillAssetClass } = await import('../src/config/db.js');
    await backfillAssetClass();

    const rows = await Holding.find({ userId, symbol: 'NVDA' }).lean();
    assert.equal(rows.length, 1, 'the split position was not merged');
    // Both halves are money the user actually paid, so neither may be dropped.
    assert.equal(rows[0].shares, 19);
    assert.equal(rows[0].costBasisCents, 500_000);
  });

  await t.test('every order row carries an integer money field', async () => {
    const orders = await Order.find({ status: 'FILLED' }).lean();
    for (const o of orders) {
      for (const field of ['totalCents', 'fillPriceUsdCents']) {
        assert.ok(Number.isInteger(o[field]), `order ${o.symbol}.${field} is not an integer`);
      }
    }
  });
});

/**
 * The allocation donut and the summary have to agree with each other and with
 * the holdings they are built from — a slice that does not trace back to a
 * position is a chart that quietly lies about where the money is.
 */
test('portfolio allocation reconciles', async (t) => {
  const { connectDb: c2, disconnectDb: d2 } = await import('../src/config/db.js');
  await c2();
  t.after(async () => {
    resetMarketCache();
    await d2();
  });

  await runSeed({ fresh: true });
  primeMarketCache('crypto', CRYPTO_ROWS);
  primeMarketCache('forex', FOREX_ROWS);

  const trader = await User.findOne({ username: 'jd_trader' }).lean();
  const userId = trader._id;

  await placeOrder({
    userId, assetClass: 'crypto', symbol: 'BTC', side: 'BUY', quantity: 0.002,
    quotedPriceUsdNanos: BTC_NANOS, idempotencyKey: 'alloc-btc',
  });
  await placeOrder({
    userId, assetClass: 'forex', symbol: 'EURUSD', side: 'BUY', quantity: 500,
    quotedPriceUsdNanos: EUR_NANOS, idempotencyKey: 'alloc-eur',
  });

  const cash = (await User.findById(userId).lean()).cashBalanceCents;
  const p = await getPortfolio(userId, cash);

  await t.test('slices sum to the portfolio value', () => {
    const allocSum = p.allocation.reduce((a, x) => a + x.valueCents, 0);
    assert.equal(allocSum, p.summary.portfolioValueCents);
  });

  await t.test('holdings plus cash is the portfolio value', () => {
    const held = p.holdings.reduce((a, h) => a + h.marketValueCents, 0);
    assert.equal(held, p.summary.holdingsValueCents);
    assert.equal(held + p.summary.buyingPowerCents, p.summary.portfolioValueCents);
  });

  await t.test('the cash slice is exactly the buying power', () => {
    const slice = p.allocation.find((x) => x.label === 'Cash');
    assert.equal(slice.valueCents, p.summary.buyingPowerCents);
  });

  await t.test('crypto and forex get their own slices', () => {
    // Neither class has an equity sector, and the donut groups by one.
    assert.ok(p.allocation.find((x) => x.label === 'Crypto'));
    assert.ok(p.allocation.find((x) => x.label === 'Forex'));
  });

  await t.test('every slice traces back to positions of that sector', () => {
    for (const slice of p.allocation.filter((x) => x.label !== 'Cash')) {
      const fromPositions = p.holdings
        .filter((h) => h.sector === slice.label)
        .reduce((a, h) => a + h.marketValueCents, 0);
      assert.equal(slice.valueCents, fromPositions, `${slice.label} does not trace back`);
    }
  });

  /**
   * THE ONE THAT MATTERS. A crypto row exists only in the vendor's top-50 list,
   * and that list changes. If the instrument stops resolving, the position must
   * not silently vanish along with its value — the same reason `listWatchlist`
   * returns unresolved rows instead of dropping them.
   */
  await t.test('a position whose instrument stops resolving is still counted', () => {
    primeMarketCache('crypto', CRYPTO_ROWS.filter((r) => r.symbol !== 'BTC'));
    return getPortfolio(userId, cash).then((after) => {
      const btc = after.holdings.find((h) => h.symbol === 'BTC');
      assert.ok(btc, 'the position disappeared from the portfolio entirely');
      const held = after.holdings.reduce((a, h) => a + h.marketValueCents, 0);
      assert.equal(held + after.summary.buyingPowerCents, after.summary.portfolioValueCents);
    });
  });
});
