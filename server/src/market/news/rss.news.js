import { env } from '../../config/env.js';

/**
 * The RSS adapter. Two jobs, and it is worth being clear they are different:
 *
 *   1. FALLBACK for stocks and crypto, where Finnhub is the real provider and
 *      this only runs when the key is missing or the vendor is down.
 *   2. THE ONLY SOURCE for forex and commodities. Finnhub's `forex` category
 *      returns a single item and it has no commodities category at all, so
 *      these feeds are not a degraded mode — they are the product.
 *
 * WHICH FEEDS, AND WHY THESE. All measured, because a feed that returns 200
 * with 15 plausible items can still be the wrong feed:
 *
 *   stocks       Nasdaq ?category=Markets            15 items
 *   crypto       Nasdaq ?category=Cryptocurrencies   15 items, 0 shared with Markets
 *   commodities  Nasdaq ?category=Commodities        15 items, 0 shared with Markets
 *   forex        FXStreet + Investing.com            30 + 10 items, both with images
 *
 * Nasdaq's `?category=Currencies` is NOT in that list on purpose. It answers
 * 200 with 15 items, of which **12 are byte-identical to the Markets feed** and
 * the rest are equities stories. It is the stocks feed wearing a forex label,
 * and shipping it would have put Atlassian insider sales under a forex tab.
 *
 * PARSING. There is no XML dependency in this workspace and news does not
 * justify adding one, so the extractor below is deliberately narrow: it reads
 * a handful of known feeds with known shapes, not arbitrary RSS. If it is ever
 * pointed at a new one, check what that feed actually emits first — every bug
 * found here so far was a difference between feeds, not a logic error.
 */
const BY_SYMBOL = 'https://www.nasdaq.com/feed/rssoutbound?symbol=';

const nasdaq = (category) => `https://www.nasdaq.com/feed/rssoutbound?category=${category}`;

/**
 * Feeds per asset class. Forex takes two because neither alone is enough:
 * FXStreet is the substantial one at 30 items but is pair-forecast heavy,
 * and Investing.com adds broader macro currency coverage.
 */
const FEEDS = {
  stocks: [{ url: nasdaq('Markets'), publisher: 'Nasdaq' }],

  // Nasdaq for the ticker tags, CoinTelegraph and Decrypt for the pictures —
  // both put an <enclosure> on every item and both serve them to any origin,
  // which is not a given (see Investing.com below).
  crypto: [
    { url: nasdaq('Cryptocurrencies'), publisher: 'Nasdaq' },
    { url: 'https://cointelegraph.com/rss', publisher: 'CoinTelegraph' },
    { url: 'https://decrypt.co/feed', publisher: 'Decrypt' },
  ],

  // No free commodities feed carries a usable image. Nasdaq publishes none at
  // all; Investing.com publishes one per item and then 403s it from any origin
  // but their own. So this pair is here for coverage, not illustration, and
  // the tab renders tiles by design rather than by accident.
  commodities: [
    { url: nasdaq('Commodities'), publisher: 'Nasdaq' },
    { url: 'https://www.investing.com/rss/news_11.rss', publisher: 'Investing.com' },
  ],

  forex: [
    { url: 'https://www.fxstreet.com/rss/news', publisher: 'FXStreet' },
    { url: 'https://www.investing.com/rss/news_1.rss', publisher: 'Investing.com' },
  ],
};

export const covers = (assetClass) => Boolean(FEEDS[assetClass]);

// Nasdaq serves an error page to an unrecognised agent.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const name = 'rss';

/** No key, so it is always available — that is the point of it. */
export const isConfigured = () => true;

/**
 * The only two that can produce markup. These get exactly one pass, ever —
 * decoding them a second time would let "&amp;lt;script" become a tag.
 */
const TAG_ENTITIES = { lt: '<', gt: '>' };

/**
 * Everything else this feed emits. All decode to inert characters that cannot
 * form a tag or another entity, so they are safe to run twice.
 *
 * Not optional extras. `&rsquo;` appears in every possessive and `&quot;` in
 * every quoted headline, so omitting them puts "Tesla&rsquo;s" and the
 * &quot;Show Me&quot; Phase on the page verbatim.
 */
