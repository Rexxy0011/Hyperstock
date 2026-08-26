import { env } from '../config/env.js';
import { NewsArticle } from '../models/NewsArticle.js';
import * as finnhub from '../market/news/finnhub.news.js';
import * as rss from '../market/news/rss.news.js';

/**
 * News, read through a cache the client never bypasses.
 *
 * THE CACHE IS THE QUOTA. Finnhub's free tier allows 60 calls a minute; a
 * single user reloading /news would spend that in under a minute if each page
 * load reached the vendor. So a feed is refreshed at most once per
 * NEWS_MIN_FETCH_MS regardless of how many people ask for it, and every
 * response is served out of Mongo.
 *
 * DEGRADATION LADDER, the same shape the price plan uses:
 *
 *   1. fresh cache          → serve it, no vendor call
 *   2. cold, provider ok    → fetch, upsert, serve
 *   3. provider throws      → fall through to the RSS adapter
 *   4. RSS throws too       → serve stale cache if there is any
 *   5. nothing anywhere     → empty list, degraded: true
 *
 * Steps 3 and 4 are why `degraded` and `source` are on the response: a thinner
 * feed is fine, a thinner feed that pretends to be the real one is not.
 */

/**
 * Per feed key: when it was last refreshed, and WHICH adapter answered.
 *
 * The source has to be remembered, not just the timestamp. Most responses are
 * cache hits that never enter refresh(), and if those reported the configured
 * provider rather than the one that actually supplied the rows, the page would
 * spend NEWS_MIN_FETCH_MS presenting fallback headlines as the real feed —
 * exactly what `degraded` exists to prevent.
 *
 * In-process rather than persisted: an empty collection is ambiguous between
 * "never fetched" and "the vendor genuinely had nothing", and losing this map
 * on restart costs one extra vendor call.
 */
const feedState = new Map();

/** Concurrent misses for the same key share one in-flight request. */
const inFlight = new Map();

/** The tabs on /news, and the only accepted values of `assetClass`. */
export const ASSET_CLASSES = ['stocks', 'crypto', 'forex', 'commodities'];

const keyFor = (assetClass, symbol) =>
  symbol ? `company:${symbol.toUpperCase()}` : `class:${assetClass}`;

const isFresh = (key) => Date.now() - (feedState.get(key)?.at ?? 0) < env.NEWS_MIN_FETCH_MS;

/**
 * Every provider that can serve a class, in priority order.
 *
 * MERGING IS PER CLASS, and that is a measured decision rather than a tidy
 * rule. For crypto it is a clear win: Finnhub is broad but nearly every image
 * it returns is a house logo, and CoinTelegraph and Decrypt illustrate every
 * item. Merging took that tab from 1 usable image to 12.
 *
 * For stocks the same merge made things worse. Nasdaq publishes no images on
 * any feed and posts more often than Finnhub, so with a straight
 * publishedAt sort its 15 items crowded out Finnhub's photographs and the tab
 * went from 6 distinct images to 1. So stocks takes Finnhub alone, with RSS
 * still behind it as a fallback if Finnhub fails.
 *
 * The `url` unique index makes any overlap between merged providers free.
 *
 * `finnhub.covers()` is the important part. Finnhub answers a request for a
 * category it does not have by silently returning `general` — measured:
 * `category=commodities` is byte-identical to `category=banana`, which is
 * byte-identical to `general`. Asking it for commodities would therefore put
 * equities news under the commodities tab and report it as a healthy fetch.
 * So the class has to be checked against a whitelist before the call.
 */
const AUGMENT = new Set(['crypto']);

function providersFor(assetClass) {
  if (env.NEWS_PROVIDER === 'none') return [];
  if (env.NEWS_PROVIDER === 'rss') return [rss];

  const finnhubCovers = finnhub.isConfigured() && finnhub.covers(assetClass);
  if (!finnhubCovers) return rss.covers(assetClass) ? [rss] : [];

  return AUGMENT.has(assetClass) && rss.covers(assetClass) ? [finnhub, rss] : [finnhub];
}

/**
 * Em and en dashes out of vendor prose, to the plain hyphen this product sets
 * its own copy in.
 *
 * IT LIVES HERE RATHER THAN IN THE ADAPTERS, which is a deliberate departure
 * from the rule that cleaning happens at the vendor boundary. That rule exists
 * so the cache holds clean records, and this runs immediately before the cache
 * write, so it still holds. What it buys is that no adapter can forget: there
 * are two today reaching four sites between them, and a third would otherwise
 * inherit the obligation silently.
 *
 * IT IS PUNCTUATION ONLY, AND ONLY IN THE TWO PROSE FIELDS. `url` is excluded
 * because a dash there is part of an address and rewriting it 404s the story;
 * `source` and `symbols` are names and tickers, not sentences. Headlines really
 * do carry these: a syndicated wire item reads "Fed holds rates — what it means
 * for markets", and the entity decoder in `rss.news.js` deliberately still
 * decodes `&mdash;` correctly, so both the entity and the literal land here.
 */
const PROSE_FIELDS = ['headline', 'summary'];

