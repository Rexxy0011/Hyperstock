import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { readImage } from '../services/media.service.js';

/**
 * Serving a stored image.
 *
 * PUBLIC, because these are leaderboard avatars and the leaderboard is public.
 * There is nothing to authorise: the id is a sha-256 of the bytes, so it is
 * unguessable and carries no reference to an account.
 *
 * `immutable` FOR A YEAR IS SAFE ONLY BECAUSE THE URL IS CONTENT-ADDRESSED.
 * The bytes at a given id cannot change — a different picture is a different
 * hash and therefore a different URL — so there is no cache to bust and no
 * window in which a stale avatar can be served. On a mutable id this header
 * would be a bug.
 */
const router = Router();

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await readImage(req.params.id);
    // A missing image is a 404 rather than a placeholder: `Avatar` falls back
    // to the generated mark on the img's own error event, so the client already
    // handles this and a served placeholder would defeat that.
    if (!doc) return res.status(404).end();

    res.set({
      'Content-Type': doc.contentType,
      'Content-Length': String(doc.bytes),
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The id IS the digest of the body, so this is a strong validator for
      // free and a conditional request costs one indexed lookup.
      ETag: `"${doc._id}"`,
      // Belt and braces with the byte-sniffing at upload: even if something
      // unexpected were stored, the browser must not re-interpret it.
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });

    return res.end(doc.data.buffer ? Buffer.from(doc.data.buffer) : doc.data);
  }),
);

export default router;
