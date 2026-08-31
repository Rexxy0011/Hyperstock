import { env } from "../../config/env.js";
import { toCents, toNanos } from "../../lib/money.js";
import { SEED_CRYPTO } from "../../seed/data/crypto.js";

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
const URL = "https://api.coingecko.com/api/v3/coins/markets";

/** Enough to fill the tab without paging; CoinGecko allows up to 250. */
const COUNT = 50;

export const name = "coingecko";

const fallbackRows = () =>
  SEED_CRYPTO.map((c) => ({
    assetClass: /** @type {const} */ ("crypto"),
    symbol: c.symbol,
    name: c.name,
    vendorId: c.vendorId,
    exchange: "Crypto",
    currency: "USD",
    logoUrl: c.logoUrl,
    priceCents: toCents(c.price),
    priceUsdCents: toCents(c.price),
    priceUsdNanos: toNanos(c.price),
    changePct: c.changePct,
    marketCap: c.marketCap,
    volume: c.volume,
    status: /** @type {const} */ ("Listed"),
    live: false,
  }));

export async function fetchRows() {
  const qs = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: String(COUNT),
    page: "1",
    price_change_percentage: "24h",
  });

  try {
    const res = await fetch(`${URL}?${qs}`, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(env.MARKET_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `coingecko provider HTTP ${res.status} — using fallback crypto fixtures`
      );
      return fallbackRows();
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return fallbackRows();
    }

    return rows
      .filter((c) => Number.isFinite(c?.current_price))
      .map((c) => ({
        assetClass: /** @type {const} */ ("crypto"),
        symbol: String(c.symbol ?? "").toUpperCase(),
        name: String(c.name ?? ""),
        vendorId: String(c.id ?? ""),
        exchange: "Crypto",
        currency: "USD",
        logoUrl: String(c.image ?? ""),
        priceCents: toCents(c.current_price),
        priceUsdCents: toCents(c.current_price),
        priceUsdNanos: toNanos(c.current_price),
        changePct: Number(c.price_change_percentage_24h ?? 0),
        marketCap: Number(c.market_cap ?? 0),
        volume: Number(c.total_volume ?? 0),
        status: /** @type {const} */ ("Listed"),
        live: true,
      }))
      .filter((r) => r.priceUsdCents > 0);
  } catch (err) {
    console.warn(
      `coingecko fetch error: ${err.message} — using fallback crypto fixtures`
    );
    return fallbackRows();
  }
}
