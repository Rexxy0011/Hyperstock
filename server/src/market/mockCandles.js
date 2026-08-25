import { makeRng } from '../lib/prng.js';

/**
 * Deterministic OHLC series, anchored on each stock's seeded price.
 *
 * This is the `mock` provider's candle generator, built early so the dashboard
 * chart has something real-shaped to draw. It is seeded per {symbol, range},
 * so every client sees an identical series and a page reload does not reshuffle
 * the chart. The live Yahoo adapter replaces this behind the same interface.
 */

/**
 * points x stepMs must equal the span the label claims — a "1 Week" range that
 * actually covers three days makes the x-axis repeat the same date.
 *   1D  6.5h (one session)   1W  7d   1M  30d   3M  90d   1Y  ~1y   ALL  5y
 */
const RANGES = {
  '1D': { points: 78, stepMs: 5 * 60_000, vol: 0.0018 },
  '1W': { points: 56, stepMs: 3 * 3_600_000, vol: 0.004 },
  '1M': { points: 30, stepMs: 86_400_000, vol: 0.011 },
  '3M': { points: 90, stepMs: 86_400_000, vol: 0.012 },
  '1Y': { points: 252, stepMs: 86_400_000, vol: 0.014 },
  ALL: { points: 260, stepMs: 7 * 86_400_000, vol: 0.025 },
};

export const SUPPORTED_RANGES = Object.keys(RANGES);

export function generateCandles(symbol, currentPriceCents, range = '1M', now = Date.now()) {
  const spec = RANGES[range] ?? RANGES['1M'];
  const rng = makeRng(`${symbol}:${range}`);

  // Walk BACKWARDS from the live price so the series always terminates at the
  // real current quote — the chart's right edge matches the headline number.
  const closes = [currentPriceCents];
  for (let i = 1; i < spec.points; i++) {
    const drift = (rng() - 0.5) * 2 * spec.vol;
    // Mild mean reversion keeps long ranges from wandering somewhere absurd.
    const pull = (currentPriceCents - closes[0]) / currentPriceCents / spec.points;
    closes.unshift(closes[0] / (1 + drift + pull));
  }

  const points = closes.map((close, i) => {
    const t = now - (spec.points - 1 - i) * spec.stepMs;
    const prev = i === 0 ? close : closes[i - 1];
    const spread = close * spec.vol * (0.4 + rng());
    return {
      t,
      oCents: cents(prev),
      hCents: cents(Math.max(prev, close) + spread),
      lCents: cents(Math.min(prev, close) - spread),
      cCents: cents(close),
      v: Math.round(400_000 + rng() * 3_600_000),
    };
  });

  return { range, points, simulated: true };
}

/** Candle prices are integer cents, like every other money value. */
const cents = (n) => Math.max(0, Math.round(n));
