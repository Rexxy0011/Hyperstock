import { Deposit, DEPOSIT_STATUS } from '../models/Deposit.js';
import { Withdrawal, WITHDRAWAL_STATUS } from '../models/Withdrawal.js';
import { TopUpRequest } from '../models/TopUpRequest.js';

/**
 * The approvals queues, seen from the operator's side.
 *
 * WHOSE MONEY IS IT. Every `publicDeposit`/`publicWithdrawal`/`publicRequest`
 * shape was written for the person who owns the row, so none of them carries an
 * account — correct for a user reading their own deposit, and unusable for a
 * queue. An operator approving a deposit is CREDITING A SPECIFIC ACCOUNT, and
 * doing that without being shown which one is the kind of gap that only reveals
 * itself after the money has moved. So the admin listings join the user, and
 * this is the one place that decides what an operator is allowed to see of it.
 *
 * Deliberately not the whole user document: a queue needs to identify a person
 * and contact them, not read their balance.
 */
export function traderOf(u) {
  if (!u || typeof u !== 'object' || !u._id) return null;
  return {
    userId: String(u._id),
    username: u.username,
    displayName: u.displayName || u.username,
    email: u.email,
  };
}

/** What `.populate()` is allowed to pull back. */
export const TRADER_FIELDS = 'username displayName email';

/**
 * The three counts a dashboard leads with.
 *
 * Counted, not fetched — the badge needs a number and pulling three 50-row
 * listings to call `.length` on them is three queries' worth of documents for
 * one integer each. `countDocuments` uses the status index on all three.
 *
 * The statuses are the ones that WAIT ON AN OPERATOR, which is not the same as
 * "not finished": an `awaiting_payment` deposit is waiting on the depositor and
 * has no business inflating a queue nobody can act on.
 */
export async function queueCounts() {
  const [deposits, withdrawals, topups] = await Promise.all([
    Deposit.countDocuments({ status: DEPOSIT_STATUS.UNDER_REVIEW }),
    // Both the unclaimed and the in-progress: a row an operator has claimed and
    // not finished is still outstanding work, and hiding it is how a claimed
    // withdrawal sits forgotten with the user's cash already debited.
    Withdrawal.countDocuments({
      status: { $in: [WITHDRAWAL_STATUS.REQUESTED, WITHDRAWAL_STATUS.UNDER_REVIEW] },
    }),
    TopUpRequest.countDocuments({ status: 'Pending' }),
  ]);

  return { deposits, withdrawals, topups, total: deposits + withdrawals + topups };
}
