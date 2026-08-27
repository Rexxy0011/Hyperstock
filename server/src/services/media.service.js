import crypto from 'node:crypto';
import { Media } from '../models/Media.js';
import { ApiError } from '../lib/ApiError.js';

/**
 * Storing and reading small images.
 *
 * THE TYPE IS SNIFFED FROM THE BYTES, NEVER READ FROM THE HEADER, and that is
 * the load-bearing decision in this file. `Content-Type` is supplied by whoever
 * is uploading; trusting it means an attacker chooses how a browser interprets
 * a file we then serve from our own origin, which is a stored-XSS shape rather
 * than a mislabelled picture.
 *
 * SVG IS REFUSED, and it is refused on purpose rather than forgotten. It is an
 * image format that can contain `<script>`, and served from this origin that
 * script runs with this origin's cookies. Nothing about an avatar needs vector
 * art, so the whole class is simply not accepted — the same instinct as
 * `CoinIcon` refusing to draw a trademark by hand rather than approximating it.
 */

/** Generous for an avatar, small enough that a document stays a document. */
export const MAX_BYTES = 600 * 1024;

/**
 * Magic numbers, in the order they are tested.
 *
 * WEBP is two checks, not one: the first four bytes are the RIFF container,
 * which also fronts WAV and AVI, so the format only becomes WEBP at byte 8.
 */
function sniff(buf) {
  if (buf.length < 12) return null;

  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  const gif = buf.toString('ascii', 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';

  return null;
}

/**
 * Stores an image and returns the URL it is reachable at.
 *
 * Idempotent by construction: the id is the hash, so uploading the same bytes
 * twice writes the same document rather than a second copy.
 */
export async function storeImage(buffer, uploadedBy = null) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('EMPTY_UPLOAD', 'No image data was received.');
  }
  if (buffer.length > MAX_BYTES) {
    throw ApiError.badRequest(
      'IMAGE_TOO_LARGE',
      `Images must be ${Math.round(MAX_BYTES / 1024)}KB or smaller.`,
    );
  }

  const contentType = sniff(buffer);
  if (!contentType) {
    throw ApiError.badRequest('UNSUPPORTED_IMAGE', 'Use a PNG, JPEG, WebP or GIF image.');
  }

  const id = crypto.createHash('sha256').update(buffer).digest('hex');

  await Media.updateOne(
    { _id: id },
    {
      $set: { contentType, bytes: buffer.length, data: buffer },
      $setOnInsert: { uploadedBy },
    },
    { upsert: true },
  );

  return { id, url: mediaUrl(id), contentType, bytes: buffer.length };
}

/**
 * The path an image is served at.
 *
 * A RELATIVE PATH, NOT AN ABSOLUTE URL. The API and the client are different
 * origins once this is deployed, and baking `API_ORIGIN` into a value stored on
 * a `FeaturedTrader` row would freeze today's hostname into tomorrow's data —
 * the same reason a deposit stores its address rather than deriving it later.
 * The client already proxies `/api`, so a relative path resolves on both.
 */
export const mediaUrl = (id) => `/api/media/${id}`;

/** The stored bytes, or null. */
export function readImage(id) {
  if (!/^[a-f0-9]{64}$/.test(String(id ?? ''))) return null;
  return Media.findById(id).lean();
}
