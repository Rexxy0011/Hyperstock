import { env } from '../config/env.js';
import { Stock } from '../models/Stock.js';
import { invalidateLeaderboard } from '../services/leaderboard.service.js';
import * as finnhubQuote from './providers/finnhubQuote.provider.js';
import * as twelvedata from './providers/twelvedata.provider.js';
import { liveFeed } from './liveFeed.js';
import { getInstruments } from '../services/market.service.js';
import { PAIRS } from './providers/frankfurter.provider.js';

/**
 * The only thing in this process that writes a price.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Everything price-shaped in the product
 * reads `Stock` out of Mongo — the Landing ticker tape, portfolio values, every
 * holding's P&L, the leaderboard, the Top investors panel. Before this job
 * existed nothing ever wrote to those documents, so all of it rendered seeded
 * numbers frozen at boot: measured, 0 of 7 tape symbols moved in 75 seconds,
 * and they would not have moved in 75 days.
 *
 * US LISTINGS ONLY. Finnhub's free tier 403s every non-US quote, so six of the
 * eight exchanges keep their seeded prices. The gate is the VENUE and never
 * the ticker — a bare `AIR` resolves against US listings and returns AAR Corp,
 * which would be written onto the row named Airbus. See the provider.
 *
 * QUOTA. One call per symbol, ~16 symbols, once per QUOTE_FULL_REFRESH_MS
 * (60s) is ~16 calls a minute against a 60/minute key that the news service is
 * also spending. There is deliberately no faster "hot symbol" tier: at 15s the
 * seven tape symbols alone would add 28 calls a minute and put the two
 * consumers over budget together. The client polls every 15s regardless, so
 * the worst case is a price up to 60s old, which is what `quoteAsOf` records.
 */

let timer = null;
let running = false;

/** Cheap visibility for `GET /api/market/status` and for the boot log. */
export const stats = {
  startedAt: /** @type {Date | null} */ (null),
  lastRunAt: /** @type {Date | null} */ (null),
  lastError: /** @type {string | null} */ (null),
  symbols: 0,
  updated: 0,
  consecutiveFailures: 0,
};

/**
 * Open the breaker after three consecutive failures and stay shut for one
 * window. Without it a revoked key would spend the whole quota re-failing
 * every minute and take the news feed down with it.
 */
const MAX_FAILURES = 3;

export async function refreshQuotesOnce() {
  if (running) return stats;
  running = true;

  try {
    // Every listing, not just the US ones: Twelve Data covers the other six
    // exchanges when a key is present, and returns nothing when it is not.
    const listings = await Stock.find()
      .select('symbol exchange currency priceCents priceUsdCents')
      .lean();

    stats.symbols = listings.length;
    if (!listings.length) return stats;

    // Two vendors, two halves of the book, merged. allSettled because one
    // being down must thin the update rather than cancel it.
    const [us, intl] = await Promise.allSettled([
      finnhubQuote.fetchQuotes(listings),
      twelvedata.isConfigured() ? twelvedata.fetchQuotes(listings) : Promise.resolve(new Map()),
    ]);

    if (intl.status === 'rejected') {
      console.warn(`market: twelvedata failed (${intl.reason?.message})`);
    }

    const quotes = new Map(us.status === 'fulfilled' ? us.value : []);

    // Twelve Data returns a NATIVE price and no FX rate, so the USD figure is
    // derived from this listing's own seeded ratio — the same technique the
    // market service uses for market cap, and for the same reason: inventing a
    // per-symbol rate would drift the two prices apart.
    if (intl.status === 'fulfilled') {
      for (const [symbol, q] of intl.value) {
        const seed = listings.find((l) => l.symbol === symbol);
        const fx = seed && seed.priceCents > 0 ? seed.priceUsdCents / seed.priceCents : 1;
        quotes.set(symbol, {
          ...q,
          priceUsdCents: Math.round(q.priceCents * fx),
          openCents: 0,
          highCents: 0,
          lowCents: 0,
        });
      }
    }
    if (!quotes.size) {
      stats.consecutiveFailures += 1;
      stats.lastError = finnhubQuote.lastQuoteFailure() ?? 'no quotes returned';
      return stats;
    }

    const quotedAt = new Date();
    const ops = [...quotes].map(([symbol, q]) => ({
      updateOne: {
        filter: { symbol },
        update: {
          $set: {
            // US listings are USD, so the native and USD prices are the same
            // number. Writing both keeps the invariant that every Stock has a
            // native price for display and a USD one for arithmetic.
            // US listings are USD so the two are the same number; non-US ones
            // carry a real native price alongside the derived USD figure.
            priceCents: q.priceCents ?? q.priceUsdCents,
            priceUsdCents: q.priceUsdCents,
            changePct: q.changePct,
            // Only the US vendor supplies it, and only a real one is written:
            // the seeded figure is a year out (AAPL's read $227.97 against a
            // live prior close of $309.35), so deriving anything from it would
            // be worse than the staleness it was meant to fix.
            ...(q.previousCloseCents > 0 && { previousCloseCents: q.previousCloseCents }),
            ...(q.openCents > 0 && { dayOpenCents: q.openCents }),
            ...(q.highCents > 0 && { dayHighCents: q.highCents }),
            ...(q.lowCents > 0 && { dayLowCents: q.lowCents }),
            quoteAsOf: quotedAt,
          },
        },
      },
    }));

    await Stock.bulkWrite(ops, { ordered: false });

    // The board memoises 60s per period and is computed from these prices, so
    // without this a fill or a price move takes up to a minute to show.
    invalidateLeaderboard();

    stats.updated = ops.length;
    stats.lastRunAt = quotedAt;
    stats.lastError = null;
    stats.consecutiveFailures = 0;
  } catch (err) {
    stats.consecutiveFailures += 1;
    stats.lastError = err.message;
  } finally {
    running = false;
  }

  return stats;
}

