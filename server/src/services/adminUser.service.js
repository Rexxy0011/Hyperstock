import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { ApiError } from '../lib/ApiError.js';

/**
 * The user listing behind /admin/users.
 *
 * THE COLUMN THIS SCREEN EXISTS FOR IS `canSignIn`. Since Better Auth took over,
 * a credential is a row in `accounts`, not a field on the user — so "can this
 * person log in" stopped being visible anywhere. 209 user documents look
 * identical in the database and two of them hold a password. That distinction
 * is the difference between a real account and a leaderboard fixture, and
 * nothing in the product said which was which.
 *
 * It is computed by joining `accounts`, never stored. A stored flag needs a
 * writer on the signup path, the credential-migration path and the deletion
 * path, and one of the three would eventually be forgotten — the same reasoning
 * `subscriber.service.js` gives for computing `converted` on every read.
 */

const PAGE_SIZE = 25;

/** Escapes a user-supplied search string so it cannot act as a regex. */
const literal = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exactly the fields an operator needs and nothing else.
 *
 * `passwordHash` is excluded by the schema's `select: false` and is not named
 * here either — belt and braces on the one field that must never travel. There
 * is no session token, no `accounts.password` and no unsubscribe token in this
 * shape: an admin listing needs to know that a credential EXISTS, never what it
 * is.
 */
const publicRow = (user, canSignIn) => ({
  id: String(user._id),
  username: user.username,
  displayName: user.displayName ?? null,
  name: user.name ?? null,
  email: user.email,
  role: user.role,
  status: user.status,
  cashBalanceCents: user.cashBalanceCents,
  tradeCount: user.tradeCount,
  emailVerified: Boolean(user.emailVerified),
  createdAt: user.createdAt,
  canSignIn,
});

/**
 * @param {{ q?: string, page?: number, limit?: number }} [options]
 */
export async function listUsers({ q = '', page = 1, limit = PAGE_SIZE } = {}) {
  const size = Math.min(100, Math.max(1, limit));
  const current = Math.max(1, page);

  const term = q.trim();
  const filter = term
    ? {
        $or: [
          { username: { $regex: literal(term), $options: 'i' } },
          { email: { $regex: literal(term), $options: 'i' } },
          { displayName: { $regex: literal(term), $options: 'i' } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((current - 1) * size)
      .limit(size)
      .lean(),
    User.countDocuments(filter),
  ]);

  /**
   * ONE QUERY FOR THE WHOLE PAGE, not one per row. Twenty-five sequential
   * `findOne`s against `accounts` is the shape that looks free on a seeded
   * database and is not — the same note `/admin/queues` carries about counting
   * with `.length`.
   */
  const withCredentials = new Set(
    (
      await mongoose.connection
        .collection('accounts')
        .find({ userId: { $in: rows.map((r) => r._id) } })
        .project({ userId: 1 })
        .toArray()
    ).map((a) => String(a.userId)),
  );

  return {
    items: rows.map((r) => publicRow(r, withCredentials.has(String(r._id)))),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * The headline counts.
 *
 * `withCredentials` is a count over `accounts` rather than over users, because
 * that collection IS the answer — one row per sign-in method. It is the figure
 * that explains the gap between "209 accounts" and "2 people who can log in".
 */
export async function userCounts() {
  const [total, admins, suspended, withCredentials] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ status: 'Suspended' }),
    mongoose.connection.collection('accounts').countDocuments({ providerId: 'credential' }),
  ]);
  return { total, admins, suspended, withCredentials, fixtures: total - withCredentials };
}

const STATUSES = ['Active', 'Flagged', 'Suspended'];

/**
 * Changes an account's status, which is the only write this screen offers.
 *
 * ROLE IS DELIBERATELY NOT EDITABLE HERE. Granting `admin` from a table row is
 * a privilege escalation one misclick wide, and unlike a suspension it cannot
 * be noticed by the person it happened to. It belongs behind its own deliberate
 * flow if it is ever wanted.
 *
 * AN ADMIN CANNOT SUSPEND THEMSELVES. With one administrator — which is what
 * this database has — that single click removes the only account that could
 * undo it, and the recovery is a database edit. The guard is on the actor, not
 * on the role, so it still holds when there are several.
 *
 * Suspension takes effect on the NEXT REQUEST regardless of this function:
 * `requireAuth` reloads the user and refuses `Suspended`. The session rows are
 * deleted anyway, because leaving them means the account is refused while its
 * session sits there valid — two answers to "is this person signed in", and the
 * database should carry the one the product means.
 */
export async function setUserStatus(userId, status, actingAdminId) {
  if (!STATUSES.includes(status)) {
    throw ApiError.badRequest('BAD_STATUS', 'Unknown status', { status });
  }
  if (String(userId) === String(actingAdminId)) {
    throw ApiError.badRequest(
      'SELF_STATUS_CHANGE',
      'You cannot change your own account status',
    );
  }

  const user = await User.findByIdAndUpdate(userId, { $set: { status } }, { new: true }).lean();
  if (!user) throw ApiError.notFound('No such user', 'USER_NOT_FOUND');

  let sessionsRevoked = 0;
  if (status === 'Suspended') {
    const result = await mongoose.connection
      .collection('sessions')
      .deleteMany({ userId: user._id });
    sessionsRevoked = result.deletedCount ?? 0;
  }

  const canSignIn = Boolean(
    await mongoose.connection
      .collection('accounts')
      .findOne({ userId: user._id, providerId: 'credential' }),
  );

  return { user: publicRow(user, canSignIn), sessionsRevoked };
}
