import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { SEED_CASH_CENTS } from '../config/env.js';
import { User } from '../models/User.js';
import { Transaction } from '../models/Transaction.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../lib/ApiError.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiry,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from '../lib/jwt.js';
import crypto from 'node:crypto';

const router = Router();

const attemptLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' } },
});

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const registration = credentials.extend({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'Letters, numbers and underscores only'),
});

/** The shape GET /me returns — never includes passwordHash or tokenVersion. */
const publicUser = (u) => ({
  id: String(u._id),
  username: u.username,
  email: u.email,
  role: u.role,
  status: u.status,
  cashBalanceCents: u.cashBalanceCents,
  tradeCount: u.tradeCount,
  createdAt: u.createdAt,
  avatarLetter: u.username[0].toUpperCase(),
});

/**
 * Issues a fresh refresh token, records its hash, and sets the cookie.
 * @param {string} [familyId] shared by every token descended from one login
 */
async function issueSession(res, user, familyId = crypto.randomUUID()) {
  const refresh = generateRefreshToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refresh),
    familyId,
    expiresAt: refreshExpiry(),
  });
  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
  return signAccessToken(user);
}

router.post(
  '/register',
  attemptLimiter,
  validate({ body: registration }),
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    const clash = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] }).lean();
    if (clash) {
      const field = clash.email === email.toLowerCase() ? 'email' : 'username';
      throw ApiError.conflict('DUPLICATE', `That ${field} is already registered`, { field });
    }

    const user = await User.create({
      username,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      cashBalanceCents: SEED_CASH_CENTS,
    });

    // Every account starts with the grant on its ledger, so the Wallet screen
    // reads correctly from the very first visit.
    await Transaction.create({
      userId: user._id,
      type: 'Top-up',
      detail: 'Initial virtual capital',
      amountCents: SEED_CASH_CENTS,
      status: 'Approved',
    });

    const accessToken = await issueSession(res, user);
    res.status(201).json({ user: publicUser(user), accessToken });
  }),
);

router.post(
  '/login',
  attemptLimiter,
  validate({ body: credentials }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    // Compare regardless of whether the user exists, so response time doesn't
    // reveal which emails are registered.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? '$2a$10$invalidsaltinvalidsaltuu');
    if (!user || !ok) throw ApiError.unauthorized('Email or password is incorrect', 'BAD_CREDENTIALS');

    if (user.status === 'Suspended') {
      throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    }

    const accessToken = await issueSession(res, user);
    res.json({ user: publicUser(user), accessToken });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw ApiError.unauthorized('No refresh token', 'NO_REFRESH');

    const record = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!record || record.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token expired', 'REFRESH_EXPIRED');
    }

    // A token presented twice means the cookie leaked. Revoke the whole family
    // rather than just this one, which logs the attacker AND the victim out.
    if (record.revokedAt) {
      await RefreshToken.updateMany(
        { familyId: record.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      throw ApiError.unauthorized('Refresh token reused', 'REFRESH_REUSED');
    }

    const user = await User.findById(record.userId);
    if (!user) throw ApiError.unauthorized('Account no longer exists');

    // Rotate: this token is spent, a new one takes its place in the family.
    const accessToken = await issueSession(res, user, record.familyId);
    record.revokedAt = new Date();
    await record.save();

    res.json({ accessToken, user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      await RefreshToken.updateOne({ tokenHash: hashToken(raw) }, { $set: { revokedAt: new Date() } });
    }
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), expires: undefined });
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(publicUser(req.user));
  }),
);

/** Always 202, whether or not the address exists — no account enumeration. */
router.post(
  '/forgot-password',
  attemptLimiter,
  validate({ body: z.object({ email: z.string().email() }) }),
  asyncHandler(async (req, res) => {
    res.status(202).json({ message: 'If that address has an account, a reset link is on its way.' });
  }),
);

export default router;
