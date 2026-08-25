import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listTopUps, requestTopUp, reviewTopUp, topUpLimits } from '../services/wallet.service.js';

const router = Router();

router.use(requireAuth);

/**
 * The limits, so the client labels its own form from the server's rules rather
 * than hard-coding a threshold that can drift out of step with `env`.
 */
router.get(
  '/limits',
  asyncHandler(async (req, res) => res.json(topUpLimits())),
);

const topUpBody = z.object({
  /** Integer cents, like every other amount crossing this boundary. */
  amountCents: z.coerce.number().int().positive(),
  reason: z.string().trim().max(280).optional(),
  /**
   * Required in practice, because a request at or under the instant limit
   * CREDITS CASH — so a double-tapped button without one is a double credit.
   * Optional in the schema only so a scripted caller is not forced into a
   * mechanism it may not need.
   */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

router.post(
  '/topups',
  validate({ body: topUpBody }),
  asyncHandler(async (req, res) => {
    const result = await requestTopUp({ ...req.body, userId: req.user._id });
    // 200 on a replay: nothing was created this time, and the client uses the
    // distinction the same way the order ticket does.
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

router.get(
  '/topups',
  asyncHandler(async (req, res) => {
    res.json({ items: await listTopUps({ userId: req.user._id }) });
  }),
);

/* ----------------------------------------------------------------- admin */

/**
 * The review endpoints ship now even though the admin SCREEN does not.
 *
 * Without them a Pending request is a dead end — the queue could only grow, and
 * a user who asked for more than the instant limit would wait forever. The
 * screen can land later against a working endpoint; the reverse would have been
 * a screen with nothing behind it.
 */
router.get(
  '/admin/topups',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    res.json({ items: await listTopUps({ status, admin: true }) });
  }),
);

const reviewBody = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(280).optional(),
});

router.post(
  '/admin/topups/:id',
  requireAdmin,
  validate({ body: reviewBody }),
  asyncHandler(async (req, res) => {
    res.json(
      await reviewTopUp({
        id: req.params.id,
        adminId: req.user._id,
        approve: req.body.approve,
        note: req.body.note,
      }),
    );
  }),
);

export default router;
