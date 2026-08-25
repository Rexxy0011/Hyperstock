import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { Subscriber } from '../src/models/Subscriber.js';
import {
  subscribe,
  unsubscribe,
  listSubscribers,
  subscriberCounts,
} from '../src/services/subscriber.service.js';

/**
 * The marketing capture endpoint.
 *
 * It is the only PUBLIC, UNAUTHENTICATED write in the API, which is what makes
 * it worth pinning: everything else that inserts a row has a session behind it.
 * The two properties that matter are that a repeat submission cannot create a
 * second row or a 500, and that the response cannot be used to ask whether a
 * given address is already on the platform.
 */
test('subscribers', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });
  t.beforeEach(async () => Subscriber.deleteMany({}));

  await t.test('captures an address', async () => {
    const res = await subscribe({ email: 'reader@example.com', source: 'landing_cta' });
    assert.equal(res.ok, true);
    assert.equal(res.created, true);

    const row = await Subscriber.findOne({ email: 'reader@example.com' }).lean();
    assert.equal(row.source, 'landing_cta');
  });

  await t.test('normalises case and surrounding space', async () => {
    await subscribe({ email: '  Reader@Example.COM ' });
    assert.equal(await Subscriber.countDocuments({ email: 'reader@example.com' }), 1);
  });

  await t.test('a repeat submission is a no-op, not a duplicate and not an error', async () => {
    await subscribe({ email: 'twice@example.com', source: 'landing_cta' });
    const second = await subscribe({ email: 'TWICE@example.com', source: 'faq_cta' });

    assert.equal(second.ok, true);
    assert.equal(await Subscriber.countDocuments({ email: 'twice@example.com' }), 1);
  });

  await t.test('the first call to action keeps the credit', async () => {
    await subscribe({ email: 'attrib@example.com', source: 'landing_cta' });
    await subscribe({ email: 'attrib@example.com', source: 'faq_cta' });

    // Overwriting `source` would reattribute every conversion to whichever page
    // somebody happened to visit last.
    const row = await Subscriber.findOne({ email: 'attrib@example.com' }).lean();
    assert.equal(row.source, 'landing_cta');
  });

  await t.test('two simultaneous submissions cannot both insert', async () => {
    // A double-tapped button is exactly this. A find-then-create would have both
    // find nothing, both insert, and one die on the unique index with a 500.
    const results = await Promise.all([
      subscribe({ email: 'race@example.com' }),
      subscribe({ email: 'race@example.com' }),
      subscribe({ email: 'race@example.com' }),
    ]);

    assert.equal(results.every((r) => r.ok), true);
    assert.equal(await Subscriber.countDocuments({ email: 'race@example.com' }), 1);
  });

  await t.test('the caller cannot tell a new address from a known one', async () => {
    await subscribe({ email: 'known@example.com' });

    // `created` exists for the server's own counting; the ROUTE does not return
    // it. If it ever did, this endpoint becomes a free oracle for whether an
    // address is registered here.
    const routeShape = (result) => (result.ok ? { ok: true } : { error: result.code });

    assert.deepEqual(routeShape(await subscribe({ email: 'known@example.com' })), { ok: true });
    assert.deepEqual(routeShape(await subscribe({ email: 'fresh@example.com' })), { ok: true });
  });

  await t.test('refuses a malformed address', async () => {
    for (const bad of ['', 'not-an-email', 'no@tld', '@example.com', 'a b@example.com']) {
      const res = await subscribe({ email: bad });
      assert.equal(res.ok, false, `accepted ${JSON.stringify(bad)}`);
      assert.equal(res.code, 'BAD_EMAIL');
    }
    assert.equal(await Subscriber.countDocuments(), 0);
  });

  await t.test('marks an address that belongs to a registered account', async () => {
    await subscribe({ email: 'jd@hyperstocks.app' });
    await subscribe({ email: 'stranger@example.com' });

    const rows = await listSubscribers();
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.converted]));

    assert.equal(byEmail['jd@hyperstocks.app'], true);
    assert.equal(byEmail['stranger@example.com'], false);

    const counts = await subscriberCounts();
    assert.equal(counts.total, 2);
    // Computed the same way the listing computes it, or the header disagrees
    // with the table underneath it.
    assert.equal(counts.converted, 1);
  });

  /* --------------------------------------------------------- leaving the list */

  await t.test('every row gets an unguessable token', async () => {
    await subscribe({ email: 'a@example.com' });
    await subscribe({ email: 'b@example.com' });

    const [a, b] = await Subscriber.find().sort({ email: 1 }).lean();
    assert.equal(typeof a.unsubscribeToken, 'string');
    assert.ok(a.unsubscribeToken.length >= 24, 'token is too short to be unguessable');
    assert.notEqual(a.unsubscribeToken, b.unsubscribeToken);
  });

  await t.test('the token unsubscribes, and only that row', async () => {
    await subscribe({ email: 'leaving@example.com' });
    await subscribe({ email: 'staying@example.com' });

    const row = await Subscriber.findOne({ email: 'leaving@example.com' }).lean();
    assert.equal((await unsubscribe(row.unsubscribeToken)).ok, true);

    const after = await Subscriber.findOne({ email: 'leaving@example.com' }).lean();
    const other = await Subscriber.findOne({ email: 'staying@example.com' }).lean();
    assert.ok(after.unsubscribedAt instanceof Date);
    assert.equal(other.unsubscribedAt, null);
  });

  await t.test('an unknown token is indistinguishable from a real one', async () => {
    await subscribe({ email: 'someone@example.com' });
    // Anything else confirms whether a token — and therefore a subscriber —
    // exists, which is the same oracle `subscribe` refuses to be.
    assert.deepEqual(await unsubscribe('not-a-real-token-at-all'), { ok: true });
    assert.equal(await Subscriber.countDocuments({ unsubscribedAt: null }), 1);
  });

  await t.test('unsubscribing twice is not an error', async () => {
    await subscribe({ email: 'twice-out@example.com' });
    const { unsubscribeToken: token } = await Subscriber.findOne({
      email: 'twice-out@example.com',
    }).lean();

    await unsubscribe(token);
    const first = await Subscriber.findOne({ email: 'twice-out@example.com' }).lean();
    assert.deepEqual(await unsubscribe(token), { ok: true });
    const second = await Subscriber.findOne({ email: 'twice-out@example.com' }).lean();

    // The filter carries `unsubscribedAt: null`, so a second click on an old
    // mail cannot move the date it originally recorded.
    assert.equal(Number(second.unsubscribedAt), Number(first.unsubscribedAt));
  });

  await t.test('re-submitting the form is fresh consent and rejoins the list', async () => {
    await subscribe({ email: 'back@example.com' });
    const { unsubscribeToken: token } = await Subscriber.findOne({
      email: 'back@example.com',
    }).lean();
    await unsubscribe(token);

    // `$setOnInsert` would leave `unsubscribedAt` in place on an existing row,
    // silently dropping the submission while showing a confirmation for it.
    await subscribe({ email: 'back@example.com' });
    const row = await Subscriber.findOne({ email: 'back@example.com' }).lean();
    assert.equal(row.unsubscribedAt, null);
  });

  await t.test('the counts separate the list size from the row count', async () => {
    await subscribe({ email: 'in@example.com' });
    await subscribe({ email: 'out@example.com' });
    const { unsubscribeToken } = await Subscriber.findOne({ email: 'out@example.com' }).lean();
    await unsubscribe(unsubscribeToken);

    const counts = await subscriberCounts();
    assert.equal(counts.total, 2);
    // Reporting `total` as the list size overstates every send.
    assert.equal(counts.subscribed, 1);

    const rows = await listSubscribers();
    assert.equal(rows.find((r) => r.email === 'out@example.com').subscribed, false);
    assert.equal(rows.find((r) => r.email === 'in@example.com').subscribed, true);
  });

  await t.test('the admin listing never carries the token', async () => {
    await subscribe({ email: 'private@example.com' });
    const [row] = await listSubscribers();
    // It is the only credential on the row; a listing has no use for it.
    assert.equal('unsubscribeToken' in row, false);
  });

  await t.test('newest first', async () => {
    await subscribe({ email: 'first@example.com' });
    await subscribe({ email: 'second@example.com' });
    const rows = await listSubscribers();
    assert.equal(rows[0].email, 'second@example.com');
  });
});
