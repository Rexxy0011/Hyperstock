import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { SEED_CASH_CENTS } from '../src/config/env.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { Transaction } from '../src/models/Transaction.js';
import { createAuth } from '../src/auth/betterAuth.js';

/**
 * The auth suite that did not exist.
 *
 * Before the Better Auth migration this project had 183 tests and NONE of them
 * touched authentication — the one subsystem where a silent regression hands
 * somebody another account. Every case here is either a guarantee the old
 * hand-rolled auth made and this has to keep, or a way the new arrangement can
 * fail that the old one could not.
 *
 * These call `auth.api.*` directly rather than going over HTTP. The Express
 * mount is one line (`app.all('/api/auth/*', toNodeHandler(auth))`) and its
 * ordering trap is documented where it lives; what is worth pinning is the
 * behaviour underneath, which is where the money-shaped fields are.
 */
test('auth', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });
  const auth = createAuth();

  const accounts = () => mongoose.connection.collection('accounts');

  /**
   * BETTER AUTH SIGNALS A REJECTION TWO DIFFERENT WAYS, and a test that only
   * handles one of them reports a pass it did not earn. `asResponse: true`
   * returns a `Response` for most failures — a wrong password comes back as a
   * 401 — but validation inside a plugin THROWS an `APIError` before any
   * response is built, which is how the username rule arrives.
   *
   * Both are normalised to `{ status }` here so each case can assert on the
   * outcome rather than on which mechanism produced it.
   */
  const call = async (fn, body) => {
    try {
      return await fn({ body, asResponse: true });
    } catch (err) {
      return { status: err?.statusCode ?? err?.status ?? 400, thrown: err };
    }
  };
  const signUp = (body) => call(auth.api.signUpEmail, body);
  const signIn = (body) => call(auth.api.signInEmail, body);

  await t.test('sign-up creates the user, the credential and the opening ledger row', async () => {
    const res = await signUp({
      email: 'newtrader@hyperstocks.app',
      password: 'password123',
      username: 'new_trader',
      name: 'New Trader',
    });
    assert.equal(res.status, 200);

    const user = await User.findOne({ email: 'newtrader@hyperstocks.app' }).lean();
    assert.ok(user, 'user was written');

    // The whole migration rests on this: a string id would have orphaned every
    // one of the eleven models holding an ObjectId ref to User.
    assert.ok(user._id instanceof mongoose.Types.ObjectId, '_id is a real ObjectId');
    assert.equal(user.username, 'new_trader');
    assert.equal(user.cashBalanceCents, SEED_CASH_CENTS);
    assert.equal(Number.isInteger(user.cashBalanceCents), true, 'cash is integer cents');

    // Credentials live in `accounts`, never on the user document.
    assert.equal(user.passwordHash, undefined, 'no credential on the user doc');
    const credential = await accounts().findOne({ userId: user._id, providerId: 'credential' });
    assert.ok(credential, 'credential row exists');
    assert.ok(credential.userId instanceof mongoose.Types.ObjectId, 'accounts.userId is an ObjectId');
    assert.ok(credential.password.startsWith('$2'), 'hashed with bcrypt, not scrypt');

    // The databaseHooks.user.create.after hook — without it a new account has
    // cash and no Transaction explaining where it came from.
    const opening = await Transaction.findOne({ userId: user._id }).lean();
    assert.ok(opening, 'opening ledger row written');
    assert.equal(opening.detail, 'Initial virtual capital');
    assert.equal(opening.amountCents, SEED_CASH_CENTS);
  });

  /**
   * THE PRIVILEGE-ESCALATION GUARD, and the reason every additional field is
   * declared `input: false`. Without it, sign-up is a public endpoint that
   * accepts arbitrary user columns — `role: 'admin'` makes an administrator and
   * `cashBalanceCents` mints money, both from an unauthenticated request.
   */
  await t.test('sign-up cannot set role, status or cash from the request body', async () => {
    const res = await signUp({
      email: 'sneaky@hyperstocks.app',
      password: 'password123',
      username: 'sneaky',
      name: 'Sneaky',
      role: 'admin',
      status: 'Active',
      cashBalanceCents: 999_999_999,
      tradeCount: 5000,
    });
    assert.equal(res.status, 200);

    const user = await User.findOne({ email: 'sneaky@hyperstocks.app' }).lean();
    assert.equal(user.role, 'user', 'role was NOT taken from the body');
    assert.equal(user.cashBalanceCents, SEED_CASH_CENTS, 'cash was NOT taken from the body');
    assert.equal(user.tradeCount, 0, 'tradeCount was NOT taken from the body');
  });

  await t.test('a duplicate email is refused', async () => {
    const res = await signUp({
      email: 'newtrader@hyperstocks.app',
      password: 'password123',
      username: 'another_handle',
      name: 'Another',
    });
    assert.notEqual(res.status, 200);
    assert.equal(await User.countDocuments({ email: 'newtrader@hyperstocks.app' }), 1);
  });

  await t.test('a duplicate username is refused', async () => {
    const res = await signUp({
      email: 'different@hyperstocks.app',
      password: 'password123',
      username: 'new_trader',
      name: 'Different',
    });
    assert.notEqual(res.status, 200);
    assert.equal(await User.countDocuments({ email: 'different@hyperstocks.app' }), 0);
  });

  await t.test('sign-in succeeds and issues a session', async () => {
    const res = await signIn({ email: 'newtrader@hyperstocks.app', password: 'password123' });
    assert.equal(res.status, 200);

    const user = await User.findOne({ email: 'newtrader@hyperstocks.app' }).lean();
    const session = await mongoose.connection.collection('sessions').findOne({ userId: user._id });
    assert.ok(session, 'a session row was written');
    assert.ok(session.userId instanceof mongoose.Types.ObjectId, 'sessions.userId is an ObjectId');
    assert.ok(session.expiresAt > new Date(), 'session has a future expiry');
  });

  await t.test('a wrong password is refused', async () => {
    const res = await signIn({ email: 'newtrader@hyperstocks.app', password: 'not-the-password' });
    assert.equal(res.status, 401);
  });

  await t.test('an unknown address is refused', async () => {
    const res = await signIn({ email: 'nobody@hyperstocks.app', password: 'password123' });
    assert.equal(res.status, 401);
  });

  /**
   * THE ONE THAT DEFINES THE WHOLE SEED ARRANGEMENT. The leaderboard fixtures
   * are user rows with no `accounts` row, so they rank and hold positions and
   * can never authenticate. If this ever passes, 207 accounts sharing one demo
   * password just became reachable.
   */
  await t.test('a seeded leaderboard trader has no credential and cannot sign in', async () => {
    const trader = await User.findOne({ username: 'denise_coates' }).lean();
    assert.ok(trader, 'the fixture trader exists as a user');
    assert.ok(await Transaction.countDocuments({ userId: trader._id }) >= 0);

    assert.equal(
      await accounts().countDocuments({ userId: trader._id }),
      0,
      'fixture traders carry no credential',
    );

    const res = await signIn({ email: trader.email, password: 'password123' });
    assert.equal(res.status, 401, 'a fixture trader cannot sign in');
  });

  await t.test('only the two demo accounts carry credentials', async () => {
    const withCredentials = await accounts()
      .find({ providerId: 'credential' })
      .project({ userId: 1 })
      .toArray();
    const usernames = (
      await User.find({ _id: { $in: withCredentials.map((a) => a.userId) } })
        .select('username')
        .lean()
    )
      .map((u) => u.username)
      .sort();

    // The two seeded ones, plus whatever this suite registered above.
    assert.ok(usernames.includes('jd_trader'), 'jd_trader can sign in');
    assert.ok(usernames.includes('admin'), 'admin can sign in');
    assert.equal(
      usernames.filter((u) => !['jd_trader', 'admin', 'new_trader', 'sneaky'].includes(u)).length,
      0,
      'no fixture trader gained a credential',
    );
  });

  await t.test('jd_trader signs in with the credential the seed wrote', async () => {
    const res = await signIn({ email: 'jd@hyperstocks.app', password: 'password123' });
    assert.equal(res.status, 200);
  });

  await t.test('a password under the minimum is refused', async () => {
    const res = await signUp({
      email: 'shortpw@hyperstocks.app',
      password: 'short',
      username: 'shortpw',
      name: 'Short',
    });
    assert.notEqual(res.status, 200);
    assert.equal(await User.countDocuments({ email: 'shortpw@hyperstocks.app' }), 0);
  });

  await t.test('a username breaking the character rule is refused', async () => {
    const res = await signUp({
      email: 'badhandle@hyperstocks.app',
      password: 'password123',
      username: 'not a handle!',
      name: 'Bad Handle',
    });
    assert.notEqual(res.status, 200);
    assert.equal(await User.countDocuments({ email: 'badhandle@hyperstocks.app' }), 0);
  });

  await t.test('every persisted cash balance is still an integer', async () => {
    const users = await User.find({}).select('cashBalanceCents').lean();
    const bad = users.filter((u) => !Number.isInteger(u.cashBalanceCents));
    assert.deepEqual(bad, [], 'no non-integer cash balance anywhere');
  });
});
