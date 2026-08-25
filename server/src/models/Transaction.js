import mongoose from 'mongoose';

/**
 * The Wallet ledger. One row per money movement, in the shape the Wallet
 * screen renders: Type | Detail | Date | Amount | Status.
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    type: { type: String, enum: ['Top-up', 'Buy', 'Sell', 'Withdrawal'], required: true },

    /** Human-readable, e.g. "12 AAPL @ $214.02", "Approved by admin". */
    detail: { type: String, required: true },

    /**
     * Signed USD cents: negative for buys, positive for sells and credited
     * top-ups. Integer — this column is summed, so a float would drift.
     */
    amountCents: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'amountCents must be an integer' },
    },

    status: {
      // `Cancelled` is a withdrawal the user pulled back before review — it is
      // not `Declined`, which says somebody looked at it and said no.
      type: String,
      enum: ['Pending', 'Filled', 'Approved', 'Declined', 'Cancelled'],
      required: true,
    },

    relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    relatedTopUpId: { type: mongoose.Schema.Types.ObjectId, ref: 'TopUpRequest' },
    relatedWithdrawalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal' },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1, createdAt: -1 });

transactionSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Transaction = mongoose.model('Transaction', transactionSchema);
