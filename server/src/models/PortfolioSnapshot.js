import mongoose from 'mongoose';

/**
 * A daily mark of every user's portfolio value.
 *
 * Load-bearing twice over, and not optional:
 *   1. Weekly / Monthly leaderboard returns are mathematically impossible from
 *      current holdings alone — they need the value 7 and 30 days ago.
 *   2. The Portfolio screen's performance chart reads this exact series.
 */
const portfolioSnapshotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /** Normalised to UTC midnight so one row per user per day. */
    date: { type: Date, required: true },

    portfolioValueCents: { type: Number, required: true, min: 0 },
    cashBalanceCents: { type: Number, required: true, min: 0 },
    holdingsValueCents: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

portfolioSnapshotSchema.index({ userId: 1, date: -1 }, { unique: true });

export const PortfolioSnapshot = mongoose.model('PortfolioSnapshot', portfolioSnapshotSchema);
