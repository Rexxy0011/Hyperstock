import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { Deposit, DEPOSIT_STATUS } from '../src/models/Deposit.js';
import { Withdrawal, WITHDRAWAL_STATUS } from '../src/models/Withdrawal.js';
import { TopUpRequest } from '../src/models/TopUpRequest.js';
import { queueCounts, traderOf } from '../src/services/adminQueue.service.js';
import { listDeposits } from '../src/services/deposit.service.js';
import { listWithdrawals } from '../src/services/withdrawal.service.js';
import { listTopUps } from '../src/services/wallet.service.js';

/**
 * The approvals queues.
 *
 * The defect this pins is one of OMISSION and it was invisible from the API:
 * all three listings returned well-formed rows that never said whose money they
 * were. An operator approving a deposit is crediting a specific account, so a
 * queue without an account on it is a screen that cannot be worked — and the
 * endpoints looked fine, because the shapes were written for the user reading
 * their own row.
 */

const depositFixture = (userId, reference, status) => ({
  userId,
  reference,
  method: 'crypto',
  asset: 'USDT',
  network: 'TRC20',
  destinationAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  amountCents: 100_000,
  assetAmount: 1000.305094,
  assetDecimals: 6,
  rateUsdNanos: 999_695_000,
  status,
});

const withdrawalFixture = (userId, reference, status) => ({
  userId,
  reference,
  method: 'crypto',
  asset: 'USDT',
  network: 'TRC20',
  destinationAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  amountCents: 50_000,
  assetAmount: 500.1,
  assetDecimals: 6,
  rateUsdNanos: 999_695_000,
  status,
});

test('admin approval queues', async (t) => {
  await connectDb();
  t.after(async () => disconnectDb());

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  await runSeed({ fresh: true });

  const jd = await User.findOne({ username: 'jd_trader' }).lean();

  t.beforeEach(async () => {
    await Promise.all([
      Deposit.deleteMany({}),
      Withdrawal.deleteMany({}),
      TopUpRequest.deleteMany({}),
    ]);
  });

  /* ------------------------------------------------------------ the identity */

  await t.test('traderOf exposes an identity and not a balance', () => {
    const out = traderOf({
      _id: 'abc',
      username: 'jd_trader',
      displayName: 'JD',
      email: 'jd@hyperstocks.app',
      cashBalanceCents: 999,
    });

    assert.deepEqual(out, {
      userId: 'abc',
      username: 'jd_trader',
      displayName: 'JD',
      email: 'jd@hyperstocks.app',
    });
    // A queue needs to identify a person and contact them, not read their book.
    assert.equal('cashBalanceCents' in out, false);
  });

  await t.test('an unpopulated reference resolves to null, not a broken row', () => {
    // `.populate()` leaves a bare ObjectId when the referenced user is gone.
    assert.equal(traderOf('6a8c362e51a458e1b32564b9'), null);
    assert.equal(traderOf(null), null);
  });

  /* --------------------------------------------------------------- the joins */

  await t.test('the admin deposit listing names the account; the user one does not', async () => {
    await Deposit.create(depositFixture(jd._id, 'DEP-2026-TEST01', DEPOSIT_STATUS.UNDER_REVIEW));

    const [asAdmin] = await listDeposits({ admin: true });
    assert.equal(asAdmin.trader.username, 'jd_trader');
    assert.equal(asAdmin.trader.email, 'jd@hyperstocks.app');

    // The depositor already knows whose it is; the join would be a round trip
    // for a field nothing on their screen renders.
    const [asUser] = await listDeposits({ userId: jd._id });
    assert.equal('trader' in asUser, false);
  });

  await t.test('the admin withdrawal listing names the account', async () => {
    await Withdrawal.create(
      withdrawalFixture(jd._id, 'WDR-2026-TEST01', WITHDRAWAL_STATUS.REQUESTED),
    );

    const [row] = await listWithdrawals({ admin: true });
    assert.equal(row.trader.username, 'jd_trader');
    // The address is what an operator sends to, so it must survive the join.
    assert.equal(row.destinationAddress, 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');

    const [mine] = await listWithdrawals({ userId: jd._id });
    assert.equal('trader' in mine, false);
  });

  await t.test('the admin top-up listing names the account', async () => {
    await TopUpRequest.create({ userId: jd._id, amountCents: 250_000, status: 'Pending' });

    const [row] = await listTopUps({ admin: true });
    assert.equal(row.trader.username, 'jd_trader');

    const [mine] = await listTopUps({ userId: jd._id });
    assert.equal('trader' in mine, false);
  });

  /* -------------------------------------------------------------- the counts */

  await t.test('counts only what is waiting on an OPERATOR', async () => {
    await Deposit.create([
      depositFixture(jd._id, 'DEP-2026-Q1', DEPOSIT_STATUS.UNDER_REVIEW),
      // Waiting on the DEPOSITOR. Counting it pads a queue nobody can act on.
      depositFixture(jd._id, 'DEP-2026-Q2', DEPOSIT_STATUS.AWAITING_PAYMENT),
      depositFixture(jd._id, 'DEP-2026-Q3', DEPOSIT_STATUS.APPROVED),
    ]);

    const counts = await queueCounts();
    assert.equal(counts.deposits, 1);
  });

  await t.test('a claimed withdrawal is still outstanding work', async () => {
    await Withdrawal.create([
      withdrawalFixture(jd._id, 'WDR-2026-Q1', WITHDRAWAL_STATUS.REQUESTED),
      // Claimed and unfinished. Dropping it from the count is how a payout sits
      // forgotten with the trader's cash already debited.
      withdrawalFixture(jd._id, 'WDR-2026-Q2', WITHDRAWAL_STATUS.UNDER_REVIEW),
      withdrawalFixture(jd._id, 'WDR-2026-Q3', WITHDRAWAL_STATUS.APPROVED),
    ]);

    const counts = await queueCounts();
    assert.equal(counts.withdrawals, 2);
  });

  await t.test('the total is the sum of the three', async () => {
    await Deposit.create(depositFixture(jd._id, 'DEP-2026-T1', DEPOSIT_STATUS.UNDER_REVIEW));
    await Withdrawal.create(
      withdrawalFixture(jd._id, 'WDR-2026-T1', WITHDRAWAL_STATUS.REQUESTED),
    );
    await TopUpRequest.create([
      { userId: jd._id, amountCents: 200_000, status: 'Pending' },
      { userId: jd._id, amountCents: 300_000, status: 'Approved' },
    ]);

    const c = await queueCounts();
    assert.deepEqual(c, { deposits: 1, withdrawals: 1, topups: 1, total: 3 });
  });

  await t.test('an empty queue is zero, not a missing key', async () => {
    assert.deepEqual(await queueCounts(), {
      deposits: 0,
      withdrawals: 0,
      topups: 0,
      total: 0,
    });
  });
});
