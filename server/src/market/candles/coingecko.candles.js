import { env } from '../../config/env.js';
import { toCents } from '../../lib/money.js';

/**
 * REAL crypto candles. Keyless, and the only genuinely real OHLC in this
 * product.
 *
 * Worth stating plainly because everything else here is simulated: Finnhub's
 * free tier 403s `/stock/candle`, `/crypto/candle` AND `/forex/candle` — all
 * three verified against the live key — so there is no candle data behind the
 * key we pay nothing for. CoinGecko publishes OHLC for every coin it lists
 * without a key at all.
 *
 * `[timestamp, open, high, low, close]` per bar, and NO VOLUME — the endpoint
 * simply does not carry it, which is why the chart's volume pane is absent for
 * crypto rather than drawn at zero.
 */
const URL = 'https://api.coingecko.com/api/v3/coins';

/**
 * The bar width is CHOSEN BY COINGECKO from the day count, not requested, and
 * the mapping is not linear. Measured on bitcoin:
 *
 *   days=1    48 bars    30 minutes
 *   days=7    42 bars    4 hours
 *   days=30  180 bars    4 hours
 *   days=90   23 bars    4 days
 *
 * So 1M returns 180 bars where 3M returns 23 — the shorter range is the denser
 * one. Nothing downstream may assume bar count grows with range.
 */
const RANGE_DAYS = { '1D': 1, '1W': 7, '1M': 30, '3M': 90, '1Y': 365, ALL: 'max' };

/** Roughly what CoinGecko returns for each, for the chart's caption. */
const RANGE_INTERVAL = {
  '1D': '30m',
  '1W': '4h',
  '1M': '4h',
  '3M': '4d',
  '1Y': '4d',
  ALL: '4d',
};

export const name = 'coingecko';

export const covers = (assetClass) => assetClass === 'crypto';

/** Every range, unlike forex — crypto trades continuously and has intraday. */
export const supportsRange = (range) => range in RANGE_DAYS;

/**
 * @param {{ vendorId?: string, symbol: string }} instrument
 * @param {string} range
 */
export async function fetchCandles(instrument, range) {
  // The slug, not the ticker. `/coins/BTC/ohlc` is a 404 — see vendorId in
  // coingecko.provider.js for why it cannot be derived.
  if (!instrument.vendorId) throw new Error(`coingecko: no vendor id for ${instrument.symbol}`);

  const days = RANGE_DAYS[range] ?? 30;
  const res = await fetch(
    `${URL}/${encodeURIComponent(instrument.vendorId)}/ohlc?vs_currency=usd&days=${days}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS) },
  );
  // 429 is the common one and it arrives after only a handful of calls, which
  // is the whole reason candles.service.js caches rather than proxying.
  if (!res.ok) throw new Error(`coingecko ohlc ${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('coingecko ohlc: expected an array');

  const points = rows
    .filter((r) => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[4]))
    .map(([t, o, h, l, c]) => ({
      t: Number(t),
      o: toCents(o),
      h: toCents(h),
      l: toCents(l),
      c: toCents(c),
      v: 0,
    }));

  if (!points.length) throw new Error('coingecko ohlc: empty series');

  return {
    points,
    simulated: false,
    // Real highs and lows, so the chart draws real wicks.
    hasRange: true,
    // No volume field on this endpoint at all — not zero volume, absent.
    hasVolume: false,
    interval: RANGE_INTERVAL[range] ?? '4h',
    source: name,
  };
}
