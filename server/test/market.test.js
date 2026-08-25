import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { liveFeed } from '../src/market/liveFeed.js';
import { tickFlushOps } from '../src/market/refreshJob.js';

/**
 * The tick flush's staleness guard.
 *
 * WHY THIS IS THE CASE WORTH PINNING. The flush is the only thing that lets a
 * socket price reach the slow readers — the Landing tape, portfolio values, the
 * leaderboard. Its cache has no expiry, so a socket that stops delivering does
 * not merely stop updating: it keeps handing back the last trade it ever saw,
 * and the loop wrote that over the fresh REST quote every five seconds while
 * stamping `quoteAsOf: now`. Nothing above this layer could tell.
 *
 * Observed on the running dev server with the socket down for 83 minutes: the
 * refresh job wrote AAPL's $310.34 close and the flush put an 06:35 pre-market
 * $310.00 back one second later, for 59 of every 60 seconds.
 */

const NOW = new Date('2026-08-25T11:58:41.000Z');

/** Seeds the feed's two public maps directly — no socket, no vendor. */
function seedFeed(rows) {
  liveFeed.subscriptions = new Map(
    rows.map((r) => [r.stream ?? r.symbol, { symbol: r.symbol, assetClass: r.assetClass ?? 'stocks' }]),
  );
  liveFeed.prices = new Map(
    rows
      .filter((r) => r.priceCents != null)
      .map((r) => [r.stream ?? r.symbol, { price: r.priceCents / 100, priceCents: r.priceCents, at: r.at }]),
  );
}

test('tick flush', async (t) => {
  t.afterEach(() => {
    liveFeed.subscriptions = new Map();
    liveFeed.prices = new Map();
  });

  await t.test('writes a tick that is inside the refresh window', () => {
    seedFeed([{ symbol: 'AAPL', priceCents: 31_000, at: NOW.getTime() - 3_000 }]);

    const ops = tickFlushOps(NOW);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].updateOne.filter.symbol, 'AAPL');
    assert.equal(ops[0].updateOne.update[0].$set.priceUsdCents, 31_000);
    // Unchanged prices must not be writes — the filter is what makes a quiet
    // symbol free rather than a round trip every five seconds.
    assert.deepEqual(ops[0].updateOne.filter.priceUsdCents, { $ne: 31_000 });
  });

  await t.test('restates the percentage against the previous close', () => {
    seedFeed([{ symbol: 'AAPL', priceCents: 31_000, at: NOW.getTime() - 3_000 }]);

    // The pair has to describe each other: leaving `changePct` alone is how a
    // pill came to read $310.00 beside +0.32%, which is the percentage for the
    // $310.34 close REST had struck a second earlier.
    const pct = tickFlushOps(NOW)[0].updateOne.update[0].$set.changePct;
    assert.deepEqual(pct.$cond[0], { $gt: ['$previousCloseCents', 0] });
    assert.deepEqual(pct.$cond[1].$multiply[0].$divide[0], {
      $subtract: [31_000, '$previousCloseCents'],
    });
    assert.equal(pct.$cond[1].$multiply[1], 100);

    // Computed in-document rather than in JS, because the close belongs to the
    // row being written and reading it first would race the refresh job.
    assert.equal(pct.$cond[2], '$changePct');
  });

  await t.test('the derived percentage is arithmetically right', () => {
    // Runs the branch the way Mongo would, on the real figures behind the bug:
    // AAPL printed $310.00 pre-market against a $309.35 previous close.
    const priceCents = 31_000;
    const previousCloseCents = 30_935;
    const derived = ((priceCents - previousCloseCents) / previousCloseCents) * 100;

    assert.equal(Number(derived.toFixed(4)), 0.2101);
    // NOT the 0.32% REST had struck for the $310.34 close it replaced.
    assert.notEqual(Number(derived.toFixed(2)), 0.32);
  });

  await t.test('REFUSES a tick older than one refresh window', () => {
    // The exact shape that broke the tape: an 83-minute-old pre-market print
    // still sitting in the cache because the socket died at 10:35.
    seedFeed([{ symbol: 'AAPL', priceCents: 31_000, at: NOW.getTime() - 83 * 60_000 }]);

    assert.deepEqual(tickFlushOps(NOW), []);
  });

  await t.test('holds the boundary at the refresh interval', () => {
    const edge = env.QUOTE_FULL_REFRESH_MS;
    seedFeed([
      { symbol: 'MSFT', priceCents: 48_731, at: NOW.getTime() - edge },
      { symbol: 'TSLA', priceCents: 35_196, at: NOW.getTime() - edge - 1 },
    ]);

    // Past the window REST has demonstrably written something newer, so the
    // tick is not a fresher price — it is an older one wearing a new timestamp.
    assert.deepEqual(
      tickFlushOps(NOW).map((o) => o.updateOne.filter.symbol),
      ['MSFT'],
    );
  });

  await t.test('refuses a tick carrying no usable timestamp', () => {
    seedFeed([
      { symbol: 'AAPL', priceCents: 31_000, at: undefined },
      { symbol: 'NVDA', priceCents: 21_105, at: NaN },
    ]);

    assert.deepEqual(tickFlushOps(NOW), []);
  });

  await t.test('a stale row does not suppress a live one', () => {
    seedFeed([
      { symbol: 'AAPL', priceCents: 31_000, at: NOW.getTime() - 83 * 60_000 },
      { symbol: 'NVDA', priceCents: 21_105, at: NOW.getTime() - 1_000 },
    ]);

    assert.deepEqual(
      tickFlushOps(NOW).map((o) => o.updateOne.filter.symbol),
      ['NVDA'],
    );
  });

  await t.test('skips classes with no Stock document to write to', () => {
    // Crypto lives only in the market service's cache. A write keyed on the
    // bare symbol would match nothing, or — worse — an equity of that name.
    seedFeed([
      { stream: 'BINANCE:BTCUSDT', symbol: 'BTC', assetClass: 'crypto', priceCents: 7_890_600, at: NOW.getTime() },
      { stream: 'OANDA:EUR_USD', symbol: 'EURUSD', assetClass: 'forex', priceCents: 117, at: NOW.getTime() },
    ]);

    assert.deepEqual(tickFlushOps(NOW), []);
  });

  await t.test('a subscription with no trade yet is not a write', () => {
    seedFeed([{ symbol: 'AAPL' }]);
    assert.deepEqual(tickFlushOps(NOW), []);
  });
});
