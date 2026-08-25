import mongoose from 'mongoose';

/**
 * A funding request, as a FIRST-CLASS OBJECT with a state machine.
 *
 * The thing this model exists to prevent is `isPaid: true`. A boolean cannot
 * answer "when did it change, who changed it, and what was it before" — and a
 * financial movement that cannot answer those is not auditable. Every
 * transition below is timestamped and the terminal ones record who made them.
 *
 *   created ─▶ awaiting_payment ─▶ payment_detected ─▶ under_review ─▶ approved
 *                    │                                       │
 *                    ├────────────▶ expired                  └──────▶ rejected
 *                    └────────────▶ cancelled
 *
 * The deposit is created BEFORE the user is shown anywhere to send funds, so a
 * closed tab, a dropped connection or a session that ends mid-flow loses
 * nothing: the row already exists and `reference` is the permanent handle to
 * it. Nothing about this flow lives in React state.
 */

export const DEPOSIT_STATUS = {
  CREATED: 'created',
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_DETECTED: 'payment_detected',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

/**
 * The only transitions that may happen, keyed by the state being left.
 *
 * Declared as data rather than scattered through `if` statements in the
 * service, so the machine can be read in one place and asserted in a test.
 * Anything not listed here is rejected — including the ones that look harmless,
 * like approving twice.
 */
export const DEPOSIT_TRANSITIONS = {
  [DEPOSIT_STATUS.CREATED]: [DEPOSIT_STATUS.AWAITING_PAYMENT, DEPOSIT_STATUS.CANCELLED],
  [DEPOSIT_STATUS.AWAITING_PAYMENT]: [
    DEPOSIT_STATUS.PAYMENT_DETECTED,
    DEPOSIT_STATUS.CANCELLED,
    DEPOSIT_STATUS.EXPIRED,
  ],
  [DEPOSIT_STATUS.PAYMENT_DETECTED]: [DEPOSIT_STATUS.UNDER_REVIEW, DEPOSIT_STATUS.REJECTED],
  [DEPOSIT_STATUS.UNDER_REVIEW]: [DEPOSIT_STATUS.APPROVED, DEPOSIT_STATUS.REJECTED],
  // Terminal.
  [DEPOSIT_STATUS.APPROVED]: [],
  [DEPOSIT_STATUS.REJECTED]: [],
  [DEPOSIT_STATUS.EXPIRED]: [],
  [DEPOSIT_STATUS.CANCELLED]: [],
};

export const isTerminal = (status) => DEPOSIT_TRANSITIONS[status]?.length === 0;

const depositSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /**
     * The handle everything else quotes — the URL, the user's screen, the admin
     * queue, the reconciliation. Human-readable on purpose: identifying a
     * payment by wallet address does not work when one address receives many.
     */
    reference: { type: String, required: true, unique: true, uppercase: true, trim: true },

    method: { type: String, enum: ['crypto', 'bank'], required: true },

    asset: { type: String, required: true, uppercase: true, trim: true },
    network: { type: String, required: true, uppercase: true, trim: true },

    /** Where the user was told to send it. Recorded, not derived at read time —
     *  a rotated treasury address must not rewrite the history of old deposits. */
    destinationAddress: { type: String, required: true },

    /**
     * A per-network warning shown on the payment screen, stored with the
     * deposit for the same reason the address is.
     *
     * It exists for cases like BTCB, where the asset a user thinks they are
     * sending and the asset the address can receive are DIFFERENT THINGS, and
     * getting it wrong loses the funds permanently.
     */
    networkNote: { type: String, default: '', maxlength: 280 },

    /** What the account is credited on approval. Integer cents, as everywhere. */
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'amountCents must be an integer' },
    },

    /**
     * THE EXACT QUANTITY TO SEND, and the rate it was quoted at.
     *
     * A payment is matched on the ASSET amount, not on a dollar figure — the
     * chain has no idea what $1,000 is. At $0.999696, $1,000 is 1000.304 USDT,
     * and a screen that says "send $1,000.00" leaves the user to do that
     * conversion themselves against a rate that is already moving.
     *
     * `rateUsdNanos` is stored rather than re-derived precisely because it
     * moves: it is what the quote was struck at, and it is the reason the quote
     * EXPIRES. Recomputing the amount at read time would silently change what
     * the user was told to send after they had already sent it.
     */
    assetAmount: { type: Number, required: true, min: 0 },
    /** The asset's own precision — 6 for USDT, 8 for BTC. Quoting more places
     *  than the chain carries produces an amount that cannot be sent exactly. */
    assetDecimals: { type: Number, default: 8, min: 0, max: 18 },
    rateUsdNanos: { type: Number, required: true, min: 1 },
    quotedAt: { type: Date, default: Date.now },

    /**
     * Where to reach the depositor about THIS payment.
     *
     * Not redundant with the account's email. Over- and underpayment is the
     * common way a crypto deposit goes wrong and it cannot be fixed without a
     * conversation, so the address is captured on the deposit itself — an
     * account email can change, and the reviewer needs the one that was current
     * when the money moved.
     */
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },

    /* ---- filled in as the payment is claimed and checked ----------------- */
    txHash: { type: String, trim: true },
    senderAddress: { type: String, trim: true },
    blockNumber: { type: Number },
    confirmations: { type: Number, default: 0 },

    status: {
      type: String,
      enum: Object.values(DEPOSIT_STATUS),
      default: DEPOSIT_STATUS.CREATED,
      required: true,
    },

    /** Every transition, oldest first. The audit trail a boolean cannot carry. */
    history: [
      {
        _id: false,
        from: String,
        to: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],

    expiresAt: { type: Date },
    detectedAt: { type: Date },
    reviewedAt: { type: Date },
    completedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, maxlength: 280 },

    /** Makes a double-submitted create form one deposit rather than two. */
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

depositSchema.index({ status: 1, createdAt: -1 });
depositSchema.index({ userId: 1, createdAt: -1 });
depositSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);

/**
 * ONE DEPOSIT PER TRANSACTION HASH, enforced by the database.
 *
 * Without this the same on-chain payment can be pasted into two different
 * deposits and credited twice — and it would look entirely legitimate in the
 * admin queue both times, because each row is individually well-formed. Partial
 * so the many deposits with no hash yet do not collide on null.
 */
depositSchema.index(
  { txHash: 1 },
  { unique: true, partialFilterExpression: { txHash: { $type: 'string' } } },
);

depositSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Deposit = mongoose.model('Deposit', depositSchema);
