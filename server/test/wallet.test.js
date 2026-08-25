import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { AUTO_TOPUP_LIMIT_CENTS, MAX_TOPUP_CENTS } from '../src/config/env.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { LedgerEntry, LEDGER_TYPE } from '../src/models/LedgerEntry.js';
import { TopUpRequest } from '../src/models/TopUpRequest.js';
import { Transaction } from '../src/models/Transaction.js';
import { reconcile } from '../src/services/ledger.service.js';
import { requestTopUp, reviewTopUp, listTopUps } from '../src/services/wallet.service.js';

/**
 * Top-ups credit cash, so they get the order ledger's scrutiny rather than a
 * lighter version of it: a double-tapped button must not fund an account twice,
 * and two administrators on the same queue row must not either.
 */
test('wallet top-ups', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });

  const trader = await User.findOne({ username: 'jd_trader' }).lean();
  const admin = await User.findOne({ role: 'admin' }).lean();
  const userId = trader._id;
  const cashOf = async () => (await User.findById(userId).lean()).cashBalanceCents;

  /**
   * Captured BEFORE anything moves, so `reconcile()` is a real assertion.
   * The seed grants cash without posting an OPENING entry, and deriving this
   * from the balance at check time — `balance - posted` — makes the report
   * balanced by construction and unable to fail.
   */
  const openingCents = await cashOf();

  await t.test('a small request is credited immediately', async () => {
    const before = await cashOf();
    const res = await requestTopUp({
      userId,
      amountCents: 50_000,
      idempotencyKey: 'test-instant-topup',
    });

    assert.equal(res.credited, true);
    assert.equal(res.request.status, 'Approved');
    assert.equal(res.cashBalanceCents, before + 50_000);
    assert.equal(await cashOf(), before + 50_000);
  });

  await t.test('it writes a transaction row for the credit', async () => {
    const txn = await Transaction.findOne({ userId, type: 'Top-up' })
      .sort({ createdAt: -1 })
      .lean();
    assert.ok(txn, 'no Top-up transaction written');
    assert.equal(txn.amountCents, 50_000);
    assert.equal(txn.status, 'Approved');
    assert.ok(Number.isInteger(txn.amountCents));
  });

  /**
   * AND THE ACTUAL LEDGER, WHICH IS A DIFFERENT COLLECTION.
   *
   * The case above is `Transaction` — the row the Wallet screen lists. It is
   * not the audit record, and for a while this suite checked only that one:
   * `credit()` incremented `cashBalanceCents` with a bare `$inc` and posted
   * nothing, so the balance and the ledger that is supposed to explain it drew
   * apart by the value of every top-up ever made, and the test named "writes a
   * ledger row" passed throughout. Hence both assertions, and hence the
   * reconciliation below rather than a spot check.
   */
  await t.test('it posts to the ledger, and the ledger still reconciles', async () => {
    const entry = await LedgerEntry.findOne({ userId, type: LEDGER_TYPE.TOPUP })
      .sort({ createdAt: -1 })
      .lean();

    assert.ok(entry, 'a top-up moved cash without posting to the ledger');
    assert.equal(entry.amountCents, 50_000);
    assert.equal(entry.balanceAfterCents, await cashOf());

    const report = await reconcile(userId, { openingCents });
    assert.equal(report.balanced, true, `ledger drifted by ${report.driftCents} cents`);
  });

  /**
   * The one that matters most. A retried submit must collide on the unique
   * index BEFORE any money moves — the same insert-first mechanism the order
   * ticket uses, and for the same reason.
   */
  await t.test('a replayed key does not fund the account twice', async () => {
    const before = await cashOf();
    const res = await requestTopUp({
      userId,
      amountCents: 50_000,
      idempotencyKey: 'test-instant-topup',
    });

    assert.equal(res.replayed, true);
    assert.equal(await cashOf(), before, 'a replay credited the account again');
    assert.equal(
      await TopUpRequest.countDocuments({ idempotencyKey: 'test-instant-topup' }),
      1,
      'a replay wrote a second request row',
    );
  });

  await t.test('a large request queues instead of crediting', async () => {
    const before = await cashOf();
    const res = await requestTopUp({
      userId,
      amountCents: AUTO_TOPUP_LIMIT_CENTS + 100,
      idempotencyKey: 'test-queued-topup',
    });

    assert.equal(res.credited, false);
    assert.equal(res.request.status, 'Pending');
    assert.equal(await cashOf(), before, 'a queued request moved money');
    // The response says so in words: an unchanged balance on its own is
    // indistinguishable from a failure.
    assert.match(res.message, /reviewed/i);
  });

  await t.test('an amount over the ceiling is refused', async () => {
    await assert.rejects(
      () => requestTopUp({ userId, amountCents: MAX_TOPUP_CENTS + 1 }),
      (err) => /** @type {any} */ (err).code === 'AMOUNT_TOO_LARGE',
    );
  });

  await t.test('a sub-dollar amount is refused', async () => {
    await assert.rejects(
      () => requestTopUp({ userId, amountCents: 99 }),
      (err) => /** @type {any} */ (err).code === 'BAD_AMOUNT',
    );
  });

  await t.test('an admin approval credits exactly once', async () => {
    const pending = (await listTopUps({ userId, status: 'Pending' }))[0];
    assert.ok(pending, 'expected a queued request from the earlier case');

    const before = await cashOf();
    const res = await reviewTopUp({ id: pending.id, adminId: admin._id, approve: true });

    assert.equal(res.credited, true);
    assert.equal(await cashOf(), before + pending.amountCents);

    // The guard is the `{ status: 'Pending' }` filter, so a second approval —
    // two admins on the queue, or a double-click — matches nothing.
    await assert.rejects(
      () => reviewTopUp({ id: pending.id, adminId: admin._id, approve: true }),
      (err) => /** @type {any} */ (err).code === 'ALREADY_REVIEWED',
    );
    assert.equal(await cashOf(), before + pending.amountCents, 'a second approval credited again');
  });

  await t.test('declining moves no money', async () => {
    const queued = await requestTopUp({
      userId,
      amountCents: AUTO_TOPUP_LIMIT_CENTS + 500,
      idempotencyKey: 'test-decline-topup',
    });

    const before = await cashOf();
    const res = await reviewTopUp({
      id: queued.request.id,
      adminId: admin._id,
      approve: false,
      note: 'no',
    });

    assert.equal(res.credited, false);
    assert.equal(res.request.status, 'Declined');
    assert.equal(await cashOf(), before);
  });

  await t.test('the queue is capped per user', async () => {
    // One is already Declined and one Approved, so start from what is open.
    for (let i = 0; i < 4; i++) {
      try {
        await requestTopUp({
          userId,
          amountCents: AUTO_TOPUP_LIMIT_CENTS + 1_000,
          idempotencyKey: `test-cap-${i}`,
        });
      } catch (err) {
        assert.equal(/** @type {any} */ (err).code, 'TOO_MANY_PENDING');
        return;
      }
    }
    assert.fail('the pending cap never engaged');
  });

  await t.test('every persisted top-up amount is an integer', async () => {
    for (const r of await TopUpRequest.find().lean()) {
      assert.ok(Number.isInteger(r.amountCents), `${r._id} has a non-integer amount`);
    }
  });
});
