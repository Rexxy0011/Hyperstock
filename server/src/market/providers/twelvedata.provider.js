import { env } from '../../config/env.js';
import { normalizeCurrency, toCents } from '../../lib/money.js';

/**
 * Twelve Data — the non-US half of the equity book.
 *
 * Exists because Finnhub's free tier 403s every non-US quote, which is six of
 * our eight exchanges: Euronext, XETRA, LSE, TSE, HKEX, SSE. Twelve Data
 * quotes all of them on a free key, so the two together cover the universe.
 *
 * NEEDS A KEY AND THERE IS NO DEMO PATH. `apikey=demo` returns 401 with a note
 * to request your own — tested. Without `TWELVEDATA_API_KEY` set this reports
 * `isConfigured() === false` and those rows keep their seeded prices, exactly
 * as before, rather than the job failing every minute.
 *
 * ONE CALL FOR THE WHOLE BATCH. `/quote?symbol=A,B,C` returns a keyed object
 * rather than an array, which matters: the free tier is 800 requests a DAY and
 * 8 a minute, so per-symbol calls would exhaust it before lunch. 23 symbols in
 * one request, once a minute, is 1440 a day — still over, so the job runs this
 * on the slower tier. See TWELVEDATA_MIN_FETCH_MS.
 *
 * EXCHANGE SUFFIXES, and they are not the same as Yahoo's. Twelve Data keys
 * off `symbol:exchange` (`ASML:Euronext`), not `ASML.AS`. Sending Yahoo-style
 * suffixes returns 404 for every one of them.
 */
const BASE = 'https://api.twelvedata.com';

/**
 * Our seeded exchange names → Twelve Data's MIC-ish codes. Two are the traps
 * already caught once in this project: XETRA is `XETR` and TSE is `JPX` —
 * sending the obvious spelling returns 200 with zero symbols, not an error.
 */
const EXCHANGE = {
  Euronext: 'Euronext',
  XETRA: 'XETR',
  LSE: 'LSE',
  TSE: 'JPX',
  HKEX: 'HKEX',
  SSE: 'SSE',
};

export const name = 'twelvedata';

export const isConfigured = () => Boolean(env.TWELVEDATA_API_KEY);

/**
 * WHETHER THE PLAN ACTUALLY SELLS THESE VENUES, which is not the same question
 * as whether a key is set — and the answer on the free tier is no.
 *
 * Measured with a live key: every one of `ASML:Euronext`, `SAP:XETR`, `AZN:LSE`,
 * `0700:HKEX` and `600519:SSE` comes back "**symbol** X is not available with
 * your plan". The `basic` plan is US-only. So the premise this provider was
 * written on — that Twelve Data covers the six exchanges Finnhub 403s — holds
 * only on a paid plan.
 *
 * That matters far beyond a thinner table, because of the CREDIT MODEL: a batch
 * costs one credit PER SYMBOL, not one per request, against 8 a minute and 800
 * a DAY. Left alone, the refresh job would spend 18 credits every 60 seconds
 * failing, exhaust the daily allowance in about three quarters of an hour, and
 * take the candle charts down with it — those are the thing the key actually
 * buys.
 *
 * So support is probed ONCE with a single symbol (one credit) and remembered.
 * `null` = not yet probed, `true`/`false` = measured. In-process only, so a
 * restart re-probes and an upgraded plan is picked up without a code change.
 */
let intlSupported = /** @type {boolean | null} */ (null);

/**
 * THE SAME REJECTION IS WORDED TWO WAYS, and matching only one of them is a
 * slow quota leak rather than a visible bug. Measured on the live key:
 *
 *   batch   `**symbol** ASML is not available with your plan`
 *   single  `This symbol is available starting with the Grow or Venture plan`
 *
 * The probe sends ONE symbol, so it sees the second form. Matching only the
 * first left it unresolved, which means re-probing every refresh cycle — one
 * credit a minute, 1440 a day, against an 800/day allowance. It would have
 * drained the budget overnight and taken the candle charts with it.
 *
 * The pricing URL is the most stable of the three signals; all are matched.
 */
const PLAN_ERROR =
  /not available with your plan|available starting with|twelvedata\.com\/pricing/i;

