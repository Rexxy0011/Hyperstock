import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/** Refresh tokens are opaque random strings — we never need to read claims out
 *  of them, only match their hash against a stored record. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function refreshExpiry() {
  const ttl = env.REFRESH_TOKEN_TTL;
  const days = Number(ttl.replace('d', '')) || 7;
  return new Date(Date.now() + days * 86_400_000);
}

export const REFRESH_COOKIE = 'hs_refresh';

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  expires: refreshExpiry(),
});
