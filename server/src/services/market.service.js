import { env } from '../config/env.js';
import { Stock } from '../models/Stock.js';
import { Exchange } from '../models/Exchange.js';
import { isOpen, minutesUntilOpen } from '../market/hours.js';
import { NANOS_PER_CENT } from '../lib/money.js';
import { MarketPrice } from '../models/MarketPrice.js';
import * as coingecko from '../market/providers/coingecko.provider.js';
import * as frankfurter from '../market/providers/frankfurter.provider.js';
import * as finnhubQuote from '../market/providers/finnhubQuote.provider.js';

/**
 * The Markets table, one asset class at a time.
 *
 * Three classes, three completely different situations, and pretending
 * otherwise is what would make this dishonest:
 *
 *   crypto   CoinGecko, keyless, live, one call for fifty rows
 *   forex    Frankfurter (ECB), keyless, DAILY reference rates — not a tick
 *   stocks   seeded rows, with live Finnhub quotes merged over the US subset
 *
 * The stocks case is the awkward one. Finnhub's free tier 403s every non-US
 * quote — verified against the live key with ASML.AS — and six of our eight
 * exchanges are non-US. So the equity rows come out of Mongo as before and
 * only the US ones are overwritten with a live price. Every row carries
 * `live: true|false` so the table can say which is which rather than
 * presenting a seeded number as a quote.
 */

export const ASSET_CLASSES = ['stocks', 'crypto', 'forex'];

/**
 * In-process, per class: `{ at, rows, degraded }`. Same reasoning as the news
 * cache — the client never reaches a vendor, and the floor between refreshes
 * is what keeps fifty users on one request.
 */
const cache = new Map();
const inFlight = new Map();

const isFresh = (key) => Date.now() - (cache.get(key)?.at ?? 0) < env.MARKET_MIN_FETCH_MS;

/**
 * Company logos, keyed by ticker. Keyless, and free.
 *
 * Finnhub carries a `logo` field on `/stock/profile2`, which is 403 on this
 * tier, so the logo comes from the ticker instead. Coverage measured across
 * every seeded symbol: 30 of 34 resolve, including the European ADR tickers
 * (ASML, SAP, AZN). The four that 404 are the numeric Asian listings, the
 * seeded fake `GME2`, and dotted tickers — hence the dot-to-dash rewrite,
 * which is what turns BRK.B into the BRK-B that actually exists.
 *
 * A miss needs no handling here: `Mark` falls back to the monogram on the
 * image's own error event, so an unknown ticker degrades to initials rather
 * than a broken frame.
 */
export const logoFor = (symbol) =>
  `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol.replace(/\./g, '-'))}`;

/** Equities: seeded rows, live quotes merged over whichever ones we can get. */
async function loadStocks() {
  // NOT sorted in the query, and that is the whole point. `Stock.marketCap` is
  // stored in the listing's OWN currency, so ordering on it in Mongo ranks by
  // the size of the number rather than the size of the company: Toyota's
  // 4.8e13 yen sorts above Apple's 3.54e12 dollars, and the "top stocks" table
  // opened on four Tokyo listings. The sort has to happen after conversion —
  // the same bug as printing ¥48T under a dollar sign, one layer up.
  const rows = await Stock.find().limit(200).lean();

  let quotes = new Map();
  try {
    quotes = await finnhubQuote.fetchQuotes(
      rows.map((s) => ({ symbol: s.symbol, exchange: s.exchange })),
    );
  } catch (err) {
    // A quote outage is not a table outage: the seeded prices still render.
    console.warn(`market: live quotes unavailable (${err.message})`);
  }

  return rows.map((s) => {
    const q = quotes.get(s.symbol);

    // Market cap is seeded in the stock's OWN currency — Toyota's is 4.8e13,
    // which is ¥48 trillion, not $48 trillion. Rendering it under a dollar
    // sign overstated it by about 150x and made the column meaningless for
    // comparison, which is the only thing a market-cap column is for.
    //
    // The seeded price pair is itself the FX rate, so no rate table is needed.
    // Deliberately the SEEDED pair and not the live one: a live quote replaces
    // priceUsdCents only, so using the updated value would drift the implied
    // rate every time the price moved.
    const fx = s.priceCents > 0 ? s.priceUsdCents / s.priceCents : 1;

    return {
      assetClass: 'stocks',
      symbol: s.symbol,
      name: s.name,
      exchange: s.exchange,
      sector: s.sector,
      currency: s.currency,
      logoUrl: logoFor(s.symbol),
      // Native price is display-only and stays as seeded; only the USD figure
      // is replaced, because that is the one everything else computes on.
      priceCents: q ? q.priceUsdCents : s.priceCents,
      priceUsdCents: q ? q.priceUsdCents : s.priceUsdCents,
      // Exact for an equity rather than merely precise: a stock is quoted in
      // cents, so the nanos figure is the cents figure with seven zeroes and
      // loses nothing. It exists so the ledger has ONE price field it can
      // trust across all three classes — see lib/money.js.
      priceUsdNanos: (q ? q.priceUsdCents : s.priceUsdCents) * NANOS_PER_CENT,
      changePct: q ? q.changePct : s.changePct,
      marketCap: Math.round((s.marketCap ?? 0) * fx),
      volume: s.volume ?? 0,
      status: s.status,
      live: Boolean(q),
    };
  });
}

