import { fromNodeHeaders } from 'better-auth/node';
import { User } from '../models/User.js';
import { ApiError } from '../lib/ApiError.js';
import { getAuth } from '../auth/betterAuth.js';

/**
 * Session checking, now backed by Better Auth.
 *
 * WHAT CHANGED IS THE VALIDATION, NOT THE SHAPE. `req.user` is still the full
 * Mongoose document with `_id` as an ObjectId, because twenty-five call sites
 * across the routes pass `req.user._id` straight into a Mongoose query. Better
 * Auth hands back `user.id` as a hex STRING — its adapter converts on read —
 * so returning its object directly would have turned every one of those into a
 * silent no-match rather than an error.
 *
 * The extra lookup is not extra: the old code did `User.findById` on every
 * request too, to check `tokenVersion`. This spends the same query and gets the
 * Mongoose validators, virtuals and the `toJSON` transform that strips
 * `passwordHash` along with it.
 *
 * `tokenVersion` is gone and nothing replaces it. It existed to invalidate
 * access tokens that had already been handed out, which is only a problem when
 * the token is self-contained. Better Auth's sessions are rows: revoking one is
 * a delete, and it takes effect on the next request rather than at the end of a
 * fifteen-minute window.
 */
async function sessionUser(req) {
  const result = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!result?.user?.id) return null;

  const user = await User.findById(result.user.id).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  return user;
}

export async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) throw ApiError.unauthorized();

    if (user.status === 'Suspended') {
      throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    }

    req.user = { ...user, id: String(user._id) };
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches req.user when a valid session is present, but never rejects.
 *  Used by the leaderboard so anonymous callers still get the public board. */
export async function optionalAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (user) req.user = { ...user, id: String(user._id) };
  } catch {
    // Ignore — the caller is simply treated as anonymous.
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(ApiError.forbidden('Admin access required'));
  next();
}
