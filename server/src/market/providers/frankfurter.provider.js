import { env } from '../../config/env.js';
import { toNanos } from '../../lib/money.js';

/**
 * Forex from Frankfurter, which serves the ECB's published reference rates.
 * No key. Chosen because Finnhub's `/forex/rates` is 403 on the free tier —
 * verified with the live key — so forex is not a fallback here, it is the only
 * source available without paying.
 *
 * TWO CALLS, NOT ONE, and the second is what makes the table worth showing.
 * The rates endpoint returns levels only, so a change column has to be
 * computed against a prior publication. `latest` also carries the date it
 * belongs to, and that date is what the previous call asks to step back from —
 * asking for "yesterday" by wall clock lands on a weekend or a TARGET holiday
 * and silently returns the same day's rates, which would render every pair at
 * exactly 0.00%.
 *
 * These are DAILY reference rates, published once each afternoon in Frankfurt.
 * They are not a live tick, and the service labels them accordingly.
 */
const BASE = 'https://api.frankfurter.dev/v1';

/**
 * The pairs shown, quoted the way the market quotes them. EUR, GBP, AUD and
 * NZD are "indirect" — EURUSD means dollars per euro — while the rest are
 * dollars-as-base. Getting this backwards renders USDJPY as 0.0068.
 */
export const PAIRS = [
  { base: 'EUR', quote: 'USD', name: 'Euro / US Dollar' },
  { base: 'GBP', quote: 'USD', name: 'British Pound / US Dollar' },
  { base: 'USD', quote: 'JPY', name: 'US Dollar / Japanese Yen' },
  { base: 'USD', quote: 'CHF', name: 'US Dollar / Swiss Franc' },
  { base: 'USD', quote: 'CAD', name: 'US Dollar / Canadian Dollar' },
  { base: 'AUD', quote: 'USD', name: 'Australian Dollar / US Dollar' },
  { base: 'NZD', quote: 'USD', name: 'New Zealand Dollar / US Dollar' },
  { base: 'USD', quote: 'CNY', name: 'US Dollar / Chinese Yuan' },
  { base: 'USD', quote: 'SEK', name: 'US Dollar / Swedish Krona' },
  { base: 'USD', quote: 'NOK', name: 'US Dollar / Norwegian Krone' },
  { base: 'USD', quote: 'MXN', name: 'US Dollar / Mexican Peso' },
  { base: 'USD', quote: 'INR', name: 'US Dollar / Indian Rupee' },
];

export const name = 'frankfurter';

async function call(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`frankfurter ${res.status} ${path}`);
  return res.json();
}

/** USD-based rates → the rate for one pair, in the direction it is quoted. */
function rateFor({ base, quote }, usdRates) {
  if (base === 'USD') return usdRates[quote];
  // Indirect: EURUSD is 1 / (EUR per USD).
  const perUsd = usdRates[base];
  return perUsd ? 1 / perUsd : undefined;
}

export async function fetchRows() {
  const latest = await call('/latest?base=USD');

  // Step back from the date the ECB actually published, not from today. A
  // fixed-window request would land on a weekend and return the same rates.
  const prevDate = new Date(`${latest.date}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const from = new Date(prevDate);
  from.setUTCDate(from.getUTCDate() - 6);

  // A range, so a holiday cannot produce an empty answer: take the newest
  // publication strictly before `latest.date`.
  const window = await call(
    `/${from.toISOString().slice(0, 10)}..${prevDate.toISOString().slice(0, 10)}?base=USD`,
  );
  const days = Object.keys(window.rates ?? {}).sort();
  const previous = days.length ? window.rates[days[days.length - 1]] : {};

  return PAIRS.map((pair) => {
    const now = rateFor(pair, latest.rates);
    const before = rateFor(pair, previous);
    if (!Number.isFinite(now)) return null;

    // FX is quoted to 4-5 decimals, so cents would round USDJPY's move away
    // entirely. Rates are carried as a plain number and the client formats
    // them; only `priceUsdCents` exists for the shared table shape.
    return {
      assetClass: /** @type {const} */ ('forex'),
      symbol: `${pair.base}${pair.quote}`,
      name: pair.name,
      exchange: 'FX',
      currency: pair.quote,
      logoUrl: '',
      rate: now,
      priceCents: Math.round(now * 10_000),
      priceUsdCents: Math.round(now * 10_000),
      // NOT the two fields above. `priceUsdCents` on a forex row is the rate
      // scaled by 10,000 so the shared table shape has something to hold — it
      // is not a cent figure, and pricing a trade off it is 100x out. This one
      // is the honest USD price of one unit of the base currency.
      priceUsdNanos: toNanos(now),
      changePct: Number.isFinite(before) && before ? ((now - before) / before) * 100 : 0,
      marketCap: 0,
      volume: 0,
      status: /** @type {const} */ ('Listed'),
      live: true,
      asOfDate: latest.date,
    };
  }).filter(Boolean);
}
