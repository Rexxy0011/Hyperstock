import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { ContactMessage } from '../src/models/ContactMessage.js';
import { User } from '../src/models/User.js';
import {
  submitMessage,
  listMessages,
  messageCounts,
  setHandled,
} from '../src/services/contact.service.js';

/**
 * The contact form's endpoint and its admin queue.
 *
 * The interesting cases here are not "does it store a string". They are the
 * three ways this specific feature goes wrong: an enquiry silently discarded as
 * a duplicate, the public endpoint answering differently for an address it
 * recognises, and two operators clearing the same message.
 */
test('contact messages', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite writes and drops collections and is not connected to an ephemeral database',
  );

  await ContactMessage.deleteMany({});
  await User.deleteMany({ email: 'known@hyperstocks.app' });

  const VALID = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 0100',
    topic: 'funding',
    message: 'My deposit has been under review for two days. Can you check it?',
  };

  await t.test('stores a message and returns its id', async () => {
    const result = await submitMessage(VALID);
    assert.equal(result.ok, true);
    assert.match(result.id, /^[a-f0-9]{24}$/);

    const doc = await ContactMessage.findById(result.id).lean();
    assert.equal(doc.name, 'Ada Lovelace');
    assert.equal(doc.topic, 'funding');
    // Nobody has dealt with it yet, and that is the state the queue filters on.
    assert.equal(doc.handledAt, null);
  });

  await t.test('normalises the address the way the subscriber list does', async () => {
    const { id } = await submitMessage({ ...VALID, email: '  ADA@Example.COM  ' });
    const doc = await ContactMessage.findById(id).lean();
    // Otherwise the same person writing twice is visibly two people in the
    // queue, and the `registered` join below misses them.
    assert.equal(doc.email, 'ada@example.com');
  });

  /**
   * THE ONE THAT WOULD LOSE AN ENQUIRY. `Subscriber` is unique on email because
   * a membership submitted twice is one membership. A message is an EVENT, so
   * the same rule applied here would silently discard a follow-up — which is
   * the exact failure the whole collection exists to prevent.
   */
  await t.test('a second message from the same address is a second message', async () => {
    const before = await ContactMessage.countDocuments({ email: 'ada@example.com' });
    const result = await submitMessage({ ...VALID, message: 'Following up on the above.' });
    assert.equal(result.ok, true);
    assert.equal(await ContactMessage.countDocuments({ email: 'ada@example.com' }), before + 1);
  });

  await t.test('refuses an address that is not one', async () => {
    for (const email of ['', 'ada', 'ada@', '@example.com', 'ada example.com']) {
      const result = await submitMessage({ ...VALID, email });
      assert.equal(result.ok, false, `accepted ${JSON.stringify(email)}`);
      assert.equal(result.code, 'BAD_EMAIL');
    }
  });

  await t.test('refuses a message too short to be one, and a missing name', async () => {
    // A single character satisfies `required` and is not a message.
    assert.equal((await submitMessage({ ...VALID, message: 'hi' })).code, 'MESSAGE_TOO_SHORT');
    assert.equal((await submitMessage({ ...VALID, message: '   ' })).code, 'MESSAGE_TOO_SHORT');
    assert.equal((await submitMessage({ ...VALID, name: '   ' })).code, 'NAME_REQUIRED');
  });

  /**
   * The public endpoint must not become an enumeration oracle — the same
   * property `subscribe()` is careful to have. Whether the address holds an
   * account is computed for the ADMIN listing and must not vary the answer
   * given to an anonymous caller.
   */
  await t.test('answers identically for a known and an unknown address', async () => {
    await User.create({
      username: 'known_trader',
      email: 'known@hyperstocks.app',
      name: 'known_trader',
      emailVerified: true,
      cashBalanceCents: 1_000_000,
    });

    const known = await submitMessage({ ...VALID, email: 'known@hyperstocks.app' });
    const unknown = await submitMessage({ ...VALID, email: 'stranger@example.com' });

    assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
    assert.equal(known.ok, unknown.ok);
    // `registered` is an admin-listing concern. If it ever appears here, the
    // endpoint has started answering "is this address on your platform".
    assert.equal('registered' in known, false);
  });

  await t.test('the listing joins accounts without storing a flag', async () => {
    const rows = await listMessages();
    const known = rows.find((r) => r.email === 'known@hyperstocks.app');
    const stranger = rows.find((r) => r.email === 'stranger@example.com');

    assert.equal(known.registered, true);
    assert.equal(stranger.registered, false);
    // Computed per read, exactly like `converted` on the subscriber listing —
    // a stored flag needs a writer on the signup path that nobody adds.
    assert.equal(await ContactMessage.findOne({ email: 'known@hyperstocks.app' }).then(
      (d) => d.get('registered'),
    ), undefined);
  });

  await t.test('outstanding messages sort above handled ones', async () => {
    const rows = await listMessages();
    const firstHandled = rows.findIndex((r) => r.handled);
    if (firstHandled !== -1) {
      assert.ok(
        rows.slice(firstHandled).every((r) => r.handled),
        'a new message sorted below a handled one',
      );
    }
  });

  /**
   * The compare-and-set. Milder in consequence than a withdrawal's, but the
   * same shape and for the same reason: without the expected state in the
   * filter, `handledBy` records whoever pressed the button last rather than
   * whoever did the work.
   */
  await t.test('clearing a message twice succeeds once', async () => {
    const target = await ContactMessage.findOne({ handledAt: null }).lean();
    const admin = await User.findOne({ email: 'known@hyperstocks.app' }).lean();

    const first = await setHandled(target._id, true, admin._id);
    const replay = await setHandled(target._id, true, admin._id);

    assert.equal(first.changed, true);
    assert.equal(replay.changed, false, 'a replayed clear matched a document');

    const doc = await ContactMessage.findById(target._id).lean();
    assert.notEqual(doc.handledAt, null);
    assert.equal(String(doc.handledBy), String(admin._id));
  });

  await t.test('reopening clears the handler as well as the date', async () => {
    const handled = await ContactMessage.findOne({ handledAt: { $ne: null } }).lean();
    assert.equal((await setHandled(handled._id, false, null)).changed, true);

    const doc = await ContactMessage.findById(handled._id).lean();
    assert.equal(doc.handledAt, null);
    // Leaving `handledBy` behind would credit somebody with clearing a message
    // that is once again outstanding.
    assert.equal(doc.handledBy, null);
  });

  await t.test('the counts agree with the collection', async () => {
    const counts = await messageCounts();
    assert.equal(counts.total, await ContactMessage.countDocuments());
    assert.equal(counts.outstanding, await ContactMessage.countDocuments({ handledAt: null }));
    assert.ok(counts.outstanding <= counts.total);
  });

  /**
   * The listing reaches an admin screen, not a third party — but it is still
   * worth pinning what a message row does NOT carry, because the sender's
   * account is one join away and the temptation to widen this is real.
   */
  await t.test('carries no account state for the sender', async () => {
    const rows = await listMessages();
    const serialised = JSON.stringify(rows);

    for (const field of ['cashBalanceCents', 'passwordHash', 'role', 'unsubscribeToken']) {
      assert.ok(!serialised.includes(field), `${field} reached the message listing`);
    }
  });

  /* NO TRAILING CLEANUP HOOK. `t.after` hooks run in REGISTRATION order, and
     `disconnectDb` is registered at the top of this suite — so a tidy-up
     registered down here runs against a closed client and fails the whole file
     with `MongoNotConnectedError` while every case above it passed. Measured
     exactly that. The `deleteMany` at the start is the version that matters
     anyway: it makes this run reproducible whatever a previous one left
     behind, which a cleanup at the end cannot promise if the process dies. */
});