/**
 * Starts the interval. Safe to call twice — the second call is a no-op rather
 * than a second timer, which is what nodemon reloads would otherwise create.
 *
 * NOT STARTED BY THE TESTS, and that is load-bearing. `test/seed.test.js`
 * asserts jd_trader's portfolio is exactly $12,220.64 and his rank exactly
 * 128, both computed from these prices. The tests import the seed and the
 * models directly and never boot `index.js`, so quotes stay seeded there and
 * those equalities hold.
 */
export function startQuoteRefresh() {
  if (timer) return false;
  if (!finnhubQuote.isConfigured()) return false;
  if (env.MARKET_DATA_PROVIDER === 'mock') return false;

  stats.startedAt = new Date();

  const tick = async () => {
    if (stats.consecutiveFailures >= MAX_FAILURES) {
      // One window off, then try again — this resets the counter so a
      // recovered vendor is picked back up rather than staying dark.
      stats.consecutiveFailures = 0;
      return;
    }
    await refreshQuotesOnce();
    await syncLiveSubscriptions().catch(() => {});
  };

  timer = setInterval(tick, env.QUOTE_FULL_REFRESH_MS);
  // Node keeps the process alive for a pending timer; this is background work
  // and must not be the reason a shutdown hangs.
  timer.unref?.();

  // Prime immediately so the first page load after boot is not a minute stale.
  void tick();
  return true;
}

/**
 * Finnhub caps one connection at 50 symbols and there are now three classes
 * competing for them: 52 equities, 50 crypto and 12 FX pairs. Everything does
 * not fit, so the split is explicit rather than emergent — a first-come loop
 * would have let the equity list silently starve forex the moment a stock was
 * added.
 *
 * Forex takes all 12 because the set is small, fixed, and the whole tab is
 * dead without it. Equities take the top 20 by market cap, which is the order
 * the table is sorted in, so the rows a visitor sees first are the live ones.
 * Crypto takes the remainder on the same principle.
 *
 * Rows outside the budget are not broken — they still carry a REST price from
 * their provider. They update on the minute rather than on the tick.
 */
const MAX_STREAMED = 50;
const STREAMED_STOCKS = 20;

/**
 * Points the socket at the instruments actually on screen.
 *
 * Re-run on the REST cycle rather than once at boot, because the crypto list is
 * ranked by market cap and its membership drifts — a coin that leaves the top
 * 30 should stop consuming one of the 50 subscription slots.
 */
export async function syncLiveSubscriptions() {
  // Sorted by market cap so the top of the table is what gets streamed. Sorting
  // in the query is safe here and not for the Markets service, because this
  // only ever looks at NYSE and NASDAQ — all USD, so the stored figure is
  // already comparable.
  const us = await Stock.find({ exchange: { $in: ['NYSE', 'NASDAQ'] } })
    .select('symbol')
    .sort({ marketCap: -1 })
    .limit(STREAMED_STOCKS)
    .lean();

  const forex = PAIRS.map((p) => ({
    symbol: `${p.base}${p.quote}`,
    assetClass: 'forex',
  }));

  let crypto = [];
  const remaining = Math.max(0, MAX_STREAMED - us.length - forex.length);
  try {
    if (remaining > 0) {
      const { items } = await getInstruments({ assetClass: 'crypto', limit: remaining });
      crypto = items.map((i) => ({ symbol: i.symbol, assetClass: 'crypto' }));
    }
  } catch {
    // The socket is worth having for equities and FX alone; a CoinGecko outage
    // must not cost us the other two streams.
  }

  liveFeed.setSubscriptions([
    ...us.map((s) => ({ symbol: s.symbol, assetClass: 'stocks' })),
    ...forex,
    ...crypto,
  ]);
}

