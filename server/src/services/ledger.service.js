import { ApiError } from '../lib/ApiError.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { User } from '../models/User.js';

/**
 * Posting to the ledger, and the balance, as one operation.
 *
 * THE BALANCE MOVES FIRST, then the entry records the result. That order is
 * what lets `balanceAfterCents` be true rather than predicted — computing it
 * from a prior read would be wrong the moment two movements interleave, and
 * they do.
 *
 * The caller MUST pass a session. Not for tidiness: a balance that moved
 * without an entry, or an entry without the movement, is a ledger that no
 * longer reconciles, and there is no way to tell afterwards which of the two
 * happened. Callers already run inside `withTransaction` for their own reasons.
 */
export async function post({ userId, type, amountCents, reference, detail = '', session }) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw new Error(`ledger: amountCents must be a non-zero integer, got ${amountCents}`);
  }
  if (!reference) throw new Error('ledger: every entry needs a reference');

  /**
   * A DEBIT MAY NOT OVERDRAW, and the guard is the filter — the same shape the
   * order ledger uses. A read-then-check window would let two concurrent debits
   * both see a sufficient balance.
   */
  const filter =
    amountCents < 0
      ? { _id: userId, cashBalanceCents: { $gte: -amountCents } }
      : { _id: userId };

  const user = await User.findOneAndUpdate(
    filter,
    { $inc: { cashBalanceCents: amountCents } },
    { new: true, session },
  );

  if (!user) {
    throw ApiError.unprocessable('INSUFFICIENT_FUNDS', 'Not enough cash for that movement');
  }

  try {
    const [entry] = await LedgerEntry.create(
      [
        {
          userId,
          type,
          amountCents,
          balanceAfterCents: user.cashBalanceCents,
          reference,
          detail,
        },
      ],
      { session },
    );
    return { entry, balanceAfterCents: user.cashBalanceCents };
  } catch (err) {
    // The unique {type, reference} index is the backstop against a double
    // post. Inside a transaction this aborts the balance change with it, which
    // is precisely the behaviour wanted — the caller sees a conflict rather
    // than a silent second credit.
    if (err?.code === 11000) {
      throw ApiError.conflict('ALREADY_POSTED', `${type} ${reference} is already on the ledger`);
    }
    throw err;
  }
}

/** A user's statement, newest first. */
export async function statement(userId, { limit = 50 } = {}) {
  const rows = await LedgerEntry.find({ userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, limit)))
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    type: r.type,
    amountCents: r.amountCents,
    balanceAfterCents: r.balanceAfterCents,
    reference: r.reference,
    detail: r.detail,
    createdAt: r.createdAt,
  }));
}

/**
 * Does the sum of everything that happened still equal the balance?
 *
 * This is the check that makes a maintained projection safe to rely on. It is
 * not a formality — it is the only thing that would catch a code path that
 * moves `cashBalanceCents` without posting, which is exactly how a balance and
 * its history drift apart.
 *
 * Returns a report rather than throwing, so an operator endpoint and a test can
 * both use it. `opening` accounts for balances that predate the ledger.
 */
export async function reconcile(userId, { openingCents = 0 } = {}) {
  const [user, entries] = await Promise.all([
    User.findById(userId).lean(),
    LedgerEntry.find({ userId }).lean(),
  ]);

  const postedCents = entries.reduce((sum, e) => sum + e.amountCents, 0);
  const expectedCents = openingCents + postedCents;

  return {
    balanceCents: user?.cashBalanceCents ?? 0,
    postedCents,
    expectedCents,
    entries: entries.length,
    balanced: (user?.cashBalanceCents ?? 0) === expectedCents,
    driftCents: (user?.cashBalanceCents ?? 0) - expectedCents,
  };
}
