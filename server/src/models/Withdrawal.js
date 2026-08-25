import mongoose from 'mongoose';

/**
 * A payout request, as a first-class object with a state machine — the mirror
 * of `Deposit`, and deliberately not a copy of it.
 *
 * WHAT IS DIFFERENT FROM A DEPOSIT, AND WHY IT MATTERS
 *
 * A deposit waits for money to arrive: nothing is credited until a human has
 * seen the payment, so the risk of getting it wrong is that a user waits. A
 * withdrawal SENDS money, and the failure modes are the other way round —
 * paying twice, paying more than the account holds, or paying an address the
 * user cannot reach. So three things differ:
 *
 *   1. The cash is DEBITED WHEN THE WITHDRAWAL IS REQUESTED, not on approval.
 *      Debiting on approval leaves a window in which the user can spend the
 *      money they have already asked to withdraw — request $5,000, buy $5,000
 *      of stock, and the approval either overdraws the account or fails and
 *      leaves the payout stuck with nothing an operator can do about it. The
 *      debit is a hold; `cancelled` and `rejected` post a reversing credit.
 *
 *   2. The address is the USER'S, and it is typed by hand. A deposit's address
 *      is ours and comes from configuration; here the one thing standing
 *      between the funds and a stranger's wallet is a string somebody pasted,
 *      which is why it is echoed back for confirmation before submission and
 *      recorded immutably afterwards.
 *
 *   3. Approval requires the row to have been CLAIMED first. `requested →
 *      under_review` is a compare-and-set, so two operators working the same
 *      queue cannot both send the funds — the loser matches no document. On a
 *      deposit a double approval credits twice, which is recoverable. Here it
 *      is money out of the door.
 *
 *   requested ─▶ under_review ─▶ approved
 *       │              │
 *       │              └──────▶ rejected      (both reverse the hold)
 *       └───────────▶ cancelled
 *
 * NOTE WHAT THIS MODEL DOES NOT DO: it does not send anything. `approved`
 * records that an operator sent the funds by hand and what the transaction hash
 * was. There is no custody integration behind it — see "Not built yet".
 */

export const WITHDRAWAL_STATUS = {
  REQUESTED: 'requested',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

/**
 * The only transitions that may happen, keyed by the state being left. Data
 * rather than `if` statements, so the machine can be read in one place and
 * asserted in a test — including the property that matters most here, that
 * nothing but `under_review` can reach `approved`.
 */
export const WITHDRAWAL_TRANSITIONS = {
  [WITHDRAWAL_STATUS.REQUESTED]: [WITHDRAWAL_STATUS.UNDER_REVIEW, WITHDRAWAL_STATUS.CANCELLED],
  [WITHDRAWAL_STATUS.UNDER_REVIEW]: [WITHDRAWAL_STATUS.APPROVED, WITHDRAWAL_STATUS.REJECTED],
  // Terminal.
  [WITHDRAWAL_STATUS.APPROVED]: [],
  [WITHDRAWAL_STATUS.REJECTED]: [],
  [WITHDRAWAL_STATUS.CANCELLED]: [],
};

/** The two that hand the money back, and the only two that may. */
export const REVERSING_STATUSES = [WITHDRAWAL_STATUS.REJECTED, WITHDRAWAL_STATUS.CANCELLED];

export const isTerminal = (status) => WITHDRAWAL_TRANSITIONS[status]?.length === 0;

const withdrawalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** `WDR-2026-8F92K1`. Same alphabet as a deposit reference, different
     *  prefix — an operator must never have to guess which queue a code is in. */
    reference: { type: String, required: true, unique: true, uppercase: true, trim: true },

    method: { type: String, enum: ['crypto'], required: true, default: 'crypto' },

    asset: { type: String, required: true, uppercase: true, trim: true },
    network: { type: String, required: true, uppercase: true, trim: true },

    /**
     * WHERE THE MONEY GOES, supplied by the user.
     *
     * Recorded rather than referenced, for the reason a deposit records ours:
     * this is the instruction that was actually given, and it must still read
     * the same after the user has edited their saved addresses.
     */
    destinationAddress: { type: String, required: true, trim: true },

    /** Carried onto the row so a rotated config cannot rewrite the warning a
     *  user was shown about the chain they picked. */
    networkNote: { type: String, default: '', maxlength: 280 },

    /** What leaves the account. Integer cents, as everywhere. */
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'amountCents must be an integer' },
    },

    /**
     * The quantity to send, and the rate it was struck at.
     *
     * Rounded DOWN here, which is the opposite of a deposit and deliberately
     * so. Both round in the house's favour by a fraction of a unit, because the
     * alternative in each case is worse: a deposit rounded down arrives short
     * and a reviewer has to chase it, and a withdrawal rounded up pays out
     * marginally more than the account was debited, which the ledger would then
     * disagree with.
     */
    assetAmount: { type: Number, required: true, min: 0 },
    assetDecimals: { type: Number, default: 8, min: 0, max: 18 },
    rateUsdNanos: { type: Number, required: true, min: 1 },
    quotedAt: { type: Date, default: Date.now },

    /** Reachable about this payout specifically — an account email can change
     *  and the reviewer needs the one that was current when it was requested. */
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },

    status: {
      type: String,
      enum: Object.values(WITHDRAWAL_STATUS),
      default: WITHDRAWAL_STATUS.REQUESTED,
      required: true,
    },

    /**
     * Set once the hold has been handed back, so a reversal can never post
     * twice even if the status machine were somehow bypassed. The ledger's
     * unique {type, reference} index is the other guard; this one is readable.
     */
    reversedAt: { type: Date },

    /** Filled in on approval: what the operator actually sent. */
    txHash: { type: String, trim: true },

    /** Every transition, oldest first. */
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

    reviewedAt: { type: Date },
    completedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, maxlength: 280 },

    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);

withdrawalSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
