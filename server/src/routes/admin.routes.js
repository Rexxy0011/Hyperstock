import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  listAllFeatured,
  createFeatured,
  updateFeatured,
  deleteFeatured,
  searchTraders,
} from '../services/featuredTrader.service.js';
import { queueCounts } from '../services/adminQueue.service.js';
import { listSubscribers, subscriberCounts } from '../services/subscriber.service.js';
import { listUsers, userCounts, setUserStatus } from '../services/adminUser.service.js';

/**
 * The curated-leaderboard admin.
 *
 * `requireAdmin` is applied at the ROUTER, not per handler — a guard repeated
 * on each route is a guard that will eventually be forgotten on one of them,
 * and the mistake is silent. Same shape as the deposit and withdrawal queues.
 */
const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * Money arrives as a decimal string of DOLLARS from the form and is converted
 * once, here, at the boundary — everything past this point is integer cents,
 * as the rest of the codebase is. `Math.round` rather than a cast, because
 * `184250.10 * 100` is 18425009.999999998 in binary floating point.
 */
const dollarsToCents = z
  .union([z.string(), z.number()])
  .transform((v) => Math.round(Number(v) * 100))
  .refine((c) => Number.isFinite(c) && c >= 0, 'Must be a positive amount');

const featuredBody = z.object({
  name: z.string().trim().min(1).max(60),
  // Null and absent both mean "standalone row"; the client sends null when a
  // linked account is cleared, and absent when it was never set.
  userId: z.string().trim().min(1).nullish(),
  portfolioValueCents: dollarsToCents,
  // Bounded below at -100: a position cannot lose more than all of itself, and
  // the derived cash figure divides by (1 + pct/100).
  changePct: z.coerce.number().min(-99.99).max(100_000),
  trades: z.coerce.number().int().min(0).max(1_000_000).default(0),
  bestSymbol: z.string().trim().max(12).default(''),
  bestReturnPct: z.coerce.number().min(-100).max(100_000).default(0),
  active: z.coerce.boolean().default(true),
});

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id') });

/**
 * The three outstanding counts, for the dashboard and the nav badge.
 *
 * One request rather than three listings the client counts itself: the badge
 * needs an integer, and fetching 150 documents to call `.length` on them three
 * times is the sort of thing that looks free on a seeded database and is not.
 */
router.get(
  '/queues',
  asyncHandler(async (req, res) => {
    res.json(await queueCounts());
  }),
);

/**
 * Every account, with the one thing that stopped being visible when Better Auth
 * took over credentials: whether the row can actually sign in.
 *
 * The counts ride along on the same response rather than a second endpoint —
 * they are four `countDocuments` against a listing the caller is already
 * waiting on, and a separate request would render the header a beat after the
 * table for no benefit.
 */
router.get(
  '/users',
  validate({
    query: z.object({
      q: z.string().trim().max(60).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validatedQuery;
    const [listing, counts] = await Promise.all([listUsers({ q, page, limit }), userCounts()]);
    res.json({ ...listing, counts });
  }),
);

/**
 * The only write this screen offers. Role is not editable — see the note in
 * `adminUser.service.js` on why granting admin from a table row is not a thing
 * that should be one misclick wide.
 */
router.patch(
  '/users/:id/status',
  validate({
    params: idParam,
    body: z.object({ status: z.enum(['Active', 'Flagged', 'Suspended']) }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await setUserStatus(req.params.id, req.body.status, req.user.id));
  }),
);

/** Addresses captured by the marketing CTAs. */
router.get(
  '/subscribers',
  asyncHandler(async (req, res) => {
    const [items, counts] = await Promise.all([listSubscribers(), subscriberCounts()]);
    res.json({ items, ...counts });
  }),
);

router.get(
  '/featured-traders',
  asyncHandler(async (req, res) => {
    res.json({ items: await listAllFeatured() });
  }),
);

/** Account picker for the "override an existing trader" mode. */
router.get(
  '/traders',
  validate({ query: z.object({ q: z.string().trim().max(60).optional() }) }),
  asyncHandler(async (req, res) => {
    res.json({ items: await searchTraders(req.validatedQuery.q) });
  }),
);

router.post(
  '/featured-traders',
  validate({ body: featuredBody }),
  asyncHandler(async (req, res) => {
    const doc = await createFeatured(req.body, req.user.id);
    res.status(201).json(doc);
  }),
);

router.patch(
  '/featured-traders/:id',
  validate({ params: idParam, body: featuredBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(await updateFeatured(req.params.id, req.body, req.user.id));
  }),
);

router.delete(
  '/featured-traders/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await deleteFeatured(req.params.id));
  }),
);

export default router;
