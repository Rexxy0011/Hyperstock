import mongoose from 'mongoose';

/**
 * A small image, stored in Mongo and served from our own origin.
 *
 * WHY IN THE DATABASE AT ALL. There is no object store, no disk the API can
 * rely on across a redeploy, and no CDN in this project — so the alternatives
 * were a third-party host or nothing. A pasted external URL was the cheaper
 * option and is the worse one: this codebase has already measured what happens
 * to hotlinked images (Investing.com 403s every enclosure it publishes from any
 * origin but its own), and an avatar that 404s six months later on a public
 * leaderboard is a broken frame nobody is watching for. Avatars are a few tens
 * of kilobytes; that fits a document comfortably.
 *
 * CONTENT-ADDRESSED: `_id` IS THE SHA-256 OF THE BYTES. Three things fall out
 * of that and each was the reason to do it rather than an ObjectId:
 *
 * - Re-uploading the same picture is an upsert onto the same row, so a curator
 *   trying three images and settling on the first leaves one document.
 * - The URL can be cached `immutable` forever, because the bytes at a given id
 *   cannot change by construction. There is no cache to bust.
 * - Nothing about the id leaks who uploaded it or when.
 *
 * `data` IS A Buffer, NOT A base64 STRING. Base64 is a third larger and would
 * have to be decoded on every read; Mongo stores binary natively.
 */
const mediaSchema = new mongoose.Schema(
  {
    /** Lower-case hex sha-256 of `data`. */
    _id: { type: String, required: true },

    /**
     * Sniffed from the bytes, never taken from the request header.
     *
     * A caller-supplied content type is a caller-supplied instruction to the
     * browser about how to interpret what we serve back, and we serve it from
     * our own origin. See the sniffing note in the upload route: SVG is refused
     * outright for the same reason.
     */
    contentType: { type: String, required: true },

    bytes: { type: Number, required: true, min: 1 },

    data: { type: Buffer, required: true },

    /** The only audit trail this collection has. */
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, _id: false },
);

export const Media = mongoose.model('Media', mediaSchema);