/**
 * A backstop for a permanent error nobody has seen yet. Matching known wordings
 * cannot cover an unknown one, so an unresolved probe is retried a few times
 * and then abandoned for the life of the process — bounding the cost of ANY
 * permanent failure at three credits per boot rather than one a minute forever.
 */
const MAX_PROBES = 3;
let probeAttempts = 0;

/** The venues this provider is for — everything Finnhub's free tier refuses. */
export const covers = (exchange) => Boolean(EXCHANGE[exchange]);

/** What the probe concluded, for `GET /api/market/status` and the boot log. */
export const planCoversIntl = () => intlSupported;

async function probeIntlSupport() {
  if (intlSupported !== null) return intlSupported;
  if (probeAttempts >= MAX_PROBES) return false;
  probeAttempts += 1;

  const qs = new URLSearchParams({ symbol: 'ASML:Euronext', apikey: env.TWELVEDATA_API_KEY });
  try {
    const res = await fetch(`${BASE}/quote?${qs}`, {
      signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
    });
    const body = await res.json();
    // A plan restriction is a PERMANENT answer, so it disables the path. A 429
    // or a timeout is transient and leaves the probe unresolved to be retried —
    // disabling on one of those would turn a blip into a session-long outage.
    if (PLAN_ERROR.test(String(body?.message ?? ''))) intlSupported = false;
    else if (body?.close) intlSupported = true;
  } catch {
    /* transient — stay unprobed and try again next cycle */
  }

  if (intlSupported === false) {
    console.warn(
      'market: twelvedata plan is US-only — non-US quotes disabled to preserve the daily credit budget',
    );
  } else if (intlSupported === null && probeAttempts >= MAX_PROBES) {
    console.warn(
      `market: twelvedata support unresolved after ${MAX_PROBES} probes — non-US quotes disabled`,
    );
  }
  return intlSupported;
}

const tdSymbol = (symbol, exchange) => `${symbol}:${EXCHANGE[exchange]}`;

/**
 * @param {{symbol: string, exchange: string, currency: string}[]} listings
 * @returns {Promise<Map<string, {priceUsdCents: number, priceCents: number, changePct: number}>>}
 */
export async function fetchQuotes(listings) {
  const out = new Map();
  const wanted = listings.filter((l) => covers(l.exchange));
  if (!wanted.length || !isConfigured()) return out;

  // One credit to find out, instead of eighteen a minute to keep failing.
  if ((await probeIntlSupport()) !== true) return out;

  const qs = new URLSearchParams({
    symbol: wanted.map((l) => tdSymbol(l.symbol, l.exchange)).join(','),
    apikey: env.TWELVEDATA_API_KEY,
  });

  const res = await fetch(`${BASE}/quote?${qs}`, {
    signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`twelvedata ${res.status}`);

  const body = await res.json();
  // A single-symbol request returns the quote object directly; a batch returns
  // it keyed by the symbol string. Normalising both here keeps the caller from
  // caring how many symbols it happened to ask for.
  const entries =
    body?.symbol && body?.close
      ? [[tdSymbol(wanted[0].symbol, wanted[0].exchange), body]]
      : Object.entries(body ?? {});

  for (const [key, q] of entries) {
    if (q?.status === 'error' || !q?.close) continue;

    const listing = wanted.find((l) => tdSymbol(l.symbol, l.exchange) === key);
    if (!listing) continue;

    const close = Number(q.close);
    if (!Number.isFinite(close) || close <= 0) continue;

    // Native minor units first, then USD. `normalizeCurrency` is what turns
    // an LSE quote of 11606 into £116.06 — skip it and every LSE holding is
    // overvalued a hundredfold.
    const nativeCents = toCents(normalizeCurrency(close, listing.currency));

    out.set(listing.symbol, {
      priceCents: nativeCents,
      // Deliberately NOT converted here. The caller holds the seeded USD/native
      // ratio for this listing and applies it, because this provider returns no
      // FX rate and inventing one per symbol would drift them apart.
      priceUsdCents: nativeCents,
      changePct: Number(q.percent_change ?? 0),
    });
  }

  return out;
}
