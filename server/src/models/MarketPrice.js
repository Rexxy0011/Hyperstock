import mongoose from 'mongoose';

/**
 * A Mongo-side mirror of the crypto and forex prices, for AGGREGATION ONLY.
 *
 * WHY THIS EXISTS. The leaderboard ranks every trader in one pipeline, and it
 * can only do that because prices are reachable from inside the database —
 * that is the whole reason equity quotes are mirrored onto `Stock`. Crypto and
 * forex rows live exclusively in the market service's in-process vendor cache,
 * which a `$lookup` cannot see, so the pipeline's `$unwind` on the stocks join
 * silently DROPPED any holding it could not match. A trader half in crypto
 * would have ranked as though that half did not exist — the same failure as
 * starting the aggregation from `Holding` and losing every cash-only trader,
 * which the board already goes out of its way to avoid.
 *
 * It is a mirror and not a source. The vendor cache stays authoritative for
 * anything user-facing — the Markets table, the watchlist, an instrument page,
 * a fill — so a stale row here can misrank a board for up to one refresh
 * window but can never misprice a trade.
 *
 * Equities are deliberately NOT mirrored here. They already have `Stock`, and a
 * second copy of the same price is a second thing to keep in step.
 */
const marketPriceSchema = new mongoose.Schema(
  {
    assetClass: { type: String, enum: ['crypto', 'forex'], required: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, default: '' },
    exchange: { type: String, default: '' },

    /**
     * The precise price, in billionths of a dollar — the same unit the ledger
     * fills at. Cents cannot carry this collection: a coin quoting at $0.0051
     * rounds to 1, so a position valued off cents would be wrong by tens of
     * percent, and a forex `priceUsdCents` is not a cent figure at all.
     */
    priceUsdNanos: { type: Number, required: true, min: 0 },
    changePct: { type: Number, default: 0 },
  },
  { timestamps: true },
);

marketPriceSchema.index({ assetClass: 1, symbol: 1 }, { unique: true });

export const MarketPrice = mongoose.model('MarketPrice', marketPriceSchema);
