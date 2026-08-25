import mongoose from 'mongoose';

const stockSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    exchange: { type: String, required: true, index: true },
    /** Drives the Portfolio allocation donut — Technology / Semiconductors / … */
    sector: { type: String, required: true, index: true },
    currency: { type: String, required: true, default: 'USD' },
    status: { type: String, enum: ['Listed', 'Halted'], default: 'Listed', index: true },
    about: { type: String, default: '' },

    /**
     * Vendor-specific ticker forms. Yahoo needs suffixes (7203 -> 7203.T,
     * ASML -> ASML.AS). Keeping the mapping on the document beats a separate
     * lookup table because it travels with the data it describes.
     */
    vendorSymbols: {
      yahoo: { type: String },
      finnhub: { type: String },
    },

    /* ---- live, written by the market refresh job ------------------------
       All prices are integer cents (major unit x 100), uniformly across
       currencies. `priceCents` is native for display; `priceUsdCents` is what
       every balance, order total and ranking calculation uses. */
    priceCents: { type: Number, default: 0, min: 0 },
    priceUsdCents: { type: Number, default: 0, min: 0 },
    previousCloseCents: { type: Number, default: 0, min: 0 },
    dayOpenCents: { type: Number, default: 0, min: 0 },
    dayHighCents: { type: Number, default: 0, min: 0 },
    dayLowCents: { type: Number, default: 0, min: 0 },

    /** A percentage, not money — never summed into a balance. */
    changePct: { type: Number, default: 0 },
    volume: { type: Number, default: 0, min: 0 },
    quoteAsOf: { type: Date },

    /* ---- static reference data ------------------------------------------
       marketCap and peRatio are behind Yahoo's crumb-authenticated endpoint
       (401 on anonymous requests), so they are seeded rather than fetched.
       Slow-moving data — a stale P/E is acceptable where a stale price is not. */
    /** Reference statistic, not ledger money: whole major units, not cents.
     *  Cent precision on a trillion-dollar cap is noise, and x100 would push
     *  large caps toward Number.MAX_SAFE_INTEGER. */
    marketCap: { type: Number, min: 0 },
    peRatio: { type: Number },
    week52HighCents: { type: Number, min: 0 },
    week52LowCents: { type: Number, min: 0 },
    referenceAsOf: { type: Date },
  },
  { timestamps: true },
);

stockSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Stock = mongoose.model('Stock', stockSchema);
