import { env } from '../../config/env.js';

/**
 * Finnhub news adapter — the primary provider.
 *
 * Chosen over Alpha Vantage, whose payload is richer (sentiment scores, per
 * ticker relevance) but whose free tier allows 25 requests a DAY. Finnhub
 * allows 60 a minute, which is the difference between "a stock page can fetch
 * news for whatever symbol you opened" and "one global feed and nothing else".
 *
 * WHAT IT ACTUALLY COVERS. Measured against a live key, not read from docs —
 * the docs page is JS-rendered and returns nothing to a fetch:
 *
 *   general   100 items, 100 with images   real
 *   crypto     94 items,  43 with images   real, zero overlap with general
 *   merger     55 items,  55 with images   real
 *   forex       1 item                     real but empty in practice
 *   anything   100 items                   NOT REAL — see below
 *
 * **Finnhub silently falls back to `general` for an unrecognised category.**
 * `category=commodities` returns 100 items that look plausible and are 100%
 * identical to `category=banana`, which is 100% identical to `general`. So the
 * map below is a whitelist, deliberately: anything not proven real must go to
 * the RSS adapter rather than quietly serving equities news under a forex tab.
 *
 * Coverage caveat, and it is not small: the free tier is US-centric. Company
 * news for the LSE, TSE, HKEX and SSE symbols in our universe comes back thin
 * or empty. That is a limit of the vendor tier, not a bug here — the service
 * falls through to the RSS adapter when a symbol returns nothing.
 */
const BASE = 'https://finnhub.io/api/v1';

/**
 * Asset class → Finnhub category, for the two that are verified real. Forex is
 * absent because its category returns a single item, and commodities because
 * the category does not exist. Both are served by RSS.
 */
const CATEGORY = {
  stocks: 'general',
  crypto: 'crypto',
};

/** Whether this adapter can serve a class at all. The service checks first. */
export const covers = (assetClass) => Boolean(CATEGORY[assetClass]);

/** Company news needs an explicit window; Finnhub returns nothing without one. */
const COMPANY_WINDOW_DAYS = 14;

const ymd = (d) => d.toISOString().slice(0, 10);

export const name = 'finnhub';

/** The key may live under either name — see the note in config/env.js. */
export const apiKey = () => env.FINNHUB_API_KEY || env.MARKET_DATA_API_KEY;

export const isConfigured = () => Boolean(apiKey());

async function call(path, params) {
  const qs = new URLSearchParams({ ...params, token: apiKey() });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    signal: AbortSignal.timeout(env.NEWS_TIMEOUT_MS),
  });

  if (!res.ok) {
    // 401 is a bad key, 429 is the rate limit. Both are worth distinguishing
    // in the log because the fix is completely different.
    const body = await res.text().catch(() => '');
    throw new Error(`finnhub ${res.status} ${path}: ${body.slice(0, 120)}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`finnhub ${path}: expected an array`);
  return json;
}

/**
 * Finnhub's shape → ours. `datetime` is epoch SECONDS, not milliseconds; the
 * x1000 is the whole reason this mapping is not a spread.
 */
/**
 * THREE THINGS FINNHUB'S REUTERS INGESTION DOES BADLY, all measured on the
 * same 20-article sample and all affecting the same 14 items:
 *
 *   14/20  imageUrl is the file `reuters_logo.jpeg` — the publisher's logo,
 *          not a photograph of anything
 *   14/20  summary is the headline again, word for word
 *   14/20  headline ends in " - Reuters", duplicating the byline beside it
 *
 * Left alone the page renders fourteen identical black logo tiles, each with
 * its headline printed twice and the publisher named three times. Cleaning it
 * belongs here rather than in the client: this is the vendor boundary, it is
 * where the shape is known, and it means the cache holds clean records.
 */

/**
 * A logo is not an image. Better an honest tile than a wall of the same JPEG.
 *
 * The test is the HOST, not the path. `/logo/` was the first pattern found
 * (`reuters_logo.jpeg`, x14) but the crypto feed then produced
 * `/publicdatany/hmpimage/cointelegraph.webp` x4, which is the same idea under
 * a different name. Finnhub is a data vendor rather than a photo agency: every
 * genuine article photograph observed came from the publisher's own CDN
 * (cnbcfm.com, cryptocurrencynews.com), and everything on static*.finnhub.io
 * was a house stand-in.
 */
const FINNHUB_STATIC = /(^|\/\/)static\d*\.finnhub\.io\//;

const cleanImage = (image) => {
  const url = String(image ?? '');
  return FINNHUB_STATIC.test(url) ? '' : url;
};

/** "Oil falls … - Reuters" → "Oil falls …", when the suffix IS the publisher. */
const cleanHeadline = (headline, source) => {
  const h = String(headline ?? '').trim();
  const p = String(source ?? '').trim();
  return p && h.endsWith(` - ${p}`) ? h.slice(0, -(p.length + 3)).trim() : h;
};

/** Comparable form: case, punctuation and spacing are all noise here. */
const gist = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Drop a summary that only restates the headline. `startsWith` rather than
 * equality because the repeat usually has the publisher glued to the end of
 * it, so the two are never exactly equal.
 */
const cleanSummary = (summary, headline) => {
  const s = String(summary ?? '').trim();
  const g = gist(headline);
  return g && gist(s).startsWith(g) ? '' : s;
};

/** Exported for the tests — these transforms are the fragile part, not the fetch. */
export const _clean = { image: cleanImage, headline: cleanHeadline, summary: cleanSummary };

const normalise = (assetClass) => (a) => ({
  source: /** @type {const} */ ('finnhub'),
  sourceName: 'Finnhub',
  assetClass,
  symbols: String(a.related ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  headline: cleanHeadline(a.headline, a.source),
  summary: cleanSummary(a.summary, a.headline),
  url: String(a.url ?? ''),
  imageUrl: cleanImage(a.image),
  publisher: String(a.source ?? ''),
  category: String(a.category ?? ''),
  publishedAt: new Date(Number(a.datetime ?? 0) * 1000),
});

const usable = (a) => a.url && a.headline && a.publishedAt.getTime() > 0;

/**
 * Market news for one asset class.
 *
 * Throws rather than returning [] for a class it does not cover. An empty
 * array would be indistinguishable from "the vendor had nothing", and the
 * service would cache that as a successful fetch instead of falling through
 * to the adapter that actually has the content.
 */
export async function fetchCategory(assetClass) {
  const category = CATEGORY[assetClass];
  if (!category) throw new Error(`finnhub does not cover ${assetClass}`);

  const rows = await call('/news', { category });
  return rows.map(normalise(assetClass)).filter(usable);
}

/** News for one ticker, over a fixed trailing window. Equities only. */
export async function fetchCompany(symbol) {
  const to = new Date();
  const from = new Date(to.getTime() - COMPANY_WINDOW_DAYS * 86_400_000);
  const rows = await call('/company-news', {
    symbol: symbol.toUpperCase(),
    from: ymd(from),
    to: ymd(to),
  });
  // Finnhub omits `related` on company news, so the symbol is stamped here —
  // otherwise the article caches with no ticker and never matches the filter
  // that fetched it.
  return rows
    .map(normalise('stocks'))
    .filter(usable)
    .map((a) => ({ ...a, symbols: a.symbols.length ? a.symbols : [symbol.toUpperCase()] }));
}
