import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ASSET_CLASSES } from '../services/market.service.js';
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
} from '../services/watchlist.service.js';

/**
 * The watchlist is its own resource, not a branch of /portfolio.
 *
 * It used to live under /portfolio/watchlist, which was accurate when it held
 * equities and the only screen showing it was the Portfolio dashboard. It now
 * carries crypto and forex and is driven mainly from /markets, where a portfolio
 * is not involved at all — following an instrument is not a position in it.
 */
const router = Router();

router.use(requireAuth);

const assetClass = z.enum(/** @type {[string, ...string[]]} */ (ASSET_CLASSES));
// Long enough for `BRK.B` and `600519`, and bounded so an oversized string
// never reaches a Mongo query.
const symbol = z.string().trim().min(1).max(24);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ items: await listWatchlist(req.user._id) });
  }),
);

router.post(
  '/',
  validate({ body: z.object({ assetClass, symbol }) }),
  asyncHandler(async (req, res) => {
    const item = await addToWatchlist(req.user._id, req.body.assetClass, req.body.symbol);
    res.status(201).json(item);
  }),
);

/**
 * The class is in the path because it is half the key — DELETE /watchlist/BTC
 * could not say whether it meant the coin or a ticker.
 */
router.delete(
  '/:assetClass/:symbol',
  validate({ params: z.object({ assetClass, symbol }) }),
  asyncHandler(async (req, res) => {
    await removeFromWatchlist(req.user._id, req.params.assetClass, req.params.symbol);
    res.status(204).end();
  }),
);

export default router;
