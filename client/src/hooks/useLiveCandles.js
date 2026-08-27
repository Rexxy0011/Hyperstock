import { useMemo } from 'react';
import { money } from '../lib/format';

/**
 * The candle series the chart draws, with the FORMING BAR PATCHED FROM THE
 * TICK STREAM.
 *
 * Lifted out of `pages/Instrument.jsx` when that page became the terminal:
 * this is the one piece of it that is pure data, and the page around it is now
 * entirely layout.
 */

/** The vendor bar widths, as milliseconds — see `interval` on the response. */
const INTERVAL_MS = {
  '5m': 5 * 60_000,
  '30m': 30 * 60_000,
  '4h': 4 * 3_600_000,
  '1d': 86_400_000,
  '4d': 4 * 86_400_000,
  '1w': 7 * 86_400_000,
};

const CAPTION = {
  coingecko: 'Real open/high/low/close from CoinGecko.',
  twelvedata: 'Real open/high/low/close and volume from Twelve Data.',
  frankfurter:
    'Real daily closes from the ECB. It publishes one rate per business day, so there is no intraday high or low to draw - the bars have no wicks.',
  // Reached by non-US equities only, now that Twelve Data covers NYSE and
  // NASDAQ. Finnhub 403s candles everywhere and Twelve Data's free plan is
  // US-only, so the other six venues have no free source at all.
  simulated:
    'No free provider sells candles for this venue.',
};

/**
 * This is what makes the chart live rather than merely recent. The vendor's
 * last bar was closed when it was fetched — up to ten minutes ago on a cached
 * daily range — so without this the right edge sits still while the headline
 * price above it moves, and the two visibly disagree.
 *
 * Only the last bar is touched, and only in the three ways a real forming bar
 * changes: the close follows the print, and the high and low extend if the
 * print exceeds them. The open never moves — it is history the moment the bar
 * opens. Earlier bars are settled and are never rewritten.
 */
export function useLiveCandles(data, assetClass, tick, connected) {
  return useMemo(() => {
    const source = data?.candles?.source ?? 'simulated';
    const raw = data?.candles?.points ?? [];
    const isForex = assetClass === 'forex';

    // Forex carries ten-thousandths so the fourth decimal survives; everything
    // else is integer cents. The divisor is declared by the server rather than
    // inferred, because guessing it silently mis-scales an entire axis.
    const divisor = data?.candles?.divisor ?? 100;
    // FX is quoted to four decimals, and to two once a pair trades above ~50
    // (USDJPY at 158.70, not 158.7000). Money is always two.
    const decimals = isForex ? ((data?.rate ?? 0) >= 50 ? 2 : 4) : 2;
    const format = isForex
      ? (v) => (v / divisor).toFixed(decimals)
      : (v) => money(Math.round(v), data?.currency);

    /**
     * The unit has to match the candle's. An FX tick carries a raw rate
     * (1.1699) and those bars are in ten-thousandths, so cents would be 100x
     * out.
     *
     * FALLS BACK TO THE POLLED PRICE when no tick has arrived yet, and that is
     * not cosmetic: candles are cached for up to ten minutes, so without it the
     * chart's last bar sits at the vendor's cached close while the headline
     * above shows the newer REST price. Measured on BTC: header $78,906 against
     * a chart reading $78,367 — two different answers to "what is it now" on
     * one card. The bar tracks the best current price available; `isLive` still
     * requires a real tick, so the pill does not overclaim.
     */
    const polled = isForex ? data?.rate : data?.priceUsdCents;
    const streamed = isForex ? tick?.price : tick?.priceCents;
    const nowValue = streamed ?? polled;
    const tickValue = isForex
      ? nowValue != null
        ? Math.round(nowValue * divisor)
        : null
      : nowValue;

    let points = raw;
    let patched = false;

    if (raw.length > 0 && Number.isFinite(tickValue) && tickValue > 0) {
      const last = raw[raw.length - 1];
      const stepMs = INTERVAL_MS[data?.candles?.interval] ?? 0;
      // A bar timestamp is the period's START, so a bar is still forming until
      // one interval has elapsed. Verified against both vendors: CoinGecko's
      // last 4h bar reads 3.0h old, and Frankfurter's last daily bar reads 83h
      // old on a Monday — Friday's publication, with the weekend behind it.
      const settled = stepMs > 0 && Date.now() - last.t >= stepMs;

      if (settled) {
        // A NEW BAR, not an edit. Writing the live rate into a bar that closed
        // three days ago would redraw settled history — and on forex that is
        // the normal case, not an edge one, because the ECB does not publish at
        // weekends. It opens at the previous close, which is what a real bar
        // does.
        points = [
          ...raw,
          {
            t: last.t + stepMs,
            o: last.c,
            h: Math.max(last.c, tickValue),
            l: Math.min(last.c, tickValue),
            c: tickValue,
            v: 0,
          },
        ];
      } else {
        points = [
          ...raw.slice(0, -1),
          {
            ...last,
            c: tickValue,
            // Only ever extends — a forming bar's high and low cannot retreat.
            h: Math.max(last.h, tickValue),
            l: Math.min(last.l, tickValue),
          },
        ];
      }
      patched = true;
    }

    // What the series actually spans, and what it did over that span — both
    // read off the drawn points, so they cannot disagree with the chart.
    const first = points[0];
    const last = points[points.length - 1];
    // `const` so the literals keep their narrow types — Intl's options want
    // "numeric" | "2-digit", and a plain object widens them to `string`.
    const dateFmt = /** @type {const} */ ({ month: 'short', day: 'numeric', year: 'numeric' });
    const spanLabel = points.length
      ? `${new Date(first.t).toLocaleDateString('en-US', dateFmt)} - ${new Date(last.t).toLocaleDateString('en-US', dateFmt)}`
      : '';
    // Open of the first bar to close of the last: the period return, which is
    // a different number from the row's 24h `changePct` and must not reuse it.
    const periodPct =
      points.length && first.o > 0 ? ((last.c - first.o) / first.o) * 100 : null;

    return {
      points,
      divisor,
      decimals,
      interval: data?.candles?.interval ?? '',
      range: data?.candles?.range ?? '',
      spanLabel,
      periodPct,
      hasRange: data?.candles?.hasRange ?? true,
      hasVolume: data?.candles?.hasVolume ?? false,
      format,
      // "Live" means a tick is actually reaching this bar — not merely that the
      // socket is up. Forex and crypto stream; a closed equity venue does not,
      // and claiming Live over a bar nothing is moving is the failure the
      // Markets pill already exists to avoid.
      // `patched` alone is not enough now that the polled price also patches
      // the bar — Live must mean a TICK reached this symbol, or a closed venue
      // would claim it off a REST fallback that has not moved in hours.
      isLive: connected && patched && streamed != null,
      caption: CAPTION[source] ?? CAPTION.simulated,
    };
  }, [data, assetClass, tick, connected]);
}