const plainDashes = (article) => {
  const out = { ...article };
  for (const f of PROSE_FIELDS) {
    if (typeof out[f] === 'string') {
      out[f] = out[f].replace(/\s*[—–]\s*/g, (m) => (/\s/.test(m) ? ' - ' : '-'));
    }
  }
  return out;
};

/**
 * Upsert on `url`. `$addToSet` on symbols rather than `$set`: the same story
 * arrives once from the general feed with no tickers and again from a company
 * feed with one, and the second write must not erase what the first learned.
 */
async function store(articles) {
  if (!articles.length) return;
  const expiresAt = new Date(Date.now() + env.NEWS_TTL_MS);

  await NewsArticle.bulkWrite(
    articles.map(plainDashes).map(({ symbols, ...a }) => ({
      updateOne: {
        filter: { url: a.url },
        update: {
          $set: { ...a, expiresAt },
          $addToSet: { symbols: { $each: symbols } },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

async function refresh(assetClass, symbol) {
  const providers = providersFor(assetClass);
  if (!providers.length) return { source: 'none', degraded: true };

  const fetchFrom = (p) => (symbol ? p.fetchCompany(symbol) : p.fetchCategory(assetClass));

  // allSettled, not all: a class reads up to three independent sites and one
  // being down should thin the tab, not empty it.
  const settled = await Promise.allSettled(providers.map(fetchFrom));

  const got = [];
  const contributors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) {
      got.push(...r.value);
      contributors.push(providers[i].name);
    } else if (r.status === 'rejected') {
      // Not console.error: a vendor being down is an expected operating state
      // here, not a fault in this process. It still has to be visible.
      console.warn(`news: ${providers[i].name} failed for ${assetClass} (${r.reason?.message})`);
    }
  });

  // Everything configured for this class failed. RSS is only tried here when
  // it was not already in the list — for stocks it is the fallback rather than
  // an augmenter, so it has not been called yet.
  if (!got.length) {
    if (!providers.includes(rss) && rss.covers(assetClass)) {
      try {
        const rescued = await fetchFrom(rss);
        if (rescued.length) {
          await store(rescued);
          return { source: rss.name, degraded: true };
        }
      } catch (err) {
        console.warn(`news: rss fallback failed for ${assetClass} (${err.message})`);
      }
    }
    return { source: 'cache', degraded: true };
  }

  await store(got);

  // Degraded means "you are not seeing what this class is supposed to show",
  // which is narrower than "not every provider answered". RSS carrying forex
  // and commodities alone is the design, not a fault, so it must not raise
  // the pill — but Finnhub dropping out of a class it covers must.
  const expected = providers.map((p) => p.name);
  const missing = expected.filter((n) => !contributors.includes(n));

  return {
    source: contributors.join('+'),
    degraded: missing.includes(finnhub.name),
  };
}

/**
 * @param {{ assetClass?: string, symbol?: string, limit?: number }} opts
 * @returns {Promise<{ items: any[], source: string, degraded: boolean, asOf: string }>}
 */
export async function getNews({ assetClass = 'stocks', symbol = '', limit = 24 } = {}) {
  const key = keyFor(assetClass, symbol);
  // Annotated because `refresh()` can also report 'cache', which is outside the
  // NEWS_PROVIDER enum this falls back to on the very first call.
  /** @type {{ source: string, degraded: boolean }} */
  let status = feedState.get(key) ?? { source: env.NEWS_PROVIDER, degraded: false };

  if (!isFresh(key)) {
    // Single-flight: /news fires one request but a stock page could fire
    // several, and without this each miss would spend a separate vendor call.
    if (!inFlight.has(key)) {
      inFlight.set(
        key,
        refresh(assetClass, symbol).finally(() => inFlight.delete(key)),
      );
    }
    status = await inFlight.get(key);

    // Recorded even when every provider failed, which makes this a crude
    // circuit breaker: a vendor that is down is not retried on every request
    // for the next NEWS_MIN_FETCH_MS, it is retried once.
    feedState.set(key, { ...status, at: Date.now() });
  }

  // A symbol query ignores the class: you asked for AAPL, not for equities.
  const filter = symbol ? { symbols: symbol.toUpperCase() } : { assetClass };
  const items = await NewsArticle.find(filter)
    .sort({ publishedAt: -1 })
    .limit(Math.min(60, Math.max(1, limit)))
    .lean();

  return {
    items: items.map((a) => ({
      id: String(a._id),
      source: a.source,
      sourceName: a.sourceName,
      assetClass: a.assetClass,
      symbols: a.symbols,
      headline: a.headline,
      summary: a.summary,
      url: a.url,
      imageUrl: a.imageUrl,
      publisher: a.publisher,
      publishedAt: a.publishedAt,
    })),
    source: status.source,
    // An empty list from a working provider is still a degraded page.
    degraded: status.degraded || items.length === 0,
    asOf: new Date().toISOString(),
  };
}

/** Test seam — resets the in-process fetch throttle. */
export function resetNewsCache() {
  feedState.clear();
  inFlight.clear();
}
