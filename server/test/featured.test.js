import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { FeaturedTrader } from '../src/models/FeaturedTrader.js';
import {
  createFeatured,
  updateFeatured,
  deleteFeatured,
  listAllFeatured,
  mergeFeatured,
  toBoardRow,
  searchTraders,
} from '../src/services/featuredTrader.service.js';
import { getLeaderboard, invalidateLeaderboard } from '../src/services/leaderboard.service.js';

/**
 * Operator-curated leaderboard rows.
 *
 * The merge carries the risk, not the CRUD: a curated row has to compete on the
 * figure that was typed rather than be pinned, it has to REPLACE the account it
 * overrides rather than sit beside it, and it must not knock the signed-in
 * trader's own pinned row out of agreement with the board above it.
 */
test('featured traders', async (t) => {
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

  t.afterEach(async () => {
    await FeaturedTrader.deleteMany({});
    invalidateLeaderboard();
  });

  /* ------------------------------------------------------------ the row shape */

  await t.test('derives the day figure from the percentage, never a second input', () => {
    const row = toBoardRow({
      _id: 'x',
      name: 'Marcus Vale',
      portfolioValueCents: 18_425_000,
      changePct: 10,
    });

    // $184,250 is +10%, so the move is $184,250 − $167,500 = $16,750.
    assert.equal(row.dayChangeCents, 1_675_000);
    assert.equal(row.returnPct, 10);
    assert.equal(row.dayChangePct, 10);

    // Both surfaces render it through the same components as a computed row.
    assert.equal(typeof row.trades, 'number');
    assert.equal(row.username, 'Marcus Vale');
    assert.equal(row.name, 'Marcus Vale');
    assert.equal(row.avatarLetter, 'M');
    assert.equal(row.featured, true);
  });

  await t.test('a loss derives a negative move', () => {
    const row = toBoardRow({ _id: 'x', name: 'D', portfolioValueCents: 90_000, changePct: -10 });
    // $900 after −10% means $1,000 before, so the move is −$100.
    assert.equal(row.dayChangeCents, -10_000);
  });

  /* ---------------------------------------------------------------- the merge */

  await t.test('ranks on the typed figure rather than pinning to the top', () => {
    const rows = [
      { userId: 'a', username: 'a', portfolioValueCents: 500_000 },
      { userId: 'b', username: 'b', portfolioValueCents: 300_000 },
    ];
    // Deliberately SMALL. A pin would put this above a book five times its size
    // and the board would contradict its own ordering.
    const merged = mergeFeatured(rows, [
      { _id: 'f', name: 'Modest', portfolioValueCents: 400_000, changePct: 1 },
    ]);

    assert.deepEqual(
      merged.map((r) => [r.rank, r.username]),
      [
        [1, 'a'],
        [2, 'Modest'],
        [3, 'b'],
      ],
    );
  });

  await t.test('a large figure leads the board, which is the point', () => {
    const rows = [{ userId: 'a', username: 'a', portfolioValueCents: 500_000 }];
    const merged = mergeFeatured(rows, [
      { _id: 'f', name: 'Top', portfolioValueCents: 9_000_000, changePct: 42 },
    ]);

    assert.equal(merged[0].username, 'Top');
    assert.equal(merged[0].rank, 1);
  });

  await t.test('an override REPLACES the account rather than duplicating it', () => {
    const rows = [
      { userId: 'a', username: 'real_a', portfolioValueCents: 500_000 },
      { userId: 'b', username: 'real_b', portfolioValueCents: 300_000 },
    ];
    const merged = mergeFeatured(rows, [
      { _id: 'f', userId: 'a', name: 'Curated A', portfolioValueCents: 900_000, changePct: 5 },
    ]);

    assert.equal(merged.length, 2, 'the overridden account must not appear twice');
    assert.equal(merged.some((r) => r.username === 'real_a'), false);
    assert.deepEqual(
      merged.map((r) => r.username),
      ['Curated A', 'real_b'],
    );
  });

  await t.test('ties share a rank and the next value skips, matching $rank', () => {
    const rows = [
      { userId: 'a', username: 'a', portfolioValueCents: 500_000 },
      { userId: 'b', username: 'b', portfolioValueCents: 100_000 },
    ];
    const merged = mergeFeatured(rows, [
      { _id: 'f', name: 'Tied', portfolioValueCents: 500_000, changePct: 0 },
    ]);

    assert.deepEqual(
      merged.map((r) => r.rank),
      [1, 1, 3],
    );
  });

  await t.test('does not mutate the memoised board it was handed', () => {
    const rows = [{ userId: 'a', username: 'a', portfolioValueCents: 100_000 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    mergeFeatured(rows, [{ _id: 'f', name: 'F', portfolioValueCents: 900_000, changePct: 1 }]);
    assert.deepEqual(rows, snapshot);
  });

  await t.test('no featured rows leaves the board byte-identical', () => {
    const rows = [{ userId: 'a', username: 'a', portfolioValueCents: 100_000, rank: 1 }];
    assert.equal(mergeFeatured(rows, []), rows);
  });

  /* ------------------------------------------------------ against a real board */

  await t.test('a curated row leads the live leaderboard and shifts every rank', async () => {
    const before = await getLeaderboard({ period: 'monthly', limit: 5, userId: jd._id });
    const topBefore = before.top[0].portfolioValueCents;

    await createFeatured(
      {
        name: 'Marcus Vale',
        portfolioValueCents: topBefore + 1_000_000,
        changePct: 24.5,
        trades: 312,
        bestSymbol: 'NVDA',
        bestReturnPct: 61.2,
        active: true,
      },
      admin._id,
    );

    const after = await getLeaderboard({ period: 'monthly', limit: 5, userId: jd._id });

    assert.equal(after.top[0].name, 'Marcus Vale');
    assert.equal(after.top[0].rank, 1);
    assert.equal(after.top[0].featured, true);
    assert.equal(after.top[0].best.symbol, 'NVDA');
    // Everyone real moved down exactly one place.
    assert.equal(after.top[1].name, before.top[0].name);
    assert.equal(after.you.rank, before.you.rank + 1);
    assert.equal(after.totalTraders, before.totalTraders + 1);
  });

  await t.test('an inactive row is not on the board at all', async () => {
    const before = await getLeaderboard({ period: 'monthly', limit: 3 });
    await createFeatured(
      { name: 'Staged', portfolioValueCents: 99_000_000, changePct: 5, active: false },
      admin._id,
    );
    const after = await getLeaderboard({ period: 'monthly', limit: 3 });

    assert.equal(after.top[0].name, before.top[0].name);
    assert.equal(after.totalTraders, before.totalTraders);
  });

  await t.test('an admin edit shows without waiting out the 60s memo', async () => {
    const doc = await createFeatured(
      { name: 'First', portfolioValueCents: 99_000_000, changePct: 1 },
      admin._id,
    );
    assert.equal((await getLeaderboard({ period: 'monthly', limit: 1 })).top[0].name, 'First');

    // No invalidateLeaderboard() call in between — curated rows are read per
    // request precisely so an edit is not up to a minute behind.
    await updateFeatured(doc._id, { name: 'Renamed' }, admin._id);
    assert.equal((await getLeaderboard({ period: 'monthly', limit: 1 })).top[0].name, 'Renamed');
  });

  await t.test('overriding a real trader removes their own pinned row', async () => {
    await createFeatured(
      { name: 'JD Featured', userId: String(jd._id), portfolioValueCents: 99_000_000, changePct: 9 },
      admin._id,
    );

    const board = await getLeaderboard({ period: 'monthly', limit: 5, userId: jd._id });
    assert.equal(board.top[0].name, 'JD Featured');
    // Their real row is gone, so pinning it underneath would show them twice.
    assert.equal(board.you, null);
  });

  /* ------------------------------------------------------------------ the CRUD */

  await t.test('one account cannot be featured twice', async () => {
    await createFeatured(
      { name: 'A', userId: String(jd._id), portfolioValueCents: 1_000, changePct: 0 },
      admin._id,
    );
    await assert.rejects(
      () =>
        createFeatured(
          { name: 'B', userId: String(jd._id), portfolioValueCents: 2_000, changePct: 0 },
          admin._id,
        ),
      /already featured/i,
    );
  });

  await t.test('two standalone rows may share nothing and both stand', async () => {
    await createFeatured({ name: 'One', portfolioValueCents: 1_000, changePct: 0 }, admin._id);
    await createFeatured({ name: 'Two', portfolioValueCents: 2_000, changePct: 0 }, admin._id);
    assert.equal((await listAllFeatured()).length, 2);
  });

  await t.test('refuses a link to an account that does not exist', async () => {
    await assert.rejects(
      () =>
        createFeatured(
          { name: 'Ghost', userId: '0'.repeat(24), portfolioValueCents: 1_000, changePct: 0 },
          admin._id,
        ),
      /does not exist/i,
    );
  });

  await t.test('delete removes it from the board', async () => {
    const doc = await createFeatured(
      { name: 'Temporary', portfolioValueCents: 99_000_000, changePct: 1 },
      admin._id,
    );
    assert.equal((await getLeaderboard({ period: 'monthly', limit: 1 })).top[0].name, 'Temporary');

    await deleteFeatured(doc._id);
    assert.notEqual((await getLeaderboard({ period: 'monthly', limit: 1 })).top[0].name, 'Temporary');
    await assert.rejects(() => deleteFeatured(doc._id), /not found/i);
  });

  await t.test('the account picker escapes its input', async () => {
    // A bare `(` reaches `new RegExp` and is a 500 unless escaped.
    assert.deepEqual(await searchTraders('jd_trader('), []);
    const hits = await searchTraders('jd_');
    assert.equal(hits.some((h) => h.username === 'jd_trader'), true);
  });

  await t.test('no money moves', async () => {
    const before = await User.findById(jd._id).lean();
    await createFeatured(
      { name: 'Rich', userId: String(jd._id), portfolioValueCents: 99_000_000, changePct: 500 },
      admin._id,
    );
    const after = await User.findById(jd._id).lean();

    assert.equal(after.cashBalanceCents, before.cashBalanceCents);
    assert.equal(after.tradeCount, before.tradeCount);
  });

  await t.test('every persisted value is an integer number of cents', async () => {
    await createFeatured({ name: 'Rounded', portfolioValueCents: 12_345, changePct: 3 }, admin._id);
    for (const row of await listAllFeatured()) {
      assert.equal(Number.isInteger(row.portfolioValueCents), true, row.name);
      assert.equal(Number.isInteger(row.trades), true, row.name);
    }
  });
});
