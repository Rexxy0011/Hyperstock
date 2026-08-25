import { env } from '../../config/env.js';
import { toCents, toNanos } from '../../lib/money.js';

/**
 * Crypto prices from CoinGecko. No key, and no key is the point: Finnhub can
 * serve crypto (BINANCE:BTCUSDT quotes 200 on the free tier) but only one
 * symbol per call, so a fifty-row table would be fifty requests against a
 * 60/minute budget already spent on news. This is one request for the lot.
 *
 * It also carries what Finnhub's quote endpoint does not — name, logo, market
 * cap and 24h volume — which is what the Markets table needs to show anything
 * beyond a number.
 */
const URL = 'https://api.coingecko.com/api/v3/coins/markets';

/** Enough to fill the tab without paging; CoinGecko allows up to 250. */
const COUNT = 50;

export const name = 'coingecko';

export async function fetchRows() {
  const qs = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(COUNT),
    page: '1',
    price_change_percentage: '24h',
  });

  const res = await fetch(`${URL}?${qs}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('coingecko: expected an array');

  return rows
    .filter((c) => Number.isFinite(c?.current_price))
    .map((c) => ({
      assetClass: /** @type {const} */ ('crypto'),
      symbol: String(c.symbol ?? '').toUpperCase(),
      name: String(c.name ?? ''),
      /**
       * CoinGecko's own slug — "bitcoin", not "BTC". Carried because the OHLC
       * endpoint is keyed by it (`/coins/bitcoin/ohlc`) and there is no way to
       * derive it from the ticker: BTC is "bitcoin" but TON is "the-open-
       * network". Without this the candle adapter would have to re-fetch the
       * whole markets list just to translate a symbol.
       */
      vendorId: String(c.id ?? ''),
      // The venue column. Crypto has no listing exchange in the equities
      // sense, so it carries the market it is quoted against instead.
      exchange: 'Crypto',
      currency: 'USD',
      logoUrl: String(c.image ?? ''),

      // Cents, like every other price in this codebase — BTC at $77,207.10
      // becomes 7_720_710. Sub-cent alt-coins round to 0 and are dropped
      // below, because a row reading $0.00 is worse than no row.
      priceCents: toCents(c.current_price),
      priceUsdCents: toCents(c.current_price),
      // The SAME price without the rounding, for the ledger. Cents cannot
      // carry this list: measured on the live top 50, RAIN quotes at 1 cent
      // and CRO at 6, so an order priced off `priceUsdCents` would be wrong by
      // tens of percent on the cheapest coins. See lib/money.js.
      priceUsdNanos: toNanos(c.current_price),
      changePct: Number(c.price_change_percentage_24h ?? 0),

      marketCap: Number(c.market_cap ?? 0),
      volume: Number(c.total_volume ?? 0),
      status: /** @type {const} */ ('Listed'),
      live: true,
    }))
    .filter((r) => r.priceUsdCents > 0);
}
