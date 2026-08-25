import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPortfolio, getPerformance } from '../services/portfolio.service.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getPortfolio(req.user._id, req.user.cashBalanceCents));
  }),
);

router.get(
  '/performance',
  asyncHandler(async (req, res) => {
    res.json(await getPerformance(req.user._id, String(req.query.range ?? '1M')));
  }),
);

/* The watchlist moved to its own resource at /api/watchlist — it now spans all
   three asset classes, and crypto and forex have no Stock document to join
   against. See routes/watchlist.routes.js. */

export default router;
