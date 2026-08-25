import { env } from '../../config/env.js';
import { toCents } from '../../lib/money.js';

/**
 * REAL equity candles, for US listings only.
 *
 * This is what a Twelve Data key actually buys on the free `basic` plan, and it
 * is not what the quote provider was written expecting. Measured with a live
 * key: every non-US symbol returns "not available with your plan", while
 * `AAPL` returns full OHLC **with volume** on both daily and intraday
 * intervals. Finnhub is the mirror image — it streams US quotes for free but
 * 403s `/stock/candle` — so the two together cover US equities completely, and
 * the six non-US venues remain simulated on a free plan.
 *
 * CREDITS ARE THE CONSTRAINT, not latency. One call is one credit, against 8 a
 * minute and 800 a day. That is ample for chart views — `candles.service.js`
 * caches each {symbol, range} for ten minutes — but it is nowhere near enough
 * to poll, which is why nothing here runs on a timer.
 */
const BASE = 'https://api.twelvedata.com';

/** Only the venues the plan serves. The gate is the VENUE, never the ticker. */
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ']);

/**
 * Range → interval and bar count. `outputsize` is a MAXIMUM, not a promise: a
 * 1D request outside market hours returns the last session, which is correct —
 * the alternative is an empty chart every evening.
 *
 * The intraday counts assume a 6.5h US session: 78 five-minute bars, 13
 * half-hours.
 */
const RANGE = {
  '1D': { interval: '5min', outputsize: 78, label: '5m' },
  '1W': { interval: '30min', outputsize: 65, label: '30m' },
  '1M': { interval: '1day', outputsize: 30, label: '1d' },
  '3M': { interval: '1day', outputsize: 90, label: '1d' },
  '1Y': { interval: '1day', outputsize: 252, label: '1d' },
  ALL: { interval: '1week', outputsize: 260, label: '1w' },
};

export const name = 'twelvedata';

export const isConfigured = () => Boolean(env.TWELVEDATA_API_KEY);

export const covers = (assetClass, exchange) =>
  assetClass === 'stocks' && isConfigured() && US_EXCHANGES.has(exchange);

export const supportsRange = (range) => range in RANGE;

/**
 * @param {{ symbol: string, exchange?: string }} instrument
 * @param {string} range
 */
export async function fetchCandles(instrument, range) {
  const spec = RANGE[range];
  if (!spec) throw new Error(`twelvedata: unsupported range ${range}`);

  const qs = new URLSearchParams({
    symbol: instrument.symbol,
    interval: spec.interval,
    outputsize: String(spec.outputsize),
    apikey: env.TWELVEDATA_API_KEY,
  });

  const res = await fetch(`${BASE}/time_series?${qs}`, {
    signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`twelvedata time_series ${res.status}`);

  const body = await res.json();
  // The API answers errors with HTTP 200 and an error body — a 429 for credit
  // exhaustion arrives that way too — so the status line alone proves nothing.
  if (body?.status === 'error' || body?.code) {
    throw new Error(`twelvedata ${body.code ?? ''} ${String(body.message ?? '').slice(0, 80)}`);
  }
  if (!Array.isArray(body?.values) || body.values.length === 0) {
    throw new Error('twelvedata time_series: empty series');
  }

  const points = body.values
    .map((v) => {
      // "2026-08-21" for daily, "2026-08-21 15:55:00" for intraday. The latter
      // has no zone, and it is EXCHANGE local time — parsed as-is it would be
      // read as the server's zone. Only the ordering and spacing matter to the
      // chart, so the offset is irrelevant, but a bare `new Date()` on the
      // space-separated form is not portable; the T makes it ISO.
      const t = new Date(v.datetime.replace(' ', 'T')).getTime();
      const close = Number(v.close);
      if (!Number.isFinite(t) || !Number.isFinite(close)) return null;

      return {
        t,
        o: toCents(Number(v.open)),
        h: toCents(Number(v.high)),
        l: toCents(Number(v.low)),
        c: toCents(close),
        v: Math.round(Number(v.volume) || 0),
      };
    })
    .filter(Boolean)
    // Twelve Data returns NEWEST FIRST. Left unreversed the chart draws
    // backwards — every series would appear to end where it began.
    .reverse();

  if (!points.length) throw new Error('twelvedata time_series: no usable bars');

  return {
    points,
    simulated: false,
    hasRange: true,
    hasVolume: points.some((p) => p.v > 0),
    interval: spec.label,
    source: name,
  };
}
