import { generateCandles, SUPPORTED_RANGES } from '../market/mockCandles.js';
import * as coingeckoCandles from '../market/candles/coingecko.candles.js';
import * as frankfurterCandles from '../market/candles/frankfurter.candles.js';
import * as twelvedataCandles from '../market/candles/twelvedata.candles.js';

/**
 * Candles for any instrument in any class, from whichever source can actually
 * supply them.
 *
 * WHAT IS REAL AND WHAT IS NOT, measured against the live Finnhub key rather
 * than assumed from the docs — all three of `/stock/candle`, `/crypto/candle`
 * and `/forex/candle` return 403 on the free tier, so the key buys no history
 * at all:
 *
 *   crypto      CoinGecko /ohlc     REAL open/high/low/close, keyless, no volume
 *   forex       Frankfurter         REAL daily closes; no intraday range exists
 *   stocks US   Twelve Data         REAL OHLC with volume — needs a key
 *   stocks !US  mockCandles.js      SIMULATED — no free source, and it says so
 *
 * The equity split is the plan's, not ours: Twelve Data's free tier is US-only
 * (measured — every non-US symbol answers "not available with your plan"),
 * which is the exact half Finnhub streams quotes for but 403s candles on. The
 * two vendors are mirror images, so together they cover US equities and leave
 * the other six venues simulated until somebody pays.
 *
 * Every response carries `simulated`, `hasRange` and `source`, because the
 * cases are visually identical once drawn. A seeded walk that terminates at the
 * real price looks exactly like a real series, which is precisely why it has to
 * be labelled rather than left to look convincing.
 */

const ADAPTERS = [coingeckoCandles, frankfurterCandles, twelvedataCandles];

export { SUPPORTED_RANGES };

/**
 * A per-{class,symbol,range} cache, and it is not optional.
 *
 * CoinGecko rate-limits hard and early — measured, HTTP 429 after roughly five
 * calls in quick succession — so a page that reached the vendor on each load
 * would break for everyone the moment two people opened a chart. Intraday
 * ranges expire faster than daily ones because only they can meaningfully
 * change within a minute.
 */
const cache = new Map();
const inFlight = new Map();

const ttlFor = (range) => (range === '1D' ? 60_000 : 10 * 60_000);

/** Bounded so a crawler walking every symbol cannot grow this without limit. */
const MAX_ENTRIES = 400;

function remember(key, value, range) {
  if (cache.size >= MAX_ENTRIES) {
    // Oldest insertion first — Map preserves it, so this needs no timestamps.
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { ...value, expiresAt: Date.now() + ttlFor(range) });
}

/** The mock walk, normalised into the shape the real adapters return. */
function simulated(instrument, range) {
  const { points } = generateCandles(
    instrument.symbol,
    instrument.priceCents ?? 0,
    range,
  );

  // A forex row's `priceCents` is already ten-thousandths — frankfurter.provider
  // stores `rate * 10_000` — so the walk built from it is in that unit too. Left
  // at the money default the axis would read 116.99 for a pair trading at
  // 1.1699. Only reachable by requesting forex 1D directly, since the client
  // drops that tab, but the unit has to be right for whoever does.
  const divisor = instrument.assetClass === 'forex' ? 10_000 : 100;

  return {
    divisor,
    points: points.map((p) => ({
      t: p.t,
      o: p.oCents,
      h: p.hCents,
      l: p.lCents,
      c: p.cCents,
      v: p.v,
    })),
    simulated: true,
    hasRange: true,
    hasVolume: true,
    interval: range === '1D' ? '5m' : '1d',
    source: 'simulated',
  };
}

/**
 * @param {{ assetClass: string, symbol: string, exchange?: string,
 *   priceCents?: number, vendorId?: string }} instrument
 * @param {string} range
 */
export async function getCandles(instrument, range = '1M') {
  if (!SUPPORTED_RANGES.includes(range)) range = '1M';

  const key = `${instrument.assetClass}:${instrument.symbol}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    const { expiresAt: _expiresAt, ...rest } = hit;
    return { ...rest, range };
  }

  // The exchange is half the question for equities — the plan serves NYSE and
  // NASDAQ and nothing else, so a venue that is not covered falls to the walk.
  const adapter = ADAPTERS.find((a) => a.covers(instrument.assetClass, instrument.exchange));
  // An adapter that cannot serve THIS range — forex has no intraday series —
  // falls through to the simulated walk rather than erroring, and the response
  // still says which it is.
  const usable = adapter?.supportsRange(range);

  if (!usable) {
    const result = simulated(instrument, range);
    remember(key, result, range);
    return { ...result, range };
  }

  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      adapter
        .fetchCandles(instrument, range)
        .then((result) => {
          remember(key, result, range);
          return result;
        })
        .catch((err) => {
          // A vendor outage degrades the chart to the simulated walk rather
          // than blanking it — and the label flips to "simulated", so the page
          // never presents the fallback as real history.
          console.warn(`candles: ${adapter.name} failed for ${key} (${err.message})`);
          const result = simulated(instrument, range);
          // Cached too, so a rate-limited vendor is retried once per window
          // instead of on every request.
          remember(key, result, range);
          return result;
        })
        .finally(() => inFlight.delete(key)),
    );
  }

  return { ...(await inFlight.get(key)), range };
}

/** Test seam. */
export function resetCandleCache() {
  cache.clear();
  inFlight.clear();
}
