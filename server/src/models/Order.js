import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /** Which market this order was placed in — see the note on Holding. */
    assetClass: {
      type: String,
      enum: ['stocks', 'crypto', 'forex'],
      required: true,
      default: 'stocks',
    },

    symbol: { type: String, required: true, uppercase: true, trim: true },

    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    orderType: { type: String, enum: ['MARKET', 'LIMIT'], required: true },

    /**
     * Whole units for equities, fractional for crypto and forex.
     *
     * `min` drops from 1 to the quantisation step for the same reason the
     * holding's does: one whole BTC is not an order a $10,000 account can
     * place, so a whole-unit minimum would make the market unreachable rather
     * than strict.
     */
    quantity: {
      type: Number,
      required: true,
      min: 1e-8,
      validate: {
        validator: function (v) {
          return this.assetClass === 'stocks' ? Number.isInteger(v) : Number.isFinite(v);
        },
        message: 'quantity must be a whole number for equities',
      },
    },

    /** Set only for LIMIT orders. Integer cents, native currency. */
    limitPriceCents: { type: Number, min: 0 },

    /* ---- populated on fill ---------------------------------------------- */
    fillPriceCents: { type: Number, min: 0 }, // native, shown on the receipt
    fillPriceUsdCents: { type: Number, min: 0 }, // USD, rounded — display only
    /**
     * THE PRICE THE LEDGER ACTUALLY USED, in billionths of a dollar.
     *
     * `fillPriceUsdCents` above cannot carry it: a coin quoting at $0.0051
     * rounds to 1 cent, and a forex rate is not a cent figure at all. This is
     * the field `totalCents` was computed from, so a receipt can reproduce the
     * arithmetic rather than approximately agree with it. See lib/money.js.
     */
    fillPriceUsdNanos: { type: Number, min: 0 },
    totalCents: { type: Number, min: 0 }, // USD, quantity * fillPriceUsdCents
    currency: { type: String, default: 'USD' },
    filledAt: { type: Date },

    status: {
      type: String,
      enum: ['PENDING', 'FILLED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    rejectReason: { type: String },

    /**
     * Idempotency is enforced by the unique index below rather than by a lock:
     * the order row is inserted FIRST, so a duplicate submit collides on insert
     * (E11000) and we return the original order instead of double-charging.
     */
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);
/** Used by the sweeper that fills limit orders once they become marketable. */
orderSchema.index({ status: 1, symbol: 1 });

orderSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Order = mongoose.model('Order', orderSchema);
