import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import {
  listUsers,
  userCounts,
  setUserStatus,
  listPositionsFor,
} from '../src/services/adminUser.service.js';
import {
  upsertOverrideForUser,
  removeOverrideForUser,
} from '../src/services/featuredTrader.service.js';
import { getLeaderboard, invalidateLeaderboard } from '../src/services/leaderboard.service.js';
import { FeaturedTrader } from '../src/models/FeaturedTrader.js';

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

  // Captured BEFORE anything in this suite moves, so the "moves no money" case
  // below compares against a real opening figure rather than one derived at
  // check time — the tautology the reconciliation tests already had once.
  const jdCashBefore = jd.cashBalanceCents;
  const jdTradesBefore = jd.tradeCount;

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

  /**
   * Editing a trader's board figures.
   *
   * The write is a curated row, never the account — so the cases that matter
   * are that the board moves, the account does not, and that the two figures
   * stay independently readable so an edit can be undone.
   */
  await t.test('editing a trader', async (t2) => {
    const row = async () => (await listUsers({ q: 'jd_trader' })).items[0];

    await t2.test('the listing carries the real computed figures', async () => {
      const r = await row();
      assert.equal(r.override, null, 'starts un-edited');
      assert.ok(r.computed, 'jd_trader is ranked');
      assert.ok(Number.isInteger(r.computed.portfolioValueCents));
      assert.ok(r.computed.rank >= 1);
    });

    await t2.test('an override replaces the computed row on the board', async () => {
      await upsertOverrideForUser(jd._id, { portfolioValueCents: 99_000_000, changePct: 42 }, admin._id);
      invalidateLeaderboard();

      const board = await getLeaderboard({ period: 'alltime', limit: 200 });
      const mine = board.top.filter((b) => String(b.userId) === String(jd._id));

      // Exactly one. A curated row sitting BESIDE the computed one would put a
      // single account on the board twice at two different values, which is the
      // one outcome that reads as a bug rather than as curation.
      assert.equal(mine.length, 0, 'the computed row is gone');
      const curated = board.top.find((b) => b.featured && b.portfolioValueCents === 99_000_000);
      assert.ok(curated, 'the curated row is on the board');
      assert.equal(curated.rank, 1, 'a large enough figure ranks first');
      assert.equal(curated.username, jd.displayName || jd.username, 'named from the account');
    });

    await t2.test('the typed figure ranks, it is not pinned', async () => {
      // The same trader with a tiny figure must fall down the table. A pin would
      // put $10 above $58,000 and the board would contradict its own ordering.
      await upsertOverrideForUser(jd._id, { portfolioValueCents: 1_000, changePct: -5 }, admin._id);
      invalidateLeaderboard();

      const board = await getLeaderboard({ period: 'alltime', limit: 300 });
      const curated = board.top.find((b) => b.featured && b.portfolioValueCents === 1_000);
      assert.ok(curated, 'still on the board');
      assert.ok(curated.rank > 1, `a small figure does not lead (rank ${curated.rank})`);
    });

    await t2.test('it moves no money and leaves the real figures readable', async () => {
      const user = await User.findById(jd._id).lean();
      assert.equal(user.cashBalanceCents, jdCashBefore);
      assert.equal(user.tradeCount, jdTradesBefore);

      // The listing must still expose reality alongside the override, or a
      // second edit would compound on the first and the original value would be
      // unrecoverable.
      const r = await row();
      assert.equal(r.override.portfolioValueCents, 1_000);
      assert.notEqual(r.computed.portfolioValueCents, 1_000);
    });

    await t2.test('upserting twice edits rather than colliding', async () => {
      // Addressed by the ACCOUNT, so a second save is an edit — not the
      // `ALREADY_FEATURED` a create-then-create would raise.
      await upsertOverrideForUser(jd._id, { portfolioValueCents: 5_000, changePct: 1 }, admin._id);
      const all = await FeaturedTrader.find({ userId: jd._id }).lean();
      assert.equal(all.length, 1, 'one curated row per account');
      assert.equal(all[0].portfolioValueCents, 5_000);
    });

    /**
     * The Best-position picker's options.
     *
     * This shipped broken for ten minutes because `getPortfolio` returns its
     * position array under `holdings` while its local variable is called
     * `positions` — destructuring the wrong name yields `undefined`, not an
     * error, so the endpoint 500'd and the dropdown silently showed "None".
     */
    await t2.test('the position picker lists what the trader actually holds', async () => {
      const items = await listPositionsFor(jd._id);
      assert.ok(Array.isArray(items), 'an array, not undefined');
      assert.ok(items.length > 0, 'jd_trader holds positions');

      for (const p of items) {
        assert.ok(p.symbol, 'every option has a symbol to select');
        assert.equal(typeof p.returnPct, 'number');
      }

      // The picker must offer the SAME best position the board reports, or
      // selecting the trader's actual best would be impossible from the list.
      const r = await row();
      if (r.computed?.best?.symbol) {
        assert.ok(
          items.some((p) => p.symbol === r.computed.best.symbol),
          `the board's best (${r.computed.best.symbol}) is on the list`,
        );
      }
    });

    await t2.test('positions for an unknown account are a 404', async () => {
      await assert.rejects(
        () => listPositionsFor(new mongoose.Types.ObjectId()),
        (err) => /** @type {any} */ (err).code === 'USER_NOT_FOUND',
      );
    });

    await t2.test('an override on a non-existent account is refused', async () => {
      // A row keyed on a stale id silently does nothing: it appears, and so
      // does the user it was meant to replace.
      await assert.rejects(
        () => upsertOverrideForUser(new mongoose.Types.ObjectId(), { portfolioValueCents: 1, changePct: 0 }, admin._id),
        /NO_SUCH_USER|does not exist/i,
      );
    });

    await t2.test('removing restores the computed row, and replays cleanly', async () => {
      assert.deepEqual(await removeOverrideForUser(jd._id), { removed: true });
      // Not an error the second time: the caller wanted "show real figures",
      // and that is satisfied either way.
      assert.deepEqual(await removeOverrideForUser(jd._id), { removed: false });

      invalidateLeaderboard();
      const board = await getLeaderboard({ period: 'alltime', limit: 300 });
      assert.ok(
        board.top.some((b) => String(b.userId) === String(jd._id) && !b.featured),
        'the real row is back',
      );
    });
  });
});
