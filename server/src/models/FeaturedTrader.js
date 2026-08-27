import mongoose from 'mongoose';

/**
 * An operator-curated row on the leaderboard.
 *
 * WHAT IT IS FOR. The board ranks on live portfolio value, which nobody
 * controls — so there is no way to put a particular trader at the top of it for
 * a day. This collection is that lever: an admin writes a name, a figure and a
 * percentage, and the row takes its place on the board.
 *
 * IT DOES NOT STOP THE AUTOMATED BOARD. Real accounts are still aggregated,
 * ranked and refreshed exactly as before; a featured row is merged into the
 * result and then the whole list is re-ranked together. So a featured trader is
 * not pinned to position one — it earns its place from the figure that was
 * typed, the same way every other row does. Type a big number and it leads;
 * type a small one and it sits mid-table. That is deliberate: a pin would put a
 * $900 account above a $58,000 one and the board would visibly contradict its
 * own ordering.
 *
 * `userId` IS OPTIONAL, AND THE TWO MODES ARE DIFFERENT TOOLS. Left null, this
 * is a standalone row invented from nothing. Set, it OVERRIDES an existing
 * account's displayed figures — the underlying user is dropped from the board
 * and this row takes its place, so an account cannot appear twice at two
 * different values, which is the one outcome that would look like a bug rather
 * than a decision.
 *
 * NOTHING HERE TOUCHES MONEY. No balance, no ledger entry, no holding. It
 * changes what a leaderboard row DISPLAYS and nothing else — an overridden
 * user's real cash, positions and portfolio page are untouched.
 */
const featuredTraderSchema = new mongoose.Schema(
  {
    /**
     * What the row is called. Free text, because the whole point is that it
     * need not correspond to an account. When `userId` is set this is still
     * stored rather than read through the join, so renaming the account later
     * cannot silently rewrite a row an operator composed by hand.
     */
    name: { type: String, required: true, trim: true, maxlength: 60 },

    /**
     * The account this row stands in for, if any. Indexed sparsely because most
     * rows are standalone, and unique so one account cannot be overridden twice
     * — two rows for one user would resolve to two ranks for one trader.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } },
    },

    /**
     * Integer cents, like every other monetary field in this codebase. This is
     * the figure the board sorts on, so it is what decides where the row lands.
     */
    portfolioValueCents: { type: Number, required: true, min: 0 },

    /**
     * The gain or loss to display, as a plain percentage — negative is allowed,
     * because a curated board that only ever shows green is its own kind of
     * tell. It fills BOTH the period return and the day change, and the day's
     * cash figure beside it is derived from this rather than typed separately:
     * two independently entered numbers on one row is how a value and its own
     * percentage come to disagree, which is a bug this project has already had
     * on the ticker tape.
     */
    changePct: { type: Number, required: true, min: -100, max: 100_000 },

    /**
     * An uploaded portrait for this row, or empty for the generated mark.
     *
     * A PATH INTO OUR OWN MEDIA STORE, never a third-party URL — see the note
     * on `Media`. Stored on the row rather than on the user because it is part
     * of the CURATION: it says what this leaderboard row displays, and clearing
     * the override must take the picture with it rather than leave a portrait
     * attached to an account that never chose one.
     *
     * `Avatar` already prefers `src` over its generated artwork and falls back
     * on the image's own error event, so an empty value and a dead one both
     * degrade to the mark rather than to a broken frame.
     */
    avatarUrl: { type: String, default: '', trim: true, maxlength: 120 },

    /** Displayed in the Trades column. Counts nothing; it is a display figure. */
    trades: { type: Number, default: 0, min: 0 },

    /**
     * The Best position column, optional. Without it the row renders an em dash
     * where every computed row shows a symbol, which is exactly the sort of gap
     * that makes a curated row identifiable at a glance.
     */
    bestSymbol: { type: String, default: '', trim: true, uppercase: true, maxlength: 12 },
    bestReturnPct: { type: Number, default: 0 },

    /**
     * Off rather than deleted, so a row prepared for a campaign can be staged
     * and switched on, and switched off again without losing what was typed.
     */
    active: { type: Boolean, default: true, index: true },

    /** Which admin last wrote it. The only audit trail this collection has. */
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// The board reads active rows on every request, so the one filter it uses is
// the one that is indexed.
featuredTraderSchema.index({ active: 1, portfolioValueCents: -1 });

export const FeaturedTrader = mongoose.model('FeaturedTrader', featuredTraderSchema);
