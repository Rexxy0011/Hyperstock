import mongoose from 'mongoose';

const exchangeSchema = new mongoose.Schema(
  {
    /**
     * NOT uppercased: Stock.exchange stores the design's own casing ("Euronext"),
     * and forcing this to "EURONEXT" would silently break every join between the
     * two collections — and render the marketing table in the wrong case.
     */
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    region: { type: String, required: true },

    /** The Landing table's fixed order — by region, not by size. */
    displayOrder: { type: Number, default: 0 },

    /** Local trading hours, "HH:mm". Combined with `timezone` to compute isOpen. */
    openTime: { type: String, required: true },
    closeTime: { type: String, required: true },
    /** IANA zone, e.g. "America/New_York" — needed to resolve DST correctly. */
    timezone: { type: String, required: true },
    /** Short label the design renders, e.g. "EST", "CET", "JST". */
    tzLabel: { type: String, required: true },

    /** Headline count shown in the Landing "Markets covered" table. */
    stockCount: { type: Number, required: true },

    currency: { type: String, required: true, default: 'USD' },
  },
  { timestamps: true },
);

export const Exchange = mongoose.model('Exchange', exchangeSchema);
