import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { submitMessage } from '../services/contact.service.js';

/**
 * The contact form's endpoint. Public and unauthenticated, because the page it
 * sits on is — somebody asking how withdrawals work before opening an account
 * is exactly who this is for.
 *
 * RATE-LIMITED FOR THAT REASON, and more tightly than the newsletter capture.
 * `/api/subscribers` writes a row holding one indexed address and collides with
 * itself on a repeat; this writes an unbounded 4,000-character body every time
 * and deliberately does NOT deduplicate, so an unlimited version is a free
 * write amplifier pointed at the database. Five an hour is well above what a
 * real visitor sends and far below what makes the collection a problem.
 */
const router = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many messages. Try again shortly.' },
  },
});

/**
 * The topics the form offers.
 *
 * KEPT IN STEP WITH THE MODEL'S ENUM AND THE CLIENT'S PICKER. Three copies of
 * one list is two too many, but the alternatives are worse: importing the model
 * into the route to read its enum couples a schema to a validator, and the
 * client cannot import from `server/` at all. The model is the one that
 * actually rejects, so a drift here fails loudly at insert rather than storing
 * a value nothing can filter on.
 */
const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40).default(''),
  topic: z.enum(['account', 'funding', 'trading', 'partnership', 'other']).default('other'),
  message: z.string().trim().min(1).max(4000),
});

router.post(
  '/',
  contactLimiter,
  validate({ body }),
  asyncHandler(async (req, res) => {
    const result = await submitMessage(req.body);

    if (!result.ok) {
      return res.status(400).json({
        error: { code: result.code, message: 'Check the form and try again.' },
      });
    }

    /**
     * The id is returned and nothing else. It is a handle the sender can quote
     * if they follow up, and it discloses nothing — unlike, say, a queue
     * position, which would tell an anonymous caller how much traffic this
     * form gets.
     */
    res.status(201).json({ ok: true, id: result.id });
  }),
);

export default router;
