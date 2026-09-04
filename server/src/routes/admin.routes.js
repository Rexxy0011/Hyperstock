import express, { Router } from 'express';
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
  upsertOverrideForUser,
  removeOverrideForUser,
} from '../services/featuredTrader.service.js';
import { rankForValue } from '../services/leaderboard.service.js';
import { queueCounts } from '../services/adminQueue.service.js';
import { storeImage, MAX_BYTES } from '../services/media.service.js';
import { listSubscribers, subscriberCounts } from '../services/subscriber.service.js';
import { listMessages, messageCounts, setHandled } from '../services/contact.service.js';
import {
  listUsers,
  userCounts,
  setUserStatus,
  listPositions,
} from '../services/adminUser.service.js';

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
  /**
   * A PATH WE SERVE, NOT AN ARBITRARY URL. Restricted to `/api/media/<sha256>`
   * so a curated row cannot be pointed at a third-party host: an external
   * avatar is a request every visitor to the public board makes to somebody
   * else's server, subject to their hotlink protection and their availability
   * — the lesson Investing.com already taught the news thumbnails. Empty
   * clears it back to the generated mark.
   */
  avatarUrl: z
    .string()
    .trim()
    .max(120)
    .regex(/^$|^\/api\/media\/[a-f0-9]{64}$/, 'Not an uploaded image')
    .default(''),
  bestReturnPct: z.coerce.number().min(-100).max(100_000).default(0),
  active: z.coerce.boolean().default(true),
});

/**
 * The same fields as `featuredBody` minus the two that a per-account override
 * must not carry.
 *
 * NO `name`: the row stands for a real trader, and it is taken from the account
 * rather than typed — renaming a real account from an edit dialog is how one
 * gets published under an invented identity. NO `userId` either: it is in the
 * PATH. Accepting it in the body as well would create two sources for the one
 * thing that decides whose row this replaces, and a mismatch between them is a
 * silent override of the wrong trader.
 */
const overrideBody = featuredBody.omit({ name: true, userId: true });

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

/**
 * EDITING WHAT A TRADER SHOWS ON THE BOARD, addressed by the ACCOUNT.
 *
 * `PUT` rather than POST/PATCH because it is idempotent and the caller does not
 * know or care whether a curated row already exists for this trader — see
 * `upsertOverrideForUser`. Two operators opening the same trader would both
 * find "no override", both POST, and one would be told the trader is already
 * featured for a form that looked fine.
 *
 * IT MOVES NO MONEY, and that is the whole design. It writes a `FeaturedTrader`
 * row, which changes what the leaderboard DISPLAYS for this account and nothing
 * else — cash, holdings, ledger and their own portfolio screen are untouched. A
 * test asserts it. An admin who could edit a real balance from a table row
 * would be an admin who can mint money by typo.
 *
 * The typed value RE-RANKS naturally: `mergeFeatured` sorts the curated row
 * against the live board on that figure, so a big enough number puts the trader
 * among the top and a small one drops them down the table. It is never pinned.
 */
router.put(
  '/users/:id/override',
  validate({ params: idParam, body: overrideBody }),
  asyncHandler(async (req, res) => {
    res.json(await upsertOverrideForUser(req.params.id, req.body, req.user.id));
  }),
);

/**
 * Where a typed figure would land, before it is saved.
 *
 * "Type a number and find out" is a poor way to run a public board, and the
 * count cannot be done on the client: `/leaderboard` caps at 100 rows, so any
 * trader below that is measured against a truncated list.
 */
router.get(
  '/rank-preview',
  validate({
    query: z.object({
      valueCents: z.coerce.number().int().min(0),
      userId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { valueCents, userId } = req.validatedQuery;
    res.json(await rankForValue(valueCents, { excludeUserId: userId ?? null }));
  }),
);

/**
 * What the Best-position picker offers, for BOTH editors.
 *
 * `userId` IS A QUERY PARAM RATHER THAN A PATH SEGMENT precisely because it is
 * optional. The featured-trader form composes rows that belong to nobody, and
 * those have no holdings to list — one endpoint answering both cases is what
 * keeps the two pickers identical rather than merely similar, which is the
 * whole point of sharing the control.
 *
 * Its own request rather than a field on the user listing: valuing twenty-five
 * portfolios to fill a dropdown nobody may open is the per-row cost this
 * codebase keeps writing notes about.
 */
router.get(
  '/positions',
  validate({
    query: z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/i).optional() }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await listPositions(req.validatedQuery.userId ?? null));
  }),
);

/**
 * Uploading an avatar.
 *
 * RAW BODY, NOT MULTIPART, so this needs no `multer`. The payload is a single
 * file with no accompanying fields, which is exactly the case multipart exists
 * to solve and this is not — the same reasoning `lib/mailer.js` gives for
 * reaching Resend with `fetch` instead of taking their SDK for one POST.
 *
 * The `type` allowlist here only decides what Express will BUFFER. What the
 * file actually is gets decided by sniffing the bytes in `storeImage`, because
 * this header is supplied by the uploader.
 */
router.post(
  '/media',
  express.raw({ type: 'image/*', limit: MAX_BYTES }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await storeImage(req.body, req.user.id));
  }),
);

/** Back to the account's real computed figures. */
router.delete(
  '/users/:id/override',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await removeOverrideForUser(req.params.id));
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

/**
 * Messages left on the contact form.
 *
 * THIS SCREEN IS THE REASON THE FORM POSTS HERE RATHER THAN TO A FORM BACKEND.
 * Without somewhere to read them, the endpoint is write-only and the page is
 * making a promise nothing keeps — which is precisely the objection this repo
 * raised against EmailJS and Basin for the newsletter capture.
 */
router.get(
  '/contact-messages',
  asyncHandler(async (req, res) => {
    const [items, counts] = await Promise.all([listMessages(), messageCounts()]);
    res.json({ items, ...counts });
  }),
);

router.patch(
  '/contact-messages/:id',
  validate({ params: idParam, body: z.object({ handled: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    res.json(await setHandled(req.params.id, req.body.handled, req.user.id));
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
