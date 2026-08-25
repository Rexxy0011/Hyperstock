import mongoose from 'mongoose';

/**
 * Cached OHLC series, one document per {symbol, range}.
 *
 * Fetched lazily on first request, never prefetched: ~40 symbols x 6 ranges is
 * 240 combinations, far too many to refresh eagerly against a rate-limited
 * vendor. `expiresAt` carries a TTL index so stale ranges evict themselves.
 */
const candleSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true },
    range: { type: String, required: true, enum: ['1D', '1W', '1M', '3M', '1Y', 'ALL'] },
    currency: { type: String, default: 'USD' },

    points: [
      {
        _id: false,
        t: { type: Number, required: true }, // epoch ms
        o: Number,
        h: Number,
        l: Number,
        c: { type: Number, required: true },
        v: Number,
      },
    ],

    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

candleSchema.index({ symbol: 1, range: 1 }, { unique: true });
candleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Candle = mongoose.model('Candle', candleSchema);
