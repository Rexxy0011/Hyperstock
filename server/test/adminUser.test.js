import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { listUsers, userCounts, setUserStatus } from '../src/services/adminUser.service.js';

/**
 * The user admin.
 *
 * The screen exists because Better Auth moved credentials into `accounts`, so
 * "can this row sign in" stopped being visible anywhere. These cases pin that
 * distinction, and the two ways the one write on the screen can go wrong.
 */
test('admin users', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });

  const admin = await User.findOne({ role: 'admin' }).lean();
  const jd = await User.findOne({ username: 'jd_trader' }).lean();
  const fixture = await User.findOne({ username: 'denise_coates' }).lean();

  await t.test('counts separate real accounts from leaderboard fixtures', async () => {
    const counts = await userCounts();
    assert.equal(counts.total, await User.countDocuments());
    assert.equal(counts.withCredentials, 2, 'only jd_trader and admin hold a credential');
    assert.equal(counts.fixtures, counts.total - 2);
    assert.equal(counts.admins, 1);
    assert.equal(counts.suspended, 0);
  });

  /** The column the screen exists for. */
  await t.test('canSignIn reflects the accounts collection, not the user row', async () => {
    const { items } = await listUsers({ q: 'jd_trader' });
    assert.equal(items.length, 1);
    assert.equal(items[0].canSignIn, true);

    const fixtures = await listUsers({ q: 'denise_coates' });
    assert.equal(fixtures.items[0].canSignIn, false);
  });

  await t.test('the listing never carries credential material', async () => {
    const { items } = await listUsers({ limit: 5 });
    for (const row of items) {
      assert.equal('passwordHash' in row, false, 'no password hash on the wire');
      assert.equal('password' in row, false);
      assert.equal('token' in row, false);
      assert.equal('unsubscribeToken' in row, false);
    }
  });

  await t.test('paging covers every account exactly once', async () => {
    const total = await User.countDocuments();
    const seen = new Set();
    const first = await listUsers({ page: 1, limit: 25 });

    for (let page = 1; page <= first.pages; page += 1) {
      const { items } = await listUsers({ page, limit: 25 });
      for (const row of items) seen.add(row.id);
    }
    assert.equal(seen.size, total, 'every account appears, and none twice');
  });

  /**
   * A SEARCH TERM MUST NOT ACT AS A REGEX. `.*` matches every username if the
   * term is interpolated raw, which turns a search box into a way to dump the
   * table — and `(a+)+$` is a way to hang the process.
   */
  await t.test('the search term is escaped, not interpreted', async () => {
    const wildcard = await listUsers({ q: '.*' });
    assert.equal(wildcard.total, 0, 'a regex wildcard matches nothing');

    const anchored = await listUsers({ q: '^jd' });
    assert.equal(anchored.total, 0, 'an anchor matches nothing');

    const real = await listUsers({ q: 'jd_' });
    assert.equal(real.total, 1, 'an ordinary substring still matches');
  });

  await t.test('search matches email as well as username', async () => {
    const byEmail = await listUsers({ q: 'jd@hyperstocks.app' });
    assert.equal(byEmail.total, 1);
    assert.equal(byEmail.items[0].username, 'jd_trader');
  });

  await t.test('suspending revokes the account and its sessions', async () => {
    // Give the fixture a session so there is something to revoke.
    await mongoose.connection.collection('sessions').insertOne({
      userId: fixture._id,
      token: 'test-session-token',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await setUserStatus(fixture._id, 'Suspended', admin._id);
    assert.equal(result.user.status, 'Suspended');
    assert.equal(result.sessionsRevoked, 1, 'the live session was deleted');

    const after = await User.findById(fixture._id).lean();
    assert.equal(after.status, 'Suspended');
    assert.equal(
      await mongoose.connection.collection('sessions').countDocuments({ userId: fixture._id }),
      0,
    );
  });

  await t.test('reactivating restores the account and revokes nothing', async () => {
    const result = await setUserStatus(fixture._id, 'Active', admin._id);
    assert.equal(result.user.status, 'Active');
    assert.equal(result.sessionsRevoked, 0);
  });

  /**
   * THE LOCKOUT GUARD. With one administrator — which is what this database has
   * — suspending yourself removes the only account that could undo it, and the
   * recovery is a database edit.
   */
  await t.test('an admin cannot change their own status', async () => {
    await assert.rejects(
      () => setUserStatus(admin._id, 'Suspended', admin._id),
      (err) => /** @type {any} */ (err).code === 'SELF_STATUS_CHANGE',
    );
    const unchanged = await User.findById(admin._id).lean();
    assert.equal(unchanged.status, 'Active', 'the admin is still active');
  });

  await t.test('an unknown status is refused', async () => {
    await assert.rejects(
      () => setUserStatus(jd._id, 'Deleted', admin._id),
      (err) => /** @type {any} */ (err).code === 'BAD_STATUS',
    );
  });

  await t.test('an unknown user is a 404', async () => {
    await assert.rejects(
      () => setUserStatus(new mongoose.Types.ObjectId(), 'Suspended', admin._id),
      (err) => /** @type {any} */ (err).code === 'USER_NOT_FOUND',
    );
  });

  /**
   * A status change is not a money movement, and nothing on this screen should
   * ever make it one.
   */
  await t.test('changing status moves no money', async () => {
    const before = await User.findById(jd._id).lean();
    await setUserStatus(jd._id, 'Flagged', admin._id);
    const after = await User.findById(jd._id).lean();

    assert.equal(after.cashBalanceCents, before.cashBalanceCents);
    assert.equal(after.tradeCount, before.tradeCount);
    await setUserStatus(jd._id, 'Active', admin._id);
  });
});
