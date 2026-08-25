import { env } from '../../config/env.js';
import { PAIRS } from '../providers/frankfurter.provider.js';

/**
 * Forex history from the ECB's published reference rates, via Frankfurter.
 * Keyless, and real — but real CLOSES, not real candles, and the difference is
 * the whole design of this adapter.
 *
 * The ECB publishes ONE rate per business day. There is no open, no high and no
 * low anywhere in the source. A daily bar can still be drawn honestly, because
 * open = the previous publication is the standard way to build a daily series
 * from closes and the body then encodes a real day-over-day move. The high and
 * low would be pure invention, so they are NOT synthesised: the response says
 * `hasRange: false` and the chart draws bodies with no wicks.
 *
 * That absence is deliberately visible. A wick drawn from a fabricated intraday
 * range is indistinguishable from a real one, which is exactly the kind of
 * plausible fiction this codebase keeps labelling.
 *
 * NO 1D RANGE, for the same reason — one publication a day means an intraday
 * series does not exist. The client drops the tab rather than showing a chart
 * with a single bar in it.
 */
const BASE = 'https://api.frankfurter.dev/v1';

/** Calendar days back per range. `1D` is absent on purpose — see above. */
const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, ALL: 1825 };

export const name = 'frankfurter';

export const covers = (assetClass) => assetClass === 'forex';

export const supportsRange = (range) => range in RANGE_DAYS;

/** USD-based rates → one pair, in the direction the market quotes it. */
function rateFor(pair, usdRates) {
  if (!pair || !usdRates) return undefined;
  if (pair.base === 'USD') return usdRates[pair.quote];
  const perUsd = usdRates[pair.base];
  return perUsd ? 1 / perUsd : undefined;
}

/**
 * FX moves in the fourth decimal, so cents would round the whole day's move
 * away. Rates are carried as ten-thousandths and the response declares
 * `divisor: 10_000` rather than leaving the caller to guess the unit.
 */
const SCALE = 10_000;

/**
 * @param {{ symbol: string }} instrument
 * @param {string} range
 */
export async function fetchCandles(instrument, range) {
  const symbol = String(instrument.symbol).toUpperCase();
  const pair = PAIRS.find((p) => `${p.base}${p.quote}` === symbol);
  if (!pair) throw new Error(`frankfurter: unknown pair ${symbol}`);

  const days = RANGE_DAYS[range];
  if (!days) throw new Error(`frankfurter: no intraday series for range ${range}`);

  // One extra day of lead-in: the first rendered bar needs a real previous
  // close to open from, and without this it would open at its own close and
  // render as a flat doji that never happened.
  const end = new Date();
  const start = new Date(end.getTime() - (days + 5) * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const symbols = pair.base === 'USD' ? pair.quote : pair.base;
  const res = await fetch(`${BASE}/${iso(start)}..${iso(end)}?base=USD&symbols=${symbols}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`frankfurter timeseries ${res.status}`);

  const body = await res.json();
  // Sorted explicitly: object key order is not a contract, and a chart drawn
  // from out-of-order days folds back on itself.
  const dates = Object.keys(body.rates ?? {}).sort();

  const closes = dates
    .map((date) => ({ date, rate: rateFor(pair, body.rates[date]) }))
    .filter((d) => Number.isFinite(d.rate));

  if (closes.length < 2) throw new Error('frankfurter timeseries: not enough publications');

  // Drop the lead-in bar — it is only here to give the second one an open.
  const points = closes.slice(1).map((day, i) => {
    const open = Math.round(closes[i].rate * SCALE);
    const close = Math.round(day.rate * SCALE);
    return {
      t: new Date(`${day.date}T00:00:00Z`).getTime(),
      o: open,
      // High and low are the body's own extremes, NOT an intraday range. With
      // hasRange false the chart draws no wick, so these are never presented
      // as something the ECB published.
      h: Math.max(open, close),
      l: Math.min(open, close),
      c: close,
      v: 0,
    };
  });

  return {
    points,
    simulated: false,
    hasRange: false,
    hasVolume: false,
    interval: '1d',
    source: name,
    divisor: SCALE,
  };
}