let flushTimer = null;

/**
 * How old a trade may be and still be worth writing over the REST quote.
 *
 * A TICK MUST NEVER OUTLIVE THE REFRESH CYCLE THAT WOULD REPLACE IT. The cache
 * behind `priceFor()` holds the last trade seen for a symbol with no expiry, so
 * once the socket goes quiet — a closed session, a thin book, or a connection
 * that died — it keeps handing back the same number forever. This loop then
 * wrote that number over the fresh REST quote every five seconds and stamped
 * `quoteAsOf: now` on it, so the staleness was invisible at every layer above.
 *
 * Measured on the Landing tape with the socket down for 83 minutes: the refresh
 * job wrote AAPL's real close of $310.34 at 11:58:40.487 and this loop put an
 * 06:35 pre-market print of $310.00 back one second later, at 11:58:41.494. Over
 * 69 one-second samples the tape carried the vendor's price in exactly ONE of
 * them. Worse than the drift, the pill stopped reconciling with itself: the
 * percentage beside it still came from REST, so AAPL read $310.00 against
 * +0.32% when $310.00 is +0.21% on the same previous close.
 *
 * One refresh window is the threshold because that is the point at which REST
 * has demonstrably written something newer — past it, the tick is not a fresher
 * price, it is an older one wearing a new timestamp.
 */
const maxTickAgeMs = () => env.QUOTE_FULL_REFRESH_MS;

/**
 * The bulk ops one flush would write. Exported for the test — the guard above
 * is the whole point of this loop and a `setInterval` body cannot be asserted.
 *
 * @param {Date} now
 */
export function tickFlushOps(now) {
  const ops = [];

  for (const [, sub] of liveFeed.subscriptions) {
    if (sub.assetClass !== 'stocks') continue;
    const tick = liveFeed.priceFor(sub.symbol, sub.assetClass);
    if (!tick) continue;

    // `at` is the vendor's TRADE timestamp, not the moment we received it —
    // which is the one that says whether the market has moved since.
    if (!Number.isFinite(tick.at) || now.getTime() - tick.at > maxTickAgeMs()) continue;

    ops.push({
      updateOne: {
        filter: { symbol: sub.symbol, priceUsdCents: { $ne: tick.priceCents } },
        // AN AGGREGATION PIPELINE, because the new percentage depends on a
        // field of the document being written. A plain `$set` cannot read
        // `previousCloseCents`, and reading it first would be a second round
        // trip racing the refresh job for the same document.
        update: [
          {
            $set: {
              priceCents: tick.priceCents,
              priceUsdCents: tick.priceCents,
              // THE PRICE AND ITS PERCENTAGE MUST DESCRIBE EACH OTHER. The
              // socket moves the price every few seconds and REST restruck the
              // percentage once a minute, so a pill read $310.00 beside +0.32%
              // when $310.00 is +0.21% on the same previous close. Outside
              // regular hours it is worse than a lag: REST holds yesterday's
              // close all morning while the socket streams pre-market prints,
              // so the two never converge on their own.
              changePct: {
                $cond: [
                  { $gt: ['$previousCloseCents', 0] },
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: [tick.priceCents, '$previousCloseCents'] },
                          '$previousCloseCents',
                        ],
                      },
                      100,
                    ],
                  },
                  // No usable close — keep what REST struck rather than
                  // inventing a percentage against a seeded figure.
                  '$changePct',
                ],
              },
              quoteAsOf: now,
            },
          },
        ],
      },
    });
  }

  return ops;
}

/**
 * Writes streamed prices onto Stock documents.
 *
 * ON A TIMER, NOT PER TICK. Trades print several times a second; a write per
 * tick would be thousands of round trips a minute for a number the tape reads
 * once every few seconds. Browsers already have the tick over SSE, so this
 * exists only so the SLOW readers — portfolio value, the leaderboard, the
 * ticker tape's next request — are not a minute behind the socket.
 *
 * Equities only. Crypto lives in the market service's cache and has no Stock
 * document to write to.
 */
export function startTickFlush(intervalMs = 5000) {
  if (flushTimer) return;

  flushTimer = setInterval(async () => {
    const now = new Date();
    const ops = tickFlushOps(now);

    if (!ops.length) return;
    try {
      // The filter carries `$ne`, so an unchanged price is not a write at all.
      const result = await Stock.bulkWrite(ops, { ordered: false });
      if (result.modifiedCount) invalidateLeaderboard();
    } catch (err) {
      console.warn(`market: tick flush failed (${err.message})`);
    }
  }, intervalMs);

  flushTimer.unref?.();
}

export function stopTickFlush() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

export function stopQuoteRefresh() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
