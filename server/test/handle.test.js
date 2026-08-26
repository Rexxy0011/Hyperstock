import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { baseHandle, uniqueHandle } from '../src/auth/handle.js';

/**
 * Username generation for social signups.
 *
 * Google returns a name, an email and a picture and never a handle, while this
 * product requires a unique one matching `^[a-z0-9_]+$` on every user. So every
 * OAuth account gets an invented handle, and these are the ways inventing one
 * goes wrong.
 */
test('social signup handles', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });

  const RULE = /^[a-z0-9_]+$/;

  await t.test('a handle always satisfies the rule the model enforces', async () => {
    for (const seed of [
      'ada.lovelace',
      'Ada Lovelace',
      'José García',
      'ADA!!!',
      'a.b',
      '____',
      '你好世界',
      'ada+tag',
      '  spaced  out  ',
    ]) {
      const handle = await uniqueHandle({ email: `${seed}@example.com`, name: seed });
      assert.match(handle, RULE, `"${seed}" produced "${handle}"`);
      assert.ok(handle.length >= 3, `"${handle}" is at least 3 chars`);
      assert.ok(handle.length <= 24, `"${handle}" is at most 24 chars`);
    }
  });

  await t.test('runs of illegal characters collapse to one underscore', () => {
    assert.equal(baseHandle('Ada  Lovelace-King'), 'ada_lovelace_king');
    assert.equal(baseHandle('ada...lovelace'), 'ada_lovelace');
  });

  await t.test('accents are folded rather than replaced', () => {
    // "jose", not "jos_" — a combining mark is not an illegal character, it is
    // a decoration on a legal one.
    assert.equal(baseHandle('José'), 'jose');
  });

  await t.test('leading and trailing underscores are trimmed', () => {
    assert.equal(baseHandle('.ada.'), 'ada');
    assert.equal(baseHandle('!!!ada!!!'), 'ada');
  });

  await t.test('an unusable seed yields an empty base, not a bad handle', () => {
    assert.equal(baseHandle('你好世界'), '');
    assert.equal(baseHandle('!!'), '');
    assert.equal(baseHandle(''), '');
    assert.equal(baseHandle(null), '');
  });

  await t.test('the email local part is preferred over the display name', async () => {
    const handle = await uniqueHandle({ email: 'ada.lovelace@example.com', name: 'Grace Hopper' });
    assert.equal(handle, 'ada_lovelace');
  });

  await t.test('the display name is used when the email cannot supply one', async () => {
    const handle = await uniqueHandle({ email: '!!@example.com', name: 'Grace Hopper' });
    assert.equal(handle, 'grace_hopper');
  });

  await t.test('a totally unusable profile still yields a valid handle', async () => {
    const handle = await uniqueHandle({ email: '!!@example.com', name: '你好' });
    assert.match(handle, RULE);
    assert.ok(handle.startsWith('user'), `expected the user_ fallback, got "${handle}"`);
  });

  /**
   * THE FALLBACK MUST NOT BE `trader_`. That namespace belongs to the seed's
   * synthetic fixtures and is what /admin/users uses to tell a real account
   * from a leaderboard row.
   */
  await t.test('the fallback never lands in the fixture namespace', async () => {
    for (let i = 0; i < 5; i += 1) {
      const handle = await uniqueHandle({ email: '@example.com', name: '' });
      assert.equal(/^trader_\d+$/.test(handle), false, `"${handle}" collides with the fixtures`);
    }
  });

  await t.test('a taken handle gets a readable numeric suffix', async () => {
    // jd_trader is seeded, so the base is occupied.
    const handle = await uniqueHandle({ email: 'jd_trader@example.com', name: 'JD' });
    assert.notEqual(handle, 'jd_trader');
    assert.equal(handle, 'jd_trader_2', 'the first collision is readable, not random');
    assert.match(handle, RULE);
  });

  await t.test('successive collisions keep counting', async () => {
    await User.create({
      username: 'jd_trader_2',
      email: 'collide2@example.com',
      cashBalanceCents: 1_000_000,
    });
    const handle = await uniqueHandle({ email: 'jd_trader@example.com', name: 'JD' });
    assert.equal(handle, 'jd_trader_3');
  });

  await t.test('a generated handle is genuinely free', async () => {
    const handle = await uniqueHandle({ email: 'brand.new.person@example.com', name: 'New' });
    assert.equal(await User.exists({ username: handle }), null, 'nothing already holds it');
  });

  /**
   * The seed's own traders are the realistic contested case: 202 of them exist
   * and a real person signing up as `trader_7@gmail.com` must not be handed one
   * of their handles.
   */
  await t.test('a real signup cannot be given a seeded trader\'s handle', async () => {
    const taken = await User.findOne({ username: /^trader_\d+$/ }).lean();
    const handle = await uniqueHandle({ email: `${taken.username}@gmail.com`, name: 'Impostor' });
    assert.notEqual(handle, taken.username);
    assert.equal(await User.countDocuments({ username: handle }), 0);
  });
});
