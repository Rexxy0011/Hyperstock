import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, isEphemeral, supportsTransactions } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { Holding } from '../src/models/Holding.js';
import { Order } from '../src/models/Order.js';
import { Stock } from '../src/models/Stock.js';
import { Transaction } from '../src/models/Transaction.js';
import { PortfolioSnapshot } from '../src/models/PortfolioSnapshot.js';

/** The design's headline portfolio figure, in cents. */
const TARGET_PORTFOLIO_VALUE_CENTS = 1_222_064;

test('data layer', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  /**
   * THIS SUITE DROPS EVERY COLLECTION on the next line, so it must never be
   * pointed at a database anyone cares about.
   *
   * That was theoretical while `MONGODB_URI` was always blank and `connectDb()`
   * always span up a throwaway in-memory server. It stopped being theoretical
   * the moment a persistent local MongoDB was configured: the test script reads
   * the same `.env` the dev server does, so `npm test` wiped the development
   * database — 209 users and 52 stocks — and the only symptom was a login that
   * suddenly failed.
   *
   * `npm test` now forces `MONGODB_URI=` to restore the in-memory path. This
   * assertion is the belt to that braces: it does not depend on shell syntax,
   * so an invocation that bypasses the npm script fails loudly here instead of
   * destroying data.
   */
  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });

  await t.test('the deployment supports transactions', () => {
    assert.equal(supportsTransactions, true, 'order ledger needs a replica set');
  });

  /**
   * The key includes the CLASS, and asserting that specifically matters.
   *
   * The predicate used to be `userId === 1 && symbol === 1`, which the compound
   * key still satisfies — so it would have gone on passing against the old
   * `{userId, symbol}` index this replaced. That index is not merely narrower:
   * left in place it refuses a second position in a symbol that legitimately
   * exists in two asset classes, and the failure surfaces as an E11000 on an
   * unrelated buy. `config/db.js` drops it at boot; this is what proves the
   * right one took its place.
   */
  await t.test('holdings are keyed by user, class and symbol', async () => {
    const idx = await Holding.collection.indexes();
    const compound = idx.find(
      (i) => i.key?.userId === 1 && i.key?.assetClass === 1 && i.key?.symbol === 1,
    );
    assert.ok(compound, 'missing {userId, assetClass, symbol} index');
    assert.equal(compound.unique, true, 'the position key must be unique');
    assert.ok(
      !idx.some((i) => i.name === 'userId_1_symbol_1'),
      'the superseded {userId, symbol} unique index is still present',
    );
  });

  await t.test('idempotencyKey index is unique and partial', async () => {
    const idx = await Order.collection.indexes();
    const key = idx.find((i) => i.key?.idempotencyKey === 1);
    assert.ok(key, 'missing idempotencyKey index');
    assert.equal(key.unique, true);
    assert.ok(key.partialFilterExpression, 'must be partial so null keys do not collide');
  });

  await t.test('snapshots are unique per user per day', async () => {
    const idx = await PortfolioSnapshot.collection.indexes();
    const compound = idx.find((i) => i.key?.userId === 1 && i.key?.date === -1);
    assert.ok(compound && compound.unique, 'missing unique {userId, date} index');
  });

  /* ---------------------------------------------------------------------
   * Money is integer cents everywhere. A float in any of these columns is a
   * ledger that will eventually disagree with itself, so assert the type, not
   * just the value.
   * ------------------------------------------------------------------- */
  await t.test('every persisted money field is an integer', async () => {
    const [users, holdings, txns, orders, stocks, snaps] = await Promise.all([
      User.find().lean(),
      Holding.find().lean(),
      Transaction.find().lean(),
      Order.find().lean(),
      Stock.find().lean(),
      PortfolioSnapshot.find().limit(500).lean(),
    ]);

    const bad = [];
    const check = (label, value) => {
      if (value !== undefined && value !== null && !Number.isInteger(value)) bad.push(`${label}=${value}`);
    };

    users.forEach((u) => check(`user.${u.username}.cashBalanceCents`, u.cashBalanceCents));
    holdings.forEach((h) => check(`holding.${h.symbol}.costBasisCents`, h.costBasisCents));
    txns.forEach((x) => check('txn.amountCents', x.amountCents));
    orders.forEach((o) => {
      check('order.fillPriceCents', o.fillPriceCents);
      check('order.fillPriceUsdCents', o.fillPriceUsdCents);
      check('order.totalCents', o.totalCents);
      check('order.limitPriceCents', o.limitPriceCents);
    });
    stocks.forEach((s) => {
      check(`stock.${s.symbol}.priceCents`, s.priceCents);
      check(`stock.${s.symbol}.priceUsdCents`, s.priceUsdCents);
    });
    snaps.forEach((s) => {
      check('snapshot.portfolioValueCents', s.portfolioValueCents);
      check('snapshot.cashBalanceCents', s.cashBalanceCents);
    });

    assert.deepEqual(bad, [], `non-integer money fields: ${bad.slice(0, 8).join(', ')}`);
  });

  await t.test("jd_trader's portfolio reconciles to the design's figure", async () => {
    const jd = await User.findOne({ username: 'jd_trader' }).lean();
    const holdings = await Holding.find({ userId: jd._id }).lean();
    const stocks = await Stock.find({ symbol: { $in: holdings.map((h) => h.symbol) } }).lean();
    const priceUsdCents = new Map(stocks.map((s) => [s.symbol, s.priceUsdCents]));

    const holdingsValueCents = holdings.reduce(
      (sum, h) => sum + h.shares * priceUsdCents.get(h.symbol),
      0,
    );
    const portfolioValueCents = jd.cashBalanceCents + holdingsValueCents;

    // Exact integer equality — no epsilon, which is the point of cents.
    assert.equal(portfolioValueCents, TARGET_PORTFOLIO_VALUE_CENTS);
    assert.equal(holdings.length, 5, 'design shows 5 positions');
    assert.equal(new Set(stocks.map((s) => s.exchange)).size, 4, 'design claims 4 exchanges');
  });

  await t.test('jd_trader ranks 128 by portfolio value', async () => {
    const [holdingsByUser, users] = await Promise.all([
      Holding.aggregate([
        { $lookup: { from: 'stocks', localField: 'symbol', foreignField: 'symbol', as: 's' } },
        { $unwind: '$s' },
        { $group: { _id: '$userId', v: { $sum: { $multiply: ['$shares', '$s.priceUsdCents'] } } } },
      ]),
      User.find({ role: 'user' }).lean(),
    ]);
    const held = new Map(holdingsByUser.map((h) => [String(h._id), h.v]));

    const ranked = users
      .map((u) => ({
        username: u.username,
        valueCents: u.cashBalanceCents + (held.get(String(u._id)) ?? 0),
      }))
      .sort((a, b) => b.valueCents - a.valueCents);

    assert.equal(ranked.findIndex((u) => u.username === 'jd_trader') + 1, 128);
    // The first entry in the seed's NAMED_TRADERS roster, which is seeded with
    // the highest portfolio value of the named accounts. Reordering that roster
    // means updating this string.
    assert.equal(ranked[0].username, 'denise_coates', 'the top named trader should lead');
  });

  await t.test('re-running the seed is idempotent', async () => {
    const before = await Promise.all([
      User.countDocuments(),
      Stock.countDocuments(),
      Holding.countDocuments(),
    ]);
    await runSeed({ fresh: false });
    const after = await Promise.all([
      User.countDocuments(),
      Stock.countDocuments(),
      Holding.countDocuments(),
    ]);
    assert.deepEqual(after, before, 'second seed run changed document counts');
  });

  await t.test('every stock has a USD price for portfolio math', async () => {
    const broken = await Stock.find({
      $or: [{ priceUsdCents: { $lte: 0 } }, { priceUsdCents: null }],
    }).lean();
    assert.equal(broken.length, 0, `stocks without priceUsdCents: ${broken.map((s) => s.symbol)}`);
  });

  await t.test('LSE prices are normalised out of pence', async () => {
    // AZN.L quotes in GBp (11606 = £116.06). A price above ~£1000 would mean
    // the pence normalisation was skipped.
    const azn = await Stock.findOne({ symbol: 'AZN' }).lean();
    assert.equal(azn.currency, 'GBP');
    assert.ok(azn.priceCents < 100_000, `AZN ${azn.priceCents}c looks like unconverted pence`);
  });

  await mongoose.connection.db.dropDatabase();
});
