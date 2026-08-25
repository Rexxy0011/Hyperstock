import { Router } from 'express';
import { z } from 'zod';
import { Announcement } from '../models/Announcement.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { ASSET_CLASSES, getNews } from '../services/news.service.js';

const router = Router();

const listQuery = z.object({
  // An enum, not a string. This selects which third-party feed gets called, so
  // an unrecognised value must be rejected at the edge rather than reaching a
  // URL builder.
  assetClass: z.enum(/** @type {[string, ...string[]]} */ (ASSET_CLASSES)).default('stocks'),
  // A ticker, not free text — this reaches a vendor URL, so it is constrained
  // to the shape a symbol can actually take rather than merely escaped.
  symbol: z
    .string()
    .regex(/^[A-Za-z0-9.\-^]{1,12}$/, 'Not a valid symbol')
    .optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

/**
 * GET /api/news
 *
 * Answered from the cache; see services/news.service.js for the ladder. The
 * response always carries `source` and `degraded` so the page can say when it
 * is showing the fallback feed rather than quietly presenting it as the real
 * one.
 */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { assetClass, symbol, limit } = req.validatedQuery;
    res.json(await getNews({ assetClass, symbol, limit }));
  }),
);

export default router;

/**
 * Announcements are a separate router on a separate path — they are our own
 * records rather than market data, and the News page happens to render both.
 */
export const announcementRouter = Router();

/**
 * GET /api/announcements/active
 *
 * Published announcements, newest first. 'Draft' is excluded because it is
 * unpublished by definition; 'Archived' because it is withdrawn. 'Sent' stays:
 * it means delivered, not retracted.
 *
 * `audience` is not filtered here. Doing that needs the caller's identity and
 * this route is public — the seeded "Active traders" announcement is visible
 * to everyone until the admin pass adds the guard.
 */
announcementRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const rows = await Announcement.find({ status: { $in: ['Live', 'Sent'] } })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(10)
      .lean();

    res.json(
      rows.map((a) => ({
        id: String(a._id),
        title: a.title,
        body: a.body,
        audience: a.audience,
        status: a.status,
        publishedAt: a.publishedAt ?? a.createdAt,
      })),
    );
  }),
);
