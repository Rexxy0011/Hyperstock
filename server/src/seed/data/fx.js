/**
 * Fallback FX rates: units of USD per 1 unit of the given currency.
 *
 * The market layer refreshes these live every 10 minutes. They exist so that
 * `npm run seed` runs with no network and produces byte-identical data — which
 * is what lets the seed pin jd_trader's portfolio to exactly $12,220.64.
 */
export const SEED_FX = {
  USD: 1,
  EUR: 1.09,
  GBP: 1.27,
  JPY: 0.0068,
  HKD: 0.128,
  CNY: 0.1385,
};
