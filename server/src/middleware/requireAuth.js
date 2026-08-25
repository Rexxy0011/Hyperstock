import { User } from '../models/User.js';
import { ApiError } from '../lib/ApiError.js';
import { verifyAccessToken } from '../lib/jwt.js';

function readToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

async function resolveUser(token) {
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  // A bumped tokenVersion revokes every access token already in the wild.
  if ((user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
    throw ApiError.unauthorized('Session expired', 'TOKEN_REVOKED');
  }
  return user;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) throw ApiError.unauthorized();

    const user = await resolveUser(token);
    if (user.status === 'Suspended') {
      throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    }

    req.user = { ...user, id: String(user._id) };
    next();
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED'));
    }
    if (err?.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Invalid access token'));
    }
    next(err);
  }
}

/** Attaches req.user when a valid token is present, but never rejects.
 *  Used by the leaderboard so anonymous callers still get the public board. */
export async function optionalAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (token) {
      const user = await resolveUser(token);
      req.user = { ...user, id: String(user._id) };
    }
  } catch {
    // Ignore — the caller is simply treated as anonymous.
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(ApiError.forbidden('Admin access required'));
  next();
}
