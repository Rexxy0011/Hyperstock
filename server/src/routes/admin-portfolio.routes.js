import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { adminUpdateCash, adminAddHolding, adminRemoveHolding } from '../services/adminUser.service.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id') });

router.patch(
  '/:id/cash',
  validate({
    params: idParam,
    body: z.object({ cashBalanceCents: z.number().int().min(0).max(10_000_000_000) }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await adminUpdateCash(req.params.id, req.body.cashBalanceCents, req.user.id));
  }),
);

router.post(
  '/:id/holdings',
  validate({
    params: idParam,
    body: z.object({
      symbol: z.string().trim().max(12),
      shares: z.number().positive(),
      costBasisCents: z.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await adminAddHolding(req.params.id, req.body, req.user.id));
  }),
);

router.delete(
  '/:id/holdings/:symbol',
  validate({
    params: idParam,
  }),
  asyncHandler(async (req, res) => {
    res.json(await adminRemoveHolding(req.params.id, req.params.symbol, req.user.id));
  }),
);

export default router;
