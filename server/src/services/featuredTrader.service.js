import { FeaturedTrader } from '../models/FeaturedTrader.js';
import { User } from '../models/User.js';
import { ApiError } from '../lib/ApiError.js';

/**
 * Curated leaderboard rows — read into the board, written from the admin.
 *
 * The merge is the interesting half. Everything else here is CRUD.
 */

/**
 * A featured row wearing the exact shape `getLeaderboard` hands the client.
 *
 * WHY EVERY FIELD IS FILLED RATHER THAN LEFT UNDEFINED. Both surfaces render a
 * curated row through the same component as a computed one — `trades` has
 * `.toLocaleString()` called on it, `best.symbol` decides between a ticker and
 * an em dash — so a missing field is not a blank cell, it is a crash or a
 * visible tell. The row is built complete on the server so no call site has to
 * know which kind it is holding.
 *
 * `rank` is deliberately absent: it is assigned by the merge, against the whole
 * board, and a rank written here would be a second opinion about position.
 */
export function toBoardRow(doc) {
  const name = doc.name;
  const changePct = doc.changePct ?? 0;
  const valueCents = doc.portfolioValueCents ?? 0;

  /**
   * DERIVED, NEVER TYPED. The day's cash move is `value − value/(1 + pct/100)`,
   * which is exactly the figure the percentage claims. Asking an operator for
   * both invites a row whose own two numbers contradict each other — the same
   * defect the ticker pill had when its price and percentage came from
   * different writers.
   */
  const dayChangeCents =
    changePct <= -100 ? valueCents : Math.round(valueCents - valueCents / (1 + changePct / 100));

  return {
    userId: String(doc._id),
    // The leaderboard table renders `username` and the Landing panel renders
    // `name`, so both carry the curated name rather than one of them exposing
    // an internal handle.
    username: name,
    displayName: name,
    name,
    avatarLetter: (name[0] ?? '?').toUpperCase(),
    trades: doc.trades ?? 0,
    portfolioValueCents: valueCents,
    returnPct: round2(changePct),
    dayChangePct: round2(changePct),
    dayChangeCents,
    // A curated row stands for no holdings, so the derived book statistics are
    // zeroed rather than invented — nothing on either surface renders them.
    exchanges: 0,
    wins: 0,
    positions: 0,
    winSharePct: 0,
    best: {
      symbol: doc.bestSymbol || null,
      returnPct: round2(doc.bestReturnPct ?? 0),
    },
    /**
     * Marks the row's origin in the payload even though neither surface renders
     * a badge today. Without it the decision to label curated rows could never
     * be revisited without a schema change, and an API consumer would have no
     * way to tell the two apart at all.
     */
    featured: true,
  };
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Places curated rows on the board and re-ranks everything together.
 *
 * TWO RULES, AND THE FIRST IS THE ONE THAT MATTERS:
 *
 * 1. A row carrying `userId` REPLACES that user's computed row. It does not sit
 *    beside it. One account appearing twice at two different values is the one
 *    outcome that reads as a bug rather than as curation.
 *
 * 2. Ranking is by value across the merged list, so a curated row competes on
 *    the figure that was typed instead of being pinned above the board. Ties
 *    share a rank and the next distinct value skips — matching `$rank`, which
 *    is what produced the ranks in the rows being merged into.
 *
 * The input array is not mutated: it is the memoised board, and sorting it in
 * place would reorder the cache for every subsequent caller.
 */
export function mergeFeatured(rows, featuredDocs) {
  if (!featuredDocs.length) return rows;

  const overridden = new Set(
    featuredDocs.filter((d) => d.userId).map((d) => String(d.userId)),
  );

  const merged = [
    ...rows.filter((r) => !overridden.has(String(r.userId))),
    ...featuredDocs.map(toBoardRow),
  ].sort((a, b) => b.portfolioValueCents - a.portfolioValueCents);

  let rank = 0;
  let prevValue = null;
  return merged.map((row, i) => {
    if (row.portfolioValueCents !== prevValue) {
      rank = i + 1;
      prevValue = row.portfolioValueCents;
    }
    return { ...row, rank };
  });
}

/** Active rows only — what the board merges. Lean, since it is read per request. */
export function listActiveFeatured() {
  return FeaturedTrader.find({ active: true }).lean();
}

/** Everything, newest first — what the admin screen lists. */
export function listAllFeatured() {
  return FeaturedTrader.find().sort({ portfolioValueCents: -1 }).lean();
}

/**
 * Refuses a link to an account that does not exist.
 *
 * An override keyed on a stale id silently does nothing: the row still appears,
 * but the user it was meant to replace appears too, so the board shows the same
 * trader twice. Better to reject the write than to publish that.
 */
async function assertUserExists(userId) {
  if (!userId) return;
  const exists = await User.exists({ _id: userId });
  if (!exists) throw ApiError.badRequest('NO_SUCH_USER', 'That trader account does not exist.');
}

export async function createFeatured(input, adminId) {
  await assertUserExists(input.userId);
  try {
    const doc = await FeaturedTrader.create({ ...input, updatedBy: adminId });
    return doc.toObject();
  } catch (err) {
    // The unique partial index over `userId` is the guard, not a prior read —
    // two admins overriding the same account race otherwise.
    if (err?.code === 11000) {
      throw ApiError.conflict('ALREADY_FEATURED', 'That trader is already featured.');
    }
    throw err;
  }
}

export async function updateFeatured(id, patch, adminId) {
  await assertUserExists(patch.userId);
  try {
    const doc = await FeaturedTrader.findByIdAndUpdate(
      id,
      { ...patch, updatedBy: adminId },
      { new: true, runValidators: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Featured trader not found.');
    return doc;
  } catch (err) {
    if (err?.code === 11000) {
      throw ApiError.conflict('ALREADY_FEATURED', 'That trader is already featured.');
    }
    throw err;
  }
}

export async function deleteFeatured(id) {
  const doc = await FeaturedTrader.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound('Featured trader not found.');
  return { id };
}

/**
 * Account picker for the admin form.
 *
 * Capped and matched on a prefix rather than a bare substring so the query can
 * use the index — this runs on every keystroke behind a debounce, over 200-odd
 * users today and an unbounded number later.
 */
export async function searchTraders(q, limit = 10) {
  const term = String(q ?? '').trim();
  if (!term) return [];

  // Escaped: the term reaches a regex, and a user-supplied `(` is a 500.
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`^${safe}`, 'i');

  const rows = await User.find({ role: 'user', $or: [{ username: rx }, { displayName: rx }] })
    .select('username displayName portfolioValueCents')
    .limit(limit)
    .lean();

  return rows.map((u) => ({
    userId: String(u._id),
    username: u.username,
    displayName: u.displayName || u.username,
  }));
}
