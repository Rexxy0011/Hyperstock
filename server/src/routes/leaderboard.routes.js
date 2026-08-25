import { Router } from 'express';
import { getLeaderboard } from '../services/leaderboard.service.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const PERIODS = { Weekly: 'weekly', Monthly: 'monthly', 'All-time': 'alltime' };

/**
 * Optional auth: anonymous callers (the Landing page's top-5) get the board
 * with `you: null`; signed-in callers additionally get their own pinned row.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const raw = String(req.query.period ?? 'alltime');
    const period = PERIODS[raw] ?? (['weekly', 'monthly', 'alltime'].includes(raw) ? raw : 'alltime');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    res.json(await getLeaderboard({ period, limit, userId: req.user?.id ?? null }));
  }),
);

export default router;
