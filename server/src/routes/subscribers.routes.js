import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { subscribe, unsubscribe } from '../services/subscriber.service.js';

/**
 * The marketing capture endpoint. Public and unauthenticated, which is the
 * whole point — it sits on the landing page, before anyone has an account.
 *
 * Rate-limited for that reason. It is the only public POST in the API that
 * writes a row, so without a limit it is a free `insertMany` for anyone with a
 * word list. The window is the same shape as the auth limiter's, wider because
 * a legitimate visitor submits this once and never again.
 */
const router = Router();

const captureLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' },
  },
});

const body = z.object({
  email: z.string().trim().max(254),
  source: z.enum(['landing_cta', 'faq_cta', 'footer', 'other']).default('other'),
});

router.post(
  '/',
  captureLimiter,
  validate({ body }),
  asyncHandler(async (req, res) => {
    const result = await subscribe(req.body);

    if (!result.ok) {
      return res.status(400).json({
        error: { code: result.code, message: 'Enter a valid email address.' },
      });
    }

    // `created` is deliberately NOT returned. Telling an anonymous caller
    // whether an address was already on file makes this an enumeration oracle.
    res.status(201).json({ ok: true });
  }),
);

/**
 * Leaving the list. Same limiter, since it is equally public and equally a
 * write, and the token is the only thing that identifies the row.
 */
router.post(
  '/unsubscribe',
  captureLimiter,
  validate({ body: z.object({ token: z.string().trim().min(8).max(200) }) }),
  asyncHandler(async (req, res) => {
    await unsubscribe(req.body.token);
    // Identical response for an unknown token, an already-unsubscribed row and
    // a successful removal — anything else confirms a token exists.
    res.json({ ok: true });
  }),
);

export default router;
