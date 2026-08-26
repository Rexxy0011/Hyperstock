import { AUTO_TOPUP_LIMIT_CENTS, MAX_TOPUP_CENTS } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { ApiError } from '../lib/ApiError.js';
import { usdFromCents } from '../lib/money.js';
import { LEDGER_TYPE } from '../models/LedgerEntry.js';
import { TopUpRequest } from '../models/TopUpRequest.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { traderOf, TRADER_FIELDS } from './adminQueue.service.js';
import { invalidateLeaderboard } from './leaderboard.service.js';
import { post } from './ledger.service.js';

/**
 * Adding virtual capital to an account.
 *
 * TWO OUTCOMES, AND THE THRESHOLD IS THE POINT. `TopUpRequest` models a review
 * workflow — Pending / Approved / Declined, with a seeded admin queue behind it
 * — and that workflow is real. But routing EVERY request through it answers
 * "I cannot afford this trade" with "wait for an administrator to approve some
 * imaginary money", which is friction with no purpose in a practice product.
 *
 * So: at or below `AUTO_TOPUP_LIMIT` the funds land immediately and the request
 * is recorded as Approved with no reviewer. Above it, up to `MAX_TOPUP_AMOUNT`,
 * it queues as Pending for a human. The user is told which happened rather than
 * being left to work it out from whether the balance moved.
 *
 * THE MONEY RULES ARE THE ORDER LEDGER'S, because this credits cash the same
 * way a sell does:
 *
 *   1. The row is INSERTED FIRST, so the unique index on `idempotencyKey` is
 *      the lock and a double-tapped button collides before any money moves.
 *   2. A review's guard lives IN THE UPDATE FILTER — `{ status: 'Pending' }` —
 *      so two administrators approving the same request at the same moment
 *      cannot both credit it. The loser matches no document.
 */

/** A user may not stack unbounded requests on the queue. */
const MAX_OPEN_REQUESTS = 3;

/**
 * @param {{ userId: any, amountCents: number, reason?: string,
 *   idempotencyKey?: string }} input
 */
export async function requestTopUp(input) {
  const amountCents = Number(input.amountCents);

  if (!Number.isInteger(amountCents) || amountCents < 100) {
    throw ApiError.badRequest('BAD_AMOUNT', 'Enter an amount of at least $1.00');
  }
  if (amountCents > MAX_TOPUP_CENTS) {
    throw ApiError.badRequest(
      'AMOUNT_TOO_LARGE',
      `The most that can be requested at once is ${usdFromCents(MAX_TOPUP_CENTS)}`,
    );
  }

  const instant = amountCents <= AUTO_TOPUP_LIMIT_CENTS;

  if (!instant) {
    const open = await TopUpRequest.countDocuments({ userId: input.userId, status: 'Pending' });
    if (open >= MAX_OPEN_REQUESTS) {
      throw ApiError.unprocessable(
        'TOO_MANY_PENDING',
        `You already have ${open} requests awaiting review`,
      );
    }
  }

  // INSERT FIRST. Everything below this line can move money, so the collision
  // has to happen before it does.
  let request;
  try {
    request = await TopUpRequest.create({
      userId: input.userId,
      amountCents,
      reason: String(input.reason ?? '').slice(0, 280),
      status: 'Pending',
      ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
    });
  } catch (err) {
    if (err?.code === 11000 && input.idempotencyKey) {
      const existing = await TopUpRequest.findOne({
        idempotencyKey: input.idempotencyKey,
      }).lean();
      if (existing) {
        const user = await User.findById(input.userId).lean();
        return {
          request: publicRequest(existing),
          cashBalanceCents: user?.cashBalanceCents ?? 0,
          credited: existing.status === 'Approved',
          replayed: true,
        };
      }
    }
    throw err;
  }

  if (!instant) {
    const user = await User.findById(input.userId).lean();
    return {
      request: publicRequest(request.toObject()),
      cashBalanceCents: user?.cashBalanceCents ?? 0,
      credited: false,
      replayed: false,
      // Said explicitly so the UI never has to infer it from an unchanged
      // balance, which is indistinguishable from a failure.
      message: `Requests over ${usdFromCents(AUTO_TOPUP_LIMIT_CENTS)} are reviewed before the funds land.`,
    };
  }

  const cashBalanceCents = await credit({
    userId: input.userId,
    requestId: request._id,
    amountCents,
  });

  return {
    request: publicRequest({ ...request.toObject(), status: 'Approved' }),
    cashBalanceCents,
    credited: true,
    replayed: false,
  };
}

