import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  adminUpdateCash,
  adminAddHolding,
  adminRemoveHolding,
  adminUpdateAvatar,
  adminAddFunds,
} from "../services/adminUser.service.js";

const router = Router();
router.use(requireAuth, requireAdmin);
const idParam = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id"),
});

import { rankForValue } from "../services/leaderboard.service.js";
import { queueCounts } from "../services/adminQueue.service.js";
import { storeImage, MAX_BYTES } from "../services/media.service.js";
import {
  listSubscribers,
  subscriberCounts,
} from "../services/subscriber.service.js";
import {
  listMessages,
  messageCounts,
  setHandled,
} from "../services/contact.service.js";
import {
  listUsers,
  userCounts,
  setUserStatus,
  listPositions,
} from "../services/adminUser.service.js";

router.get(
  "/users",
  validate({
    query: z.object({
      q: z.string().trim().max(60).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validatedQuery;
    const [listing, counts] = await Promise.all([
      listUsers({ q, page, limit }),
      userCounts(),
    ]);
    res.json({ ...listing, counts });
  })
);

router.patch(
  "/users/:id/status",
  validate({
    params: idParam,
    body: z.object({ status: z.enum(["Active", "Flagged", "Suspended"]) }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await setUserStatus(req.params.id, req.body.status, req.user.id));
  })
);

/**
 * Where a typed figure would land, before it is saved.
 *
 * "Type a number and find out" is a poor way to run a public board, and the
 * count cannot be done on the client: `/leaderboard` caps at 100 rows, so any
 * trader below that is measured against a truncated list.
 */
router.get(
  "/rank-preview",
  validate({
    query: z.object({
      valueCents: z.coerce.number().int().min(0),
      userId: z
        .string()
        .regex(/^[a-f0-9]{24}$/i)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { valueCents, userId } = req.validatedQuery;
    res.json(await rankForValue(valueCents, { excludeUserId: userId ?? null }));
  })
);

/**
 * What the Best-position picker offers, for BOTH editors.
 *
 * `userId` IS A QUERY PARAM RATHER THAN A PATH SEGMENT precisely because it is
 * optional. The featured-trader form composes rows that belong to nobody, and
 * those have no holdings to list — one endpoint answering both cases is what
 * keeps the two pickers identical rather than merely similar, which is the
 * whole point of sharing the control.
 *
 * Its own request rather than a field on the user listing: valuing twenty-five
 * portfolios to fill a dropdown nobody may open is the per-row cost this
 * codebase keeps writing notes about.
 */
router.get(
  "/positions",
  validate({
    query: z.object({
      userId: z
        .string()
        .regex(/^[a-f0-9]{24}$/i)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await listPositions(req.validatedQuery.userId ?? null));
  })
);

/**
 * Uploading an avatar.
 *
 * RAW BODY, NOT MULTIPART, so this needs no `multer`. The payload is a single
 * file with no accompanying fields, which is exactly the case multipart exists
 * to solve and this is not — the same reasoning `lib/mailer.js` gives for
 * reaching Resend with `fetch` instead of taking their SDK for one POST.
 *
 * The `type` allowlist here only decides what Express will BUFFER. What the
 * file actually is gets decided by sniffing the bytes in `storeImage`, because
 * this header is supplied by the uploader.
 */
router.post(
  "/media",
  express.raw({ type: "image/*", limit: MAX_BYTES }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await storeImage(req.body, req.user.id));
  })
);

/** Addresses captured by the marketing CTAs. */
router.get(
  "/subscribers",
  asyncHandler(async (req, res) => {
    const [items, counts] = await Promise.all([
      listSubscribers(),
      subscriberCounts(),
    ]);
    res.json({ items, ...counts });
  })
);

/**
 * Messages left on the contact form.
 *
 * THIS SCREEN IS THE REASON THE FORM POSTS HERE RATHER THAN TO A FORM BACKEND.
 * Without somewhere to read them, the endpoint is write-only and the page is
 * making a promise nothing keeps — which is precisely the objection this repo
 * raised against EmailJS and Basin for the newsletter capture.
 */
router.get(
  "/contact-messages",
  asyncHandler(async (req, res) => {
    const [items, counts] = await Promise.all([
      listMessages(),
      messageCounts(),
    ]);
    res.json({ items, ...counts });
  })
);

router.patch(
  "/contact-messages/:id",
  validate({ params: idParam, body: z.object({ handled: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    res.json(await setHandled(req.params.id, req.body.handled, req.user.id));
  })
);

router.patch(
  "/users/:id/avatar",
  validate({
    params: idParam,
    body: z.object({
      image: z.string().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await adminUpdateAvatar(req.params.id, req.body.image, req.user.id)
    );
  })
);

router.post(
  "/users/:id/portfolio/funds",
  validate({
    params: idParam,
    body: z.object({
      amountCents: z.number().int().positive(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await adminAddFunds(req.params.id, req.body.amountCents, req.user.id)
    );
  })
);

router.patch(
  "/users/:id/portfolio/cash",
  validate({
    params: idParam,
    body: z.object({
      cashBalanceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await adminUpdateCash(
        req.params.id,
        req.body.cashBalanceCents,
        req.user.id
      )
    );
  })
);

router.post(
  "/users/:id/portfolio/holdings",
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
  })
);

router.delete(
  "/users/:id/portfolio/holdings/:symbol",
  validate({
    params: idParam,
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await adminRemoveHolding(req.params.id, req.params.symbol, req.user.id)
    );
  })
);

router.post(
  "/users/:id/portfolio/orders",
  validate({
    params: idParam,
    body: z.object({
      symbol: z.string().trim().max(12),
      side: z.enum(["BUY", "SELL"]),
      quantity: z.number().positive(),
    }),
  }),
  asyncHandler(async (req, res) => {
    // We import placeOrder inside the handler to avoid circular dependencies
    const { placeOrder } = await import("../services/order.service.js");
    const { getInstruments } = await import("../services/market.service.js");

    const symbol = req.body.symbol.toUpperCase();

    // Auto-detect asset class
    let assetClass = "stocks";
    const { Stock } = await import("../models/Stock.js");
    let asset = await Stock.findOne({ symbol }).lean();
    if (!asset) {
      const { items } = await getInstruments({ assetClass: "crypto" });
      if (items.find((i) => i.symbol === symbol)) assetClass = "crypto";
    }
    if (!asset && assetClass === "stocks") {
      const { items } = await getInstruments({ assetClass: "forex" });
      if (items.find((i) => i.symbol === symbol)) assetClass = "forex";
    }

    const order = await placeOrder({
      userId: req.params.id,
      assetClass,
      symbol,
      side: req.body.side,
      quantity: req.body.quantity,
      orderType: "MARKET",
    });
    res.json(order);
  })
);

export default router;
