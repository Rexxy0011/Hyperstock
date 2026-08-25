import mongoose from 'mongoose';

/**
 * Cached market news, one document per article.
 *
 * One-per-article rather than one blob per query — as `Candle` does — because
 * the same story arrives twice: once in the general feed and again in a
 * company feed for every ticker it mentions. A unique index on `url` makes
 * that dedupe free, and `symbols` accumulates across those arrivals, so a
 * story picked up under AAPL can still surface in the general list.
 *
 * `expiresAt` carries a TTL index, so the collection prunes itself rather than
 * growing without bound. Note that whether the cache is WARM is not derivable
 * from this collection — an empty result is ambiguous between "not fetched
 * yet" and "the vendor genuinely had nothing" — so the service tracks fetch
 * times separately.
 */
const newsArticleSchema = new mongoose.Schema(
  {
    /** Which adapter produced it, so a degraded feed can be labelled as one. */
    source: { type: String, required: true, enum: ['finnhub', 'rss'] },

    /** The named feed behind it — "Finnhub", "FXStreet", "Nasdaq". */
    sourceName: { type: String, default: '' },

    /**
     * Which market the story belongs to. Not derived from the article: it is
     * whichever feed was asked for, because no free source tags this reliably
     * and guessing it from the text would be worse than knowing where it came
     * from.
     */
    assetClass: {
      type: String,
      required: true,
      enum: ['stocks', 'crypto', 'forex', 'commodities'],
      index: true,
    },

    /** Tickers the story is about. Empty for general market news. */
    symbols: { type: [String], default: [], index: true },

    headline: { type: String, required: true },
    summary: { type: String, default: '' },
    url: { type: String, required: true, unique: true },
    imageUrl: { type: String, default: '' },
    publisher: { type: String, default: '' },
    category: { type: String, default: '' },

    publishedAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

newsArticleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// The list query: newest first, optionally filtered to one class or ticker.
newsArticleSchema.index({ publishedAt: -1 });
newsArticleSchema.index({ assetClass: 1, publishedAt: -1 });

newsArticleSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    delete ret.expiresAt;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const NewsArticle = mongoose.model('NewsArticle', newsArticleSchema);