/**
 * Moves the money and marks the request Approved, in one transaction.
 *
 * The status flip is the GUARD, not a formality: it matches only while the
 * request is still Pending, so a concurrent approval — two admins on the queue,
 * or a retry racing the original — finds nothing and credits nothing.
 */
async function credit({ userId, requestId, amountCents, reviewedBy = null }) {
  return withTransaction(async (session) => {
    const claimed = await TopUpRequest.findOneAndUpdate(
      { _id: requestId, status: 'Pending' },
      {
        $set: {
          status: 'Approved',
          reviewedAt: new Date(),
          ...(reviewedBy && { reviewedBy }),
        },
      },
      { new: true, session },
    );

    if (!claimed) {
      throw ApiError.conflict('ALREADY_REVIEWED', 'That request has already been reviewed');
    }

    /**
     * THROUGH THE LEDGER, NEVER A BARE `$inc`.
     *
     * This used to increment `cashBalanceCents` directly and write only a
     * `Transaction` — the display row. That is precisely the code path
     * `reconcile()` is documented as existing to catch: the balance moved and
     * the audit record did not, so the sum of the ledger no longer equalled the
     * field it is supposed to explain, and every top-up widened the gap.
     *
     * The request id is the reference, so the unique {type, reference} index is
     * a second guard behind the `status: 'Pending'` compare-and-set above —
     * independent of it, and the one that still holds where `withTransaction`
     * degrades on a standalone Mongo.
     */
    const { balanceAfterCents } = await post({
      userId,
      type: LEDGER_TYPE.TOPUP,
      amountCents,
      reference: String(requestId),
      detail: `Practice funds - ${usdFromCents(amountCents)}`,
      session,
    });

    await Transaction.create(
      [
        {
          userId,
          type: 'Top-up',
          detail: `Virtual capital added - ${usdFromCents(amountCents)}`,
          amountCents,
          status: 'Approved',
          relatedTopUpId: requestId,
        },
      ],
      { session },
    );

    // Cash is part of portfolio value, so the board is stale the moment this
    // lands — same reason a fill invalidates it.
    invalidateLeaderboard();
    return balanceAfterCents;
  });
}

/** The queue, for the admin screen that is not built yet. */
export async function listTopUps({ userId = null, status = null, limit = 50, admin = false } = {}) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (status) filter.status = status;

  const query = TopUpRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, limit)));
  if (admin) query.populate('userId', TRADER_FIELDS);

  const rows = await query.lean();

  return rows.map((r) => ({
    ...publicRequest(r),
    ...(admin && { trader: traderOf(r.userId) }),
  }));
}

/**
 * Admin approve or decline.
 *
 * Implemented now rather than with the admin screens because without it a
 * Pending request is a dead end — the queue would only ever grow. The screen
 * that drives it can land later against a working endpoint.
 */
export async function reviewTopUp({ id, adminId, approve, note = '' }) {
  const request = await TopUpRequest.findById(id).lean();
  if (!request) throw ApiError.notFound('No such top-up request');
  if (request.status !== 'Pending') {
    throw ApiError.conflict('ALREADY_REVIEWED', `That request is already ${request.status}`);
  }

  if (!approve) {
    // Declining moves no money, so the status flip alone is the whole
    // operation — and it carries the same Pending guard for the same reason.
    const declined = await TopUpRequest.findOneAndUpdate(
      { _id: id, status: 'Pending' },
      {
        $set: {
          status: 'Declined',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          adminNote: String(note).slice(0, 280),
        },
      },
      { new: true },
    );
    if (!declined) throw ApiError.conflict('ALREADY_REVIEWED', 'That request has already been reviewed');
    return { request: publicRequest(declined.toObject()), credited: false };
  }

  const cashBalanceCents = await credit({
    userId: request.userId,
    requestId: request._id,
    amountCents: request.amountCents,
    reviewedBy: adminId,
  });

  return {
    request: publicRequest({ ...request, status: 'Approved' }),
    cashBalanceCents,
    credited: true,
  };
}

const publicRequest = (r) => ({
  id: String(r._id),
  amountCents: r.amountCents,
  reason: r.reason ?? '',
  status: r.status,
  adminNote: r.adminNote ?? '',
  reviewedAt: r.reviewedAt ?? null,
  createdAt: r.createdAt,
});

/** Surfaced so the client can label its own limits rather than hard-coding them. */
export const topUpLimits = () => ({
  minCents: 100,
  maxCents: MAX_TOPUP_CENTS,
  instantLimitCents: AUTO_TOPUP_LIMIT_CENTS,
});
