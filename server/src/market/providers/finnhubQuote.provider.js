import { env } from '../../config/env.js';
import { toCents } from '../../lib/money.js';

/**
 * Live equity quotes from Finnhub.
 *
 * US ONLY, and that is a hard limit of the free tier rather than a choice:
 * `/quote?symbol=AAPL` returns 200 with a full quote, `/quote?symbol=ASML.AS`
 * returns 403 "You don't have access to this resource". Six of the eight
 * exchanges in our universe are behind that wall, so `isUsSymbol` gates the
 * call and everything else keeps its seeded price, labelled as such.
 *
 * ONE REQUEST PER SYMBOL. There is no batch quote endpoint on this tier, which
 * is why the caller passes only the symbols it needs and the service caches
 * hard: the whole US subset is ~15 calls against a 60/minute budget that news
 * is already spending.
 */
const BASE = 'https://finnhub.io/api/v1';

export const name = 'finnhub';

export const isConfigured = () => Boolean(env.FINNHUB_API_KEY || env.MARKET_DATA_API_KEY);

const apiKey = () => env.FINNHUB_API_KEY || env.MARKET_DATA_API_KEY;

/** Why the last batch came back short, for the status endpoint to report. */
let lastFailure = /** @type {string | null} */ (null);

export const lastQuoteFailure = () => lastFailure;

/**
 * THE VENUE DECIDES, NOT THE TICKER.
 *
 * The first version of this gated on ticker shape — no dot, therefore US — and
 * it was wrong in the worst available way. Finnhub resolves a bare ticker
 * against US listings, so `AIR` returned a price for AAR Corp on the NYSE and
 * it was written onto the row labelled "Airbus · Euronext". `ALV` returned
 * Autoliv and was written onto "Allianz · XETRA". Both rendered as a live
 * quote for a company that was not the one named beside it.
 *
 * ASML, AZN and SAP are the subtler version of the same fault: those tickers
 * do resolve to the right company, but to its US ADR, which is a different
 * listing at a different price from the Euronext/LSE/XETRA line the row names.
 *
 * The seed knows the venue, so the venue is the gate.
 */
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ']);

export const isUsListing = (exchange) => US_EXCHANGES.has(String(exchange));

/**
 * @param {{symbol: string, exchange: string}[]} listings
 * @returns {Promise<Map<string, {priceCents: number, priceUsdCents: number,
 *   changePct: number, previousCloseCents: number, openCents: number,
 *   highCents: number, lowCents: number}>>}
 */
export async function fetchQuotes(listings) {
  const out = new Map();
  const wanted = listings.filter((l) => isUsListing(l.exchange)).map((l) => l.symbol);
  if (!wanted.length || !isConfigured()) return out;

  // allSettled: one bad symbol must not empty the whole table.
  const results = await Promise.allSettled(
    wanted.map(async (symbol) => {
      const res = await fetch(`${BASE}/quote?symbol=${symbol}&token=${apiKey()}`, {
        signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`finnhub quote ${res.status} ${symbol}`);
      return { symbol, q: await res.json() };
    }),
  );

  // Rejections were being swallowed here, so a total failure surfaced as the
  // useless "no quotes returned" — every symbol could be timing out and the
  // status endpoint would not say so. The first reason is kept and rethrown
  // by the caller when nothing at all came back.
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    lastFailure = `${failures.length}/${wanted.length} failed: ${failures[0].reason?.message}`;
  } else {
    lastFailure = null;
  }

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { symbol, q } = r.value;
    // `c` is the current price and is 0 for a symbol Finnhub does not know —
    // a 200 with zeroes, not an error. Treating that as a price would zero the
    // row out, so it is dropped and the seeded value stands.
    if (!Number.isFinite(q?.c) || q.c <= 0) continue;

    out.set(symbol, {
      // US listings quote in USD, so native and USD are the same figure. It is
      // carried explicitly so the merged map has one shape whichever vendor
      // produced the row.
      priceCents: toCents(q.c),
      priceUsdCents: toCents(q.c),
      changePct: Number(q.dp ?? 0),
      // `pc` is the PREVIOUS CLOSE, and it is what makes the pair reconcilable.
      // A streamed tick carries no reference to it, so without this the socket
      // moves the price while `changePct` stays on the figure REST last struck
      // — and the two numbers in one ticker pill stop describing each other.
      previousCloseCents: toCents(q.pc ?? 0),
      openCents: toCents(q.o ?? 0),
      highCents: toCents(q.h ?? 0),
      lowCents: toCents(q.l ?? 0),
    });
  }

  return out;
}
