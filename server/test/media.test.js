import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { storeImage, readImage, mediaUrl, MAX_BYTES } from '../src/services/media.service.js';

/**
 * The image store behind trader avatars.
 *
 * THE INTERESTING CASES ARE ALL ABOUT WHAT IS REFUSED. These bytes are served
 * back from our own origin, so the format decision is a security decision
 * rather than a validation nicety: a caller who can choose the `Content-Type`
 * we replay chooses how a browser interprets a file on our domain.
 */

/** Minimal but genuine headers — the sniffer reads magic numbers, not names. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(32, 3)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(32, 4),
]);

test('media store', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());
  assert.equal(isEphemeral(), true, 'refusing to run against a non-ephemeral database');

  await t.test('accepts the four real image formats', async () => {
    for (const [buf, expected] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ]) {
      const result = await storeImage(buf, null);
      assert.equal(result.contentType, expected);
      assert.equal(result.bytes, buf.length);
    }
  });

  await t.test('the id is the sha-256 of the bytes', async () => {
    const { id, url } = await storeImage(PNG, null);
    assert.equal(id, crypto.createHash('sha256').update(PNG).digest('hex'));
    assert.equal(url, mediaUrl(id));
  });

  /**
   * Content addressing exists so a curator who tries three pictures and settles
   * on the first leaves one document rather than three.
   */
  await t.test('the same image twice is one document, not two', async () => {
    const a = await storeImage(JPEG, null);
    const b = await storeImage(JPEG, null);
    assert.equal(a.id, b.id);

    const doc = await readImage(a.id);
    assert.ok(doc, 'stored and readable');
    assert.equal(doc.bytes, JPEG.length);
  });

  await t.test('round-trips the exact bytes', async () => {
    const { id } = await storeImage(WEBP, null);
    const doc = await readImage(id);
    assert.deepEqual(Buffer.from(/** @type {any} */ (doc.data).buffer ?? doc.data), WEBP);
  });

  /**
   * SVG IS AN IMAGE FORMAT THAT CAN CONTAIN `<script>`, and served from this
   * origin that script would run with this origin's cookies. It is refused as a
   * class rather than sanitised.
   */
  await t.test('refuses SVG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await assert.rejects(() => storeImage(svg, null), (err) => /** @type {any} */ (err).code === 'UNSUPPORTED_IMAGE');
  });

  await t.test('refuses HTML dressed as an upload', async () => {
    const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>'.padEnd(64));
    await assert.rejects(() => storeImage(html, null), (err) => /** @type {any} */ (err).code === 'UNSUPPORTED_IMAGE');
  });

  /**
   * The type is sniffed from the BYTES. A PNG header on a file claiming to be
   * something else is a PNG, and — the direction that matters — a non-image
   * cannot smuggle itself in behind an image content type, because the header
   * is never consulted.
   */
  await t.test('a RIFF container that is not WEBP is refused', async () => {
    // The first four bytes also front WAV and AVI, which is why the sniffer
    // tests byte 8 as well.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4, 0),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(32, 0),
    ]);
    await assert.rejects(() => storeImage(wav, null), (err) => /** @type {any} */ (err).code === 'UNSUPPORTED_IMAGE');
  });

  await t.test('refuses an empty upload', async () => {
    await assert.rejects(() => storeImage(Buffer.alloc(0), null), (err) => /** @type {any} */ (err).code === 'EMPTY_UPLOAD');
  });

  await t.test('refuses anything over the size cap', async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES + 1)]);
    await assert.rejects(() => storeImage(huge, null), (err) => /** @type {any} */ (err).code === 'IMAGE_TOO_LARGE');
  });

  await t.test('a malformed id is not a database query', async () => {
    // The route takes this straight off the path, so it must reject rather than
    // hand an arbitrary string to Mongo.
    assert.equal(await readImage('../../etc/passwd'), null);
    assert.equal(await readImage('nope'), null);
    assert.equal(await readImage(''), null);
  });
});
