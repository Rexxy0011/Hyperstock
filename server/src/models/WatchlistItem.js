import mongoose from 'mongoose';

/**
 * One followed instrument, in any of the three asset classes.
 *
 * WHY THIS IS A COLLECTION AND NOT AN ARRAY ON `User`. It was `User.watchlist:
 * [String]`, which the Markets page cannot use: a bare symbol does not say what
 * kind of thing it is. `ETH` is a coin here and a plausible ticker elsewhere,
 * and `EURUSD` is neither — so the class has to be stored alongside the symbol
 * or the row cannot be resolved back to anything. Once the entry is a pair, a
 * subdocument array buys nothing that a collection does not, and it loses the
 * unique index that makes a double-add a no-op instead of a duplicate row.
 *
 * NO REF TO `Stock`, deliberately. Crypto and forex rows exist only in the
 * market service's vendor cache — there is no document to point at — so this
 * stores the identifying pair as plain strings and resolution happens at read
 * time. Which also means an entry can outlive its row: a coin that drops out
 * of CoinGecko's top 50 still has a record here, and `watchlist.service.js`
 * returns it unresolved rather than dropping it, so the user can still remove
 * something they can no longer see.
 */
const watchlistItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    assetClass: {
      type: String,
      required: true,
      enum: ['stocks', 'crypto', 'forex'],
    },

    symbol: { type: String, required: true, uppercase: true, trim: true },
  },
  { timestamps: true },
);

/**
 * One row per user per instrument. This is what makes `add` idempotent under
 * concurrency — a double-tap on the plus button cannot create two rows, so the
 * handler can treat E11000 as success rather than reading before writing.
 *
 * The class is part of the key, not just the symbol: a user may legitimately
 * follow an equity and a coin that share a ticker.
 */
watchlistItemSchema.index({ userId: 1, assetClass: 1, symbol: 1 }, { unique: true });

/** The list is rendered newest-first, so it is read on this index alone. */
watchlistItemSchema.index({ userId: 1, createdAt: -1 });

export const WatchlistItem = mongoose.model('WatchlistItem', watchlistItemSchema);