/**
 * Copies the fetched prices into Mongo so the LEADERBOARD can reach them.
 *
 * Nothing user-facing reads this — every screen goes through the cache above,
 * which is fresher by definition. It exists solely because the board ranks all
 * traders in one aggregation and a `$lookup` cannot see an in-process Map. See
 * models/MarketPrice.js.
 *
 * Best-effort on purpose: a mirror write that fails must not take down the
 * Markets table it was riding along with. The consequence of a miss is a board
 * that is one refresh window stale, never a wrong price on a screen or a fill.
 */
async function mirrorPrices(assetClass, rows) {
  const ops = rows
    .filter((r) => Number.isFinite(r.priceUsdNanos) && r.priceUsdNanos > 0)
    .map((r) => ({
      updateOne: {
        filter: { assetClass, symbol: r.symbol },
        update: {
          $set: {
            name: r.name,
            exchange: r.exchange,
            priceUsdNanos: r.priceUsdNanos,
            changePct: r.changePct ?? 0,
          },
        },
        upsert: true,
      },
    }));

  if (ops.length === 0) return;
  try {
    await MarketPrice.bulkWrite(ops, { ordered: false });
  } catch (err) {
    console.warn(`market: price mirror for ${assetClass} failed (${err.message})`);
  }
}

/** Biggest company first, ties broken by ticker so the order is stable. */
const byMarketCap = (a, b) => b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol);

/**
 * Session state for the venues we quote live. Crypto never closes and forex is
 * a daily publication, so this is an equities-only concept — the client uses it
 * to explain why a "Live" table is not moving.
 */
async function equitySessions() {
  const venues = await Exchange.find({ code: { $in: ['NYSE', 'NASDAQ'] } }).lean();
  return venues.map((e) => ({
    code: e.code,
    open: isOpen(e),
    minutesUntilOpen: minutesUntilOpen(e),
    hours: `${e.openTime}-${e.closeTime} ${e.tzLabel}`,
  }));
}

async function load(assetClass) {
  if (assetClass === 'crypto') {
    const rows = await coingecko.fetchRows();
    await mirrorPrices(assetClass, rows);
    return { rows, degraded: false };
  }
  if (assetClass === 'forex') {
    const rows = await frankfurter.fetchRows();
    await mirrorPrices(assetClass, rows);
    return { rows, degraded: false };
  }

  const rows = (await loadStocks()).sort(byMarketCap);
  // Degraded when nothing at all came back live — the table is real, but every
  // price in it is a seeded one.
  return { rows, degraded: !rows.some((r) => r.live), sessions: await equitySessions() };
}

/**
 * @param {{ assetClass?: string, q?: string, limit?: number }} opts
 */
export async function getInstruments({ assetClass = 'stocks', q = '', limit = 100 } = {}) {
  if (!isFresh(assetClass)) {
    if (!inFlight.has(assetClass)) {
      inFlight.set(
        assetClass,
        load(assetClass)
          .then((r) => {
            cache.set(assetClass, { ...r, at: Date.now() });
            return r;
          })
          .catch((err) => {
            console.warn(`market: ${assetClass} refresh failed (${err.message})`);
            // Keep serving the last good rows rather than blanking the tab,
            // and record the attempt so a dead vendor is retried once per
            // window instead of on every request.
            const stale = cache.get(assetClass);
            cache.set(assetClass, { rows: stale?.rows ?? [], degraded: true, at: Date.now() });
            return cache.get(assetClass);
          })
          .finally(() => inFlight.delete(assetClass)),
      );
    }
    await inFlight.get(assetClass);
  }

  const entry = cache.get(assetClass) ?? { rows: [], degraded: true };
  const needle = q.trim().toLowerCase();
  const items = needle
    ? entry.rows.filter(
        (r) =>
          r.symbol.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
      )
    : entry.rows;

  return {
    items: items.slice(0, Math.min(250, Math.max(1, limit))),
    total: items.length,
    assetClass,
    degraded: entry.degraded || items.length === 0,
    // Surfaced so the page can say "ECB daily reference rates" rather than
    // implying forex ticks like the other two tabs.
    resolution: assetClass === 'forex' ? 'daily' : 'live',
    // Equities only. Absent for crypto (always open) and forex (daily).
    ...(entry.sessions && { sessions: entry.sessions }),
    asOf: new Date().toISOString(),
  };
}

/**
 * One instrument by class and symbol, off the same cache the tables read.
 *
 * The ledger needs this because crypto and forex have no document to look up:
 * their rows exist only in this service's vendor cache, so `Stock.findOne` —
 * which is how every equity order resolves its price — has nothing to answer
 * with. Going through the cache also means a fill cannot be priced differently
 * from the row the user clicked, which is the whole reason the watchlist
 * resolves through here too.
 */
export async function findInstrument(assetClass, symbol) {
  const { items } = await getInstruments({ assetClass, limit: 250 });
  const needle = String(symbol).toUpperCase();
  return items.find((i) => i.symbol.toUpperCase() === needle) ?? null;
}

/**
 * Test seam: put rows in the cache so nothing reaches a vendor.
 *
 * The order tests need crypto and forex prices, and those classes have no
 * document to seed — a row IS the cache entry. Priming it is the only way to
 * exercise the ledger's non-equity path without a network call, and a fixed
 * price is what makes an exact-cents assertion possible at all.
 */
export function primeMarketCache(assetClass, rows) {
  cache.set(assetClass, { rows, degraded: false, at: Date.now() });
}

/** Test seam. */
export function resetMarketCache() {
  cache.clear();
  inFlight.clear();
}
