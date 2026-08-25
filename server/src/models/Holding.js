import mongoose from 'mongoose';
import { QTY_DECIMALS } from '../lib/money.js';

export const HOLDING_CLASSES = ['stocks', 'crypto', 'forex'];

const holdingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /**
     * WHAT KIND OF THING THIS IS, and it is not optional information.
     *
     * A bare symbol cannot identify an instrument once there is more than one
     * class: `ETH` is a coin here and a plausible ticker elsewhere, `EURUSD` is
     * neither. `WatchlistItem` learned this first and this is the same fix —
     * the key is the pair, never the symbol alone.
     *
     * Defaulted to 'stocks' so every row written before crypto and forex were
     * tradable keeps its meaning without a data migration.
     */
    assetClass: {
      type: String,
      enum: HOLDING_CLASSES,
      required: true,
      default: 'stocks',
      index: true,
    },

    symbol: { type: String, required: true, uppercase: true, trim: true },

    /**
     * Whole shares for equities; fractional for crypto and forex.
     *
     * The equity rule is unchanged and deliberate — the design has no
     * fractional shares and no venue here sells them. The other two classes
     * cannot work that way: with a $10,000 account, whole units of BTC at
     * ~$79,000 is not a position anyone can open, so a whole-unit crypto market
     * would be a Trade button that never fills.
     *
     * This is a COUNT, not money — money stays integer cents throughout, and
     * `costBasisCents` below is still an integer. Floats are acceptable for a
     * quantity in a way they are never acceptable for a balance.
     */
    shares: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (v) {
          if (this.assetClass === 'stocks') return Number.isInteger(v);
          // Anything finer than the quantisation step is dust, not a position.
          return Number.isFinite(v) && v >= 0;
        },
        message: 'shares must be a whole number for equities',
      },
    },

    /**
     * Total USD cents paid for the current position.
     *
     * Cost basis is stored and average cost is DERIVED (costBasisCents / shares)
     * rather than the reverse: storing an average would round on every partial
     * buy and drift the position's book value away from what was actually paid.
     */
    costBasisCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'costBasisCents must be an integer' },
    },
  },
  { timestamps: true },
);

/**
 * Average cost per unit in cents. Never persisted — always derived.
 *
 * Rounds to a cent, which is right for an equity and lossy for 0.004 BTC. The
 * precise figure is recoverable from `costBasisCents / shares` by anyone who
 * needs it; this is the display value, and a fractional cent is not a price
 * anyone can act on.
 */
holdingSchema.virtual('avgCostCents').get(function () {
  return this.shares ? Math.round(this.costBasisCents / this.shares) : 0;
});

/**
 * One position per user per instrument. This is what makes the buy-side upsert
 * safe under concurrency — two simultaneous buys cannot create two rows.
 *
 * NOTE the class is in the key. The previous index was `{userId, symbol}`,
 * which is not merely narrower: it would refuse a second row for a symbol that
 * legitimately exists in two classes. `config/db.js` drops the old one at boot.
 */
holdingSchema.index({ userId: 1, assetClass: 1, symbol: 1 }, { unique: true });
holdingSchema.index({ symbol: 1 });

/** Quantities are rounded to the storage precision on the way in, always. */
export const HOLDING_QTY_DECIMALS = QTY_DECIMALS;

export const Holding = mongoose.model('Holding', holdingSchema);
