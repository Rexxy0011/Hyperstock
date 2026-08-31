import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { orderLimiter } from '../middleware/rateLimiters.js';
import { listOrders, placeOrder } from '../services/order.service.js';

const router = Router();

router.use(requireAuth);

const placeBody = z.object({
  /**
   * Defaulted rather than required, so every existing client and every stored
   * request body keeps working — an order that does not say otherwise is an
   * equity order, which is what all of them were.
   */
  assetClass: z.enum(['stocks', 'crypto', 'forex']).default('stocks'),
  symbol: z.string().trim().min(1).max(24),
  side: z.enum(['BUY', 'SELL']),
  /**
   * Positive and finite here; WHOLE-ness is enforced per class in the service,
   * because it is a property of the market and not of the transport. Equities
   * are whole units, crypto and forex are not — one BTC is roughly eight times
   * a starting account, so an integer floor would make that market unreachable
   * rather than strict.
   */
  quantity: z.coerce.number().positive().max(1_000_000_000),
  /**
   * The price the user was actually shown. Optional, and the slippage guard is
   * skipped without it — a caller that never saw a quote cannot be protected by
   * one. Sent by the trade modal on every submit.
   */
  quotedPriceUsdCents: z.coerce.number().int().positive().optional(),
  /**
   * The same quote in nanos, and the one the client should send.
   *
   * Cents cannot carry a sub-dollar quote precisely enough to be compared
   * against a 0.5% tolerance: EURUSD at 1.1663 rounds to 117 cents, which is
   * already 0.32% away from the real price — most of the slippage budget spent
   * on rounding before the market has moved at all, and a coin under a cent is
   * worse than that. Cents stays accepted so an existing caller still works.
   */
  quotedPriceUsdNanos: z.coerce.number().positive().optional(),
  /**
   * Makes a retry safe. The unique partial index on this field is the lock, so
   * a double-submitted ticket returns the original order rather than filling
   * twice. The client generates one per ticket, not per attempt.
   */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

router.post(
  '/',
  orderLimiter,
  validate({ body: placeBody }),
  asyncHandler(async (req, res) => {
    const result = await placeOrder({ ...req.body, userId: req.user._id });
    // 200 rather than 201 on a replay: nothing was created this time, and the
    // client uses the distinction to avoid showing a second receipt.
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 25;
    res.json({ items: await listOrders(req.user._id, { limit }) });
  }),
);

export default router;
