import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { adminMoneyActionLimiter, withdrawalLimiter } from '../middleware/rateLimiters.js';
import {
  approveWithdrawal,
  cancelWithdrawal,
  claimWithdrawal,
  createWithdrawal,
  getWithdrawal,
  listWithdrawals,
  rejectWithdrawal,
  withdrawalMethods,
} from '../services/withdrawal.service.js';

const router = Router();

router.use(requireAuth);

/**
 * What this deployment can pay out on, and whether it can pay out at all.
 * A deployment with withdrawals disabled reports `available: false` and the
 * screen says so rather than rendering a form that will be refused on submit.
 */
router.get(
  '/methods',
  asyncHandler(async (req, res) => res.json(await withdrawalMethods())),
);

/**
 * CREATING ONE HOLDS THE CASH. There is no separate "submit" step, because
 * unlike a deposit there is nothing to wait for in between — no payment has to
 * arrive, the user is not being asked to do anything, and a row sitting in a
 * pre-submission state would be holding their money for no reason.
 */
const createBody = z.object({
  asset: z.string().trim().min(2).max(12),
  network: z.string().trim().min(2).max(16),
  address: z.string().trim().min(16).max(200),
  amountCents: z.coerce.number().int().positive(),
  contactEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

router.post(
  '/',
  withdrawalLimiter,
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const result = await createWithdrawal({ ...req.body, userId: req.user._id });
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    res.json({ items: await listWithdrawals({ userId: req.user._id, status }) });
  }),
);

router.get(
  '/:reference',
  asyncHandler(async (req, res) => {
    res.json(await getWithdrawal({ userId: req.user._id, reference: req.params.reference }));
  }),
);

router.post(
  '/:reference/cancel',
  withdrawalLimiter,
  asyncHandler(async (req, res) => {
    res.json(await cancelWithdrawal({ userId: req.user._id, reference: req.params.reference }));
  }),
);

/* ----------------------------------------------------------------- admin */

export const adminWithdrawalRouter = Router();
adminWithdrawalRouter.use(requireAuth, requireAdmin);

adminWithdrawalRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Defaults to the unclaimed queue, because that is what an operator opens
    // this for — the rows nobody has started on yet.
    const status = req.query.status ? String(req.query.status) : 'requested';
    res.json({
      items: await listWithdrawals({ status: status === 'all' ? null : status, admin: true }),
    });
  }),
);

adminWithdrawalRouter.get(
  '/:reference',
  asyncHandler(async (req, res) => {
    res.json(await getWithdrawal({ reference: req.params.reference, admin: true }));
  }),
);

/**
 * Claim before confirm. The compare-and-set inside is what stops two operators
 * working the same queue from both sending the funds.
 */
adminWithdrawalRouter.post(
  '/:reference/claim',
  adminMoneyActionLimiter,
  asyncHandler(async (req, res) => {
    res.json(await claimWithdrawal({ reference: req.params.reference, adminId: req.user._id }));
  }),
);

/** `txHash` is required — an approved payout needs evidence a transfer exists. */
const approveBody = z.object({
  txHash: z.string().trim().min(10).max(200),
  note: z.string().trim().max(280).optional(),
});

adminWithdrawalRouter.post(
  '/:reference/approve',
  adminMoneyActionLimiter,
  validate({ body: approveBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await approveWithdrawal({
        reference: req.params.reference,
        adminId: req.user._id,
        ...req.body,
      }),
    );
  }),
);

const rejectBody = z.object({ reason: z.string().trim().min(1).max(280) });

adminWithdrawalRouter.post(
  '/:reference/reject',
  adminMoneyActionLimiter,
  validate({ body: rejectBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await rejectWithdrawal({
        reference: req.params.reference,
        adminId: req.user._id,
        reason: req.body.reason,
      }),
    );
  }),
);

export default router;
