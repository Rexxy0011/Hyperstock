/**
 * Deterministic pseudo-randomness.
 *
 * Used by the seed (so `npm run seed` produces identical data every run) and by
 * the mock market provider (so every user sees the same simulated price at the
 * same instant, and a page reload doesn't jump the chart).
 */

/** 32-bit string hash — turns a symbol or username into a numeric seed. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for seeded fixtures. */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function rngFloat(rng, min, max) {
  return rng() * (max - min) + min;
}

export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
