import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  approveDeposit,
  cancelDeposit,
  createDeposit,
  depositMethods,
  getDeposit,
  listDeposits,
  rejectDeposit,
  submitProof,
} from '../services/deposit.service.js';
import { statement } from '../services/ledger.service.js';

const router = Router();

router.use(requireAuth);

/**
 * What this deployment can actually accept. Driven by configuration, so a
 * deployment with no destination configured reports `available: false` and the
 * funding screen offers no crypto option at all rather than a dead form.
 */
router.get(
  '/methods',
  asyncHandler(async (req, res) => res.json(await depositMethods())),
);

/**
 * A DEPOSIT IS CREATED ONCE AND RETRIEVED BY REFERENCE.
 *
 * Deliberately not `GET /deposits/new` or anything that mints a row on read: a
 * user who refreshes the instructions page, opens it in a second tab, or comes
 * back tomorrow would leave a trail of abandoned deposits, and the one they
 * actually paid into would be indistinguishable from the rest.
 */
const createBody = z.object({
  method: z.enum(['crypto']).default('crypto'),
  asset: z.string().trim().min(2).max(12),
  network: z.string().trim().min(2).max(16),
  amountCents: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

router.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const result = await createDeposit({ ...req.body, userId: req.user._id });
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    res.json({ items: await listDeposits({ userId: req.user._id, status }) });
  }),
);

/** The user's cash statement — every movement, with its running balance. */
router.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    res.json({ items: await statement(req.user._id, { limit: Number(req.query.limit) || 50 }) });
  }),
);

router.get(
  '/:reference',
  asyncHandler(async (req, res) => {
    res.json(await getDeposit({ userId: req.user._id, reference: req.params.reference }));
  }),
);

const submitBody = z.object({
  txHash: z.string().trim().min(10).max(200),
  senderAddress: z.string().trim().max(200).optional(),
  /**
   * Optional, and validated only when present. Making it required would block
   * a legitimate submission over a contact detail — the form pre-fills it from
   * the account, so it is almost always there anyway.
   */
  contactEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
});

/**
 * "I've sent the funds". Moves the deposit into the review queue and credits
 * NOTHING — see the note on `submitProof`.
 */
router.post(
  '/:reference/submit',
  validate({ body: submitBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await submitProof({
        userId: req.user._id,
        reference: req.params.reference,
        ...req.body,
      }),
    );
  }),
);

router.post(
  '/:reference/cancel',
  asyncHandler(async (req, res) => {
    res.json(await cancelDeposit({ userId: req.user._id, reference: req.params.reference }));
  }),
);

/* ----------------------------------------------------------------- admin */

export const adminDepositRouter = Router();
adminDepositRouter.use(requireAuth, requireAdmin);

adminDepositRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Defaults to the queue, because that is what an admin opens this for.
    const status = req.query.status ? String(req.query.status) : 'under_review';
    // `admin` joins the account onto each row — a queue that does not say whose
    // deposit it is cannot be worked, and approving one credits that account.
    res.json({
      items: await listDeposits({ status: status === 'all' ? null : status, admin: true }),
    });
  }),
);

adminDepositRouter.get(
  '/:reference',
  asyncHandler(async (req, res) => {
    res.json(await getDeposit({ reference: req.params.reference, admin: true }));
  }),
);

const reviewBody = z.object({ note: z.string().trim().max(280).optional() });

adminDepositRouter.post(
  '/:reference/approve',
  validate({ body: reviewBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await approveDeposit({
        reference: req.params.reference,
        adminId: req.user._id,
        note: req.body.note,
      }),
    );
  }),
);

const rejectBody = z.object({ reason: z.string().trim().min(1).max(280) });

adminDepositRouter.post(
  '/:reference/reject',
  validate({ body: rejectBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await rejectDeposit({
        reference: req.params.reference,
        adminId: req.user._id,
        reason: req.body.reason,
      }),
    );
  }),
);

export default router;
