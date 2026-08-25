import mongoose from 'mongoose';
import { env } from '../config/env.js';

const topUpRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /** Integer cents. Ceiling enforced here AND in the service — the schema is
     *  the backstop, not the only guard. */
    amountCents: {
      type: Number,
      required: true,
      min: 100,
      max: env.MAX_TOPUP_AMOUNT * 100,
      validate: { validator: Number.isInteger, message: 'amountCents must be an integer' },
    },

    reason: { type: String, default: '', maxlength: 280 },

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Declined'],
      default: 'Pending',
      required: true,
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    adminNote: { type: String },

    /**
     * Same mechanism as an order's, and needed for the same reason: a request
     * at or under the auto-approval limit CREDITS CASH, so a double-tapped
     * button is a double credit. The unique partial index below is the lock —
     * the row is inserted before any money moves, so a retry collides on insert
     * and returns the original instead of funding the account twice.
     */
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

topUpRequestSchema.index({ status: 1, createdAt: -1 });
topUpRequestSchema.index({ userId: 1, createdAt: -1 });
topUpRequestSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);

topUpRequestSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const TopUpRequest = mongoose.model('TopUpRequest', topUpRequestSchema);
