import { WatchlistItem } from '../models/WatchlistItem.js';
import { ApiError } from '../lib/ApiError.js';
import { ASSET_CLASSES, getInstruments } from './market.service.js';

/**
 * The watchlist, across all three asset classes.
 *
 * Reads go through `market.service.js` rather than through Mongo, and that is
 * the whole reason this file exists. Equities have a `Stock` document to join
 * against; crypto and forex do not — those rows are vendor responses held in an
 * in-process cache — so the only thing the three classes have in common is the
 * shape `getInstruments` already returns. Resolving here means one code path
 * feeds the Markets table, the Portfolio card and this list, so a watched row
 * cannot render a different price from the same row one screen over.
 *
 * It costs nothing extra: the market cache is warm and shared, so enriching a
 * watchlist is a Map lookup per item, not a request per item.
 */

/**
 * A ceiling, because there is no pagination on the read and the Portfolio card
 * renders the whole list. High enough that nobody legitimately reaches it.
 */
export const MAX_WATCHLIST = 60;

/** Only the fields the two watchlist surfaces actually render. */
const publicRow = (item, row) => ({
  assetClass: item.assetClass,
  symbol: item.symbol,
  addedAt: item.createdAt,
  // An entry whose instrument no longer resolves is returned anyway — see
  // below. `resolved: false` is what the client keys the placeholder off.
  resolved: Boolean(row),
  name: row?.name ?? item.symbol,
  exchange: row?.exchange ?? '',
  currency: row?.currency ?? 'USD',
  logoUrl: row?.logoUrl ?? '',
  priceCents: row?.priceCents ?? 0,
  rate: row?.rate,
  changePct: row?.changePct ?? 0,
  status: row?.status ?? 'Listed',
  live: row?.live ?? false,
});

/**
 * Instruments for one class, keyed by symbol.
 *
 * `limit: 250` is the service's own ceiling and is deliberately the maximum: a
 * watched row has to be findable even when it sits below whatever the Markets
 * table happens to be showing.
 */
async function indexFor(assetClass) {
  const { items } = await getInstruments({ assetClass, limit: 250 });
  return new Map(items.map((i) => [i.symbol.toUpperCase(), i]));
}

/**
 * The user's list, newest first, each entry enriched with a live row.
 *
 * @param {import('mongoose').Types.ObjectId | string} userId
 */
export async function listWatchlist(userId) {
  const items = await WatchlistItem.find({ userId }).sort({ createdAt: -1 }).lean();
  if (items.length === 0) return [];

  // One vendor lookup per DISTINCT class, not per item — a 40-row list of
  // equities is one call, not forty.
  const classes = [...new Set(items.map((i) => i.assetClass))];
  const indexes = new Map(
    await Promise.all(
      classes.map(async (c) => /** @type {[string, Map<string, any>]} */ ([c, await indexFor(c)])),
    ),
  );

  return items.map((item) =>
    publicRow(item, indexes.get(item.assetClass)?.get(item.symbol.toUpperCase())),
  );
}

/**
 * Adds an instrument, idempotently.
 *
 * The symbol is checked against the class's real instrument list first, so the
 * list cannot fill up with typos that will never resolve — the placeholder path
 * in `publicRow` is for things that USED to exist, not for things that never
 * did.
 *
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {string} assetClass
 * @param {string} symbol
 */
export async function addToWatchlist(userId, assetClass, symbol) {
  if (!ASSET_CLASSES.includes(assetClass)) {
    throw ApiError.badRequest('BAD_ASSET_CLASS', `assetClass must be one of ${ASSET_CLASSES.join(', ')}`);
  }

  const key = String(symbol).toUpperCase();
  const row = (await indexFor(assetClass)).get(key);
  if (!row) throw ApiError.notFound(`No ${assetClass} listing ${key}`);

  // Counted before the write rather than after, so the cap cannot be crossed
  // and then reported. A benign race past it by one row is not worth a
  // transaction for a follow list.
  const count = await WatchlistItem.countDocuments({ userId });
  const exists = await WatchlistItem.exists({ userId, assetClass, symbol: key });
  if (!exists && count >= MAX_WATCHLIST) {
    throw ApiError.unprocessable(
      'WATCHLIST_FULL',
      `A watchlist holds at most ${MAX_WATCHLIST} instruments`,
    );
  }

  // Upsert, so adding something already there is a success and not a 409. The
  // unique index is what makes that safe under a double-tap.
  const item = await WatchlistItem.findOneAndUpdate(
    { userId, assetClass, symbol: key },
    { $setOnInsert: { userId, assetClass, symbol: key } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return publicRow(item, row);
}

/**
 * Removes an instrument. Removing something absent is a success — the client
 * fires this from an optimistic UI, and a 404 on a button that has already
 * visually completed would only produce a spurious rollback.
 *
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {string} assetClass
 * @param {string} symbol
 */
export async function removeFromWatchlist(userId, assetClass, symbol) {
  await WatchlistItem.deleteOne({
    userId,
    assetClass,
    symbol: String(symbol).toUpperCase(),
  });
}