const TEXT_ENTITIES = {
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

const named = (s, table) =>
  s.replace(/&([a-z]+);/gi, (m, n) => table[n.toLowerCase()] ?? m);

/**
 * &amp; is decoded LAST, or "&amp;lt;" would turn into "<" instead of "&lt;".
 *
 * THE FEED IS DOUBLE-ENCODED. Nasdaq emits `&amp;rsquo;`, `&amp;nbsp;`,
 * `&amp;quot;` and even `&amp;amp;` literally — all verified in the raw XML.
 * The &amp; step reduces those to `&rsquo;` and `&amp;`, one pass too late for
 * the substitutions that already ran, so the whole thing runs a second time.
 *
 * The second pass omits TAG_ENTITIES, and that is the only thing making this
 * safe: `&amp;lt;script` reduces to the literal text `&lt;script` and stops
 * there, rather than becoming a tag. A blanket second decode would not be safe.
 */
const decode = (s) => {
  const pass = (t, table) =>
    named(t, table)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');

  return pass(pass(s, { ...TAG_ENTITIES, ...TEXT_ENTITIES }), TEXT_ENTITIES);
};

const strip = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Nasdaq strips the markup out of syndicated descriptions on their side and
 * does it without inserting whitespace, so a Motley Fool "Key Points" section
 * heading arrives welded to the first sentence: "Key PointsDuring the second
 * quarter…". It was on 15 of 15 items in the sampled feed, i.e. every article
 * with a summary, so this is the normal case rather than an edge one.
 *
 * The lookahead is what keeps it safe: it only fires when nothing separates
 * the heading from the text, which is the broken form. A summary that legibly
 * begins "Key Points " is left alone.
 */
const unwedge = (s) => s.replace(/^Key Points(?=\S)/, '').trim();

/**
 * Namespace-agnostic on purpose. Nasdaq prefixes half these elements and not
 * the others — `<title>` and `<category>` are bare, but the two that carry the
 * most value are `<dc:creator>` and `<nasdaq:tickers>`. Matching the bare name
 * only silently drops both, which looks like a feed with no bylines and no
 * ticker tags rather than like a parsing bug.
 */
function tag(item, names) {
  for (const n of names) {
    const ns = '(?:[a-z0-9]+:)?';
    const m = item.match(new RegExp(`<${ns}${n}[^>]*>([\\s\\S]*?)</${ns}${n}>`, 'i'));
    if (!m) continue;
    const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    return strip(cdata ? cdata[1] : m[1]);
  }
  return '';
}

/**
 * An attribute off a self-closing element — `<enclosure url="…"/>`.
 *
 * Nasdaq's feeds carry no images at all: zero `enclosure`, `media:content`,
 * `media:thumbnail`, `image` or `itunes:image` across 15 items. FXStreet and
 * Investing.com carry an enclosure on every single item, so the forex tab is
 * fully illustrated while the Nasdaq-backed tabs fall back to ticker tiles.
 */
function attr(item, name, attribute) {
  const m = item.match(new RegExp(`<(?:[a-z0-9]+:)?${name}[^>]*\\s${attribute}="([^"]+)"`, 'i'));
  return m ? decode(m[1]) : '';
}

/**
 * Split out from the fetch so it can be tested without a network call — and it
 * needs to be. Every bug found in this adapter so far lived in here rather
 * than in the transport: a namespace-blind tag matcher that dropped bylines
 * and every ticker, an entity table that missed the two most common entities,
 * and a feed that turns out to encode its ampersands twice.
 *
 * @param {string} xml
 * @param {object} [opts]
 * @param {string} [opts.assetClass] which feed was asked for
 * @param {string} [opts.publisher] fallback byline when the feed has no author
 * @param {string} [opts.fallbackSymbol] stamped on items the feed left untagged
 */
export function parseItems(xml, opts = {}) {
  const { assetClass = 'stocks', publisher = 'Nasdaq', fallbackSymbol = '' } = opts;
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return items
    .map((item) => {
      const tickers = tag(item, ['tickers'])
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      return {
        source: /** @type {const} */ ('rss'),
        sourceName: publisher,
        assetClass,
        // Dedupe: the feed repeats a ticker when a story mentions it twice.
        symbols: [...new Set(tickers.length ? tickers : [fallbackSymbol].filter(Boolean))],
        headline: tag(item, ['title']),
        summary: unwedge(tag(item, ['description'])).slice(0, 400),
        url: tag(item, ['link', 'guid']),
        imageUrl: attr(item, 'enclosure', 'url'),
        publisher: tag(item, ['creator', 'author']) || publisher,
        category: tag(item, ['category']),
        publishedAt: new Date(tag(item, ['pubDate'])),
      };
    })
    .filter((a) => a.url && a.headline && !Number.isNaN(a.publishedAt.getTime()));
}

async function feed(url, opts) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml' },
    signal: AbortSignal.timeout(env.NEWS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rss ${res.status} ${new URL(url).hostname}`);

  return parseItems(await res.text(), opts);
}

/**
 * All feeds for a class, merged.
 *
 * `allSettled`, not `all`: forex reads two independent sites, and one of them
 * being down should thin the tab rather than empty it. Only a class where
 * every feed failed throws, so the service can tell that apart from a class
 * that genuinely had no news.
 */
export async function fetchCategory(assetClass) {
  const feeds = FEEDS[assetClass];
  if (!feeds) throw new Error(`no rss feed for ${assetClass}`);

  const results = await Promise.allSettled(
    feeds.map((f) => feed(f.url, { assetClass, publisher: f.publisher })),
  );

  const ok = /** @type {PromiseFulfilledResult<any>[]} */ (
    results.filter((r) => r.status === 'fulfilled')
  );
  const failed = /** @type {PromiseRejectedResult[]} */ (
    results.filter((r) => r.status === 'rejected')
  );

  for (const r of failed) {
    console.warn(`news: a ${assetClass} feed is down — ${r.reason?.message}`);
  }
  if (!ok.length) {
    throw new Error(`all ${assetClass} feeds failed: ${failed[0]?.reason?.message}`);
  }

  return ok.flatMap((r) => r.value);
}

/** Per-ticker news. Nasdaq's symbol feed is equities, so this is stocks only. */
export const fetchCompany = (symbol) =>
  feed(BY_SYMBOL + encodeURIComponent(symbol.toUpperCase()), {
    assetClass: 'stocks',
    publisher: 'Nasdaq',
    fallbackSymbol: symbol.toUpperCase(),
  });
