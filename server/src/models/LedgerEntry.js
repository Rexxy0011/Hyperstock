import mongoose from 'mongoose';

/**
 * The financial audit record: every movement of cash, with its running balance.
 *
 * WHY A BALANCE FIELD IS NOT ENOUGH. `User.cashBalanceCents` answers "how much
 * is there" and nothing else. It cannot answer where it came from, when, under
 * whose authority, or whether the sum of everything that happened still equals
 * what the field says. The moment there are deposits, withdrawals, fills, fees
 * and adjustments, the balance is a *projection* and the entries are the truth.
 *
 * This is deliberately a maintained projection rather than a derived one: the
 * balance stays on `User` and is updated in the same transaction that writes
 * the entry, because every read path in the product — the pill, the portfolio,
 * the leaderboard aggregation — wants a number without summing a history.
 * `reconcile()` in ledger.service.js asserts the two still agree, which is the
 * check that makes the projection trustworthy.
 */

export const LEDGER_TYPE = {
  OPENING: 'OPENING',
  DEPOSIT: 'DEPOSIT',
  TOPUP: 'TOPUP',
  /**
   * The hold placed when a payout is REQUESTED, not when it is approved — so
   * money already promised to a withdrawal cannot also be spent on a trade.
   * Its reversal is a separate type sharing the same reference, which is what
   * lets both sit on the ledger under the unique {type, reference} index and
   * makes a cancelled withdrawal legible as two entries rather than a deletion.
   */
  WITHDRAWAL: 'WITHDRAWAL',
  WITHDRAWAL_REVERSAL: 'WITHDRAWAL_REVERSAL',
  TRADE_BUY: 'TRADE_BUY',
  TRADE_SELL: 'TRADE_SELL',
  ADJUSTMENT: 'ADJUSTMENT',
};

const ledgerEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    type: { type: String, enum: Object.values(LEDGER_TYPE), required: true },

    /**
     * SIGNED integer cents: positive credits the account, negative debits it.
     * One signed column rather than a direction flag plus a magnitude, so a sum
     * over the collection is the balance and cannot be assembled wrongly.
     */
    amountCents: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'amountCents must be an integer' },
    },

    /** The balance immediately after this entry — what makes a statement a
     *  statement, and what makes a break in the chain findable. */
    balanceAfterCents: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'balanceAfterCents must be an integer' },
    },

    /**
     * The business object that caused this: a deposit reference, an order id.
     * Together with `type` it is UNIQUE, which is what makes posting idempotent
     * — a retried approval collides here instead of crediting a second time.
     */
    reference: { type: String, required: true, trim: true },

    detail: { type: String, default: '' },
  },
  { timestamps: true },
);

ledgerEntrySchema.index({ userId: 1, createdAt: -1 });
ledgerEntrySchema.index({ type: 1, reference: 1 }, { unique: true });

ledgerEntrySchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);
