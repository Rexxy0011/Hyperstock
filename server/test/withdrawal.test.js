import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { LedgerEntry, LEDGER_TYPE } from '../src/models/LedgerEntry.js';
import {
  Withdrawal,
  WITHDRAWAL_STATUS,
  WITHDRAWAL_TRANSITIONS,
} from '../src/models/Withdrawal.js';
import { reconcile } from '../src/services/ledger.service.js';
import { getPortfolio } from '../src/services/portfolio.service.js';
import { primeMarketCache, resetMarketCache } from '../src/services/market.service.js';

/**
 * Paying money OUT — where the failure modes invert.
 *
 * A deposit that goes wrong makes somebody wait. A withdrawal that goes wrong
 * sends money that cannot be recalled, so almost every case here is about what
 * must NOT be possible: withdrawing more than the account holds, two operators
 * both paying the same request, a cancelled payout that does not hand the money
 * back, or a payout reaching `approved` without having been claimed first.
 *
 * The cash movement is the part worth watching. Unlike a deposit, the debit
 * happens at REQUEST time — so the assertions are on the balance immediately
 * after creating, not after approving, and approval is asserted to move nothing.
 */

const USDT_NANOS = 999_700_000;

test('withdrawals', async (t) => {
  await connectDb();
  t.after(async () => {
    resetMarketCache();
    await disconnectDb();
  });

  primeMarketCache('crypto', [
    {
      assetClass: 'crypto', symbol: 'USDT', name: 'Tether', exchange: 'Crypto', currency: 'USD',
      priceCents: 100, priceUsdCents: 100, priceUsdNanos: USDT_NANOS,
      changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
    },
  ]);

  assert.equal(
    isEphemeral(),
    true,
    'refusing to run: this suite drops all collections and is not connected to an ephemeral database',
  );

  const { env, DEPOSIT_DESTINATIONS } = await import('../src/config/env.js');

  /**
   * Both are forced here rather than assumed, the same trap `npm test` already
   * hit twice: the suite reads the developer's own `server/.env`, so a machine
   * with withdrawals switched on or a destination configured would otherwise
   * change what these cases mean.
   */
  assert.equal(
    DEPOSIT_DESTINATIONS.length,
    0,
    'refusing to run: DEPOSIT_DESTINATIONS leaked in from the environment',
  );

  await runSeed({ fresh: true });

  const trader = await User.findOne({ username: 'jd_trader' }).lean();
  const admin = await User.findOne({ role: 'admin' }).lean();
  const other = await User.findOne({ username: { $ne: 'jd_trader' }, role: 'user' }).lean();
  const userId = trader._id;
  const cashOf = async () => (await User.findById(userId).lean()).cashBalanceCents;

  /** Before anything moves — see the reconciliation case at the end. */
  const openingCents = await cashOf();

  const { createWithdrawal, cancelWithdrawal, claimWithdrawal, approveWithdrawal,
    rejectWithdrawal, getWithdrawal, listWithdrawals, withdrawalMethods } =
    await import('../src/services/withdrawal.service.js');

  const request = (over = {}) =>
    createWithdrawal({
      userId, asset: 'USDT', network: 'TRC20',
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
      amountCents: 50_000,
      ...over,
    });

  /* ------------------------------------------------------------------ */

  await t.test('the state machine has no way back out of a terminal state', () => {
    for (const terminal of [
      WITHDRAWAL_STATUS.APPROVED,
      WITHDRAWAL_STATUS.REJECTED,
      WITHDRAWAL_STATUS.CANCELLED,
    ]) {
      assert.deepEqual(WITHDRAWAL_TRANSITIONS[terminal], [], `${terminal} has an exit`);
    }
  });

  /**
   * The invariant that stops a payout going out unclaimed. If anything else
   * could reach `approved`, two operators could both confirm the same row and
   * each believe they were the one who sent it.
   */
  await t.test('no state can reach approved except under_review', () => {
    const reachers = Object.entries(WITHDRAWAL_TRANSITIONS)
      .filter(([, to]) => to.includes(WITHDRAWAL_STATUS.APPROVED))
      .map(([from]) => from);
    assert.deepEqual(reachers, [WITHDRAWAL_STATUS.UNDER_REVIEW]);
  });

  await t.test('it is refused while withdrawals are disabled', async () => {
    assert.equal(env.WITHDRAWALS_ENABLED, false, 'the default is meant to be off');
    await assert.rejects(
      () => request({ idempotencyKey: 'wdr-disabled' }),
      (err) => /** @type {any} */ (err).code === 'WITHDRAWALS_DISABLED',
    );
    assert.equal(await Withdrawal.countDocuments({}), 0);
  });

  // Everything below needs the feature on and a network to pay out over. Both
  // are live bindings, so mutating them here is enough — and the two refusals
  // above ran first, against the genuine defaults.
  env.WITHDRAWALS_ENABLED = true;
  DEPOSIT_DESTINATIONS.push({
    asset: 'USDT', network: 'TRC20',
    address: 'TTESTonlyNeverARealAddress0000000',
    minAmount: 10, decimals: 6,
  });

  await t.test('the payout networks come from the deposit destinations', async () => {
    const methods = await withdrawalMethods();
    assert.equal(methods.crypto.available, true);
    assert.equal(methods.crypto.assets.length, 1);
    assert.equal(methods.crypto.assets[0].networks[0].network, 'TRC20');
    // Ours is a receiving address and has no business on a payout screen.
    assert.equal(
      JSON.stringify(methods).includes('TTESTonlyNeverARealAddress0000000'),
      false,
      'the treasury address leaked into the withdrawal methods',
    );
  });

  let reference;

  /**
   * THE DEBIT IS AT REQUEST TIME. This is the case that separates a withdrawal
   * from a deposit, and it is asserted on the balance rather than on the row.
   */
  await t.test('requesting one holds the cash immediately', async () => {
    const before = await cashOf();
    const res = await request({ idempotencyKey: 'wdr-one' });

    reference = res.withdrawal.reference;
    assert.match(reference, /^WDR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(res.withdrawal.status, WITHDRAWAL_STATUS.REQUESTED);
    assert.equal(await cashOf(), before - 50_000, 'the hold did not leave the balance');
    assert.equal(res.balanceAfterCents, before - 50_000);

    const entries = await LedgerEntry.find({ reference }).lean();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, LEDGER_TYPE.WITHDRAWAL);
    assert.equal(entries[0].amountCents, -50_000, 'the hold must be a signed debit');
  });

  /**
   * The quote rounds DOWN, the opposite of a deposit: rounding up would send
   * more of the asset than the account was debited for.
   */
  await t.test('the quoted quantity is rounded down at the asset precision', async () => {
    const w = await getWithdrawal({ userId, reference });
    const exact = 50_000 / (USDT_NANOS / 10_000_000);
    assert.equal(w.assetDecimals, 6);
    assert.ok(w.assetAmount <= exact, 'rounded up, so the payout exceeds the debit');
    assert.equal(w.assetAmount, Math.floor(exact * 1e6) / 1e6);
    assert.equal(w.rateUsdNanos, USDT_NANOS);
  });

  await t.test('the hold shows up as reduced buying power', async () => {
    const p = await getPortfolio(userId, await cashOf());
    assert.equal(p.summary.buyingPowerCents, await cashOf());
    // Money committed to a payout is not available to trade with, which is the
    // entire reason the debit is here rather than at approval.
    assert.equal(p.summary.buyingPowerCents, openingCents - 50_000);
  });

  await t.test('a replayed key returns the original and holds nothing twice', async () => {
    const before = await cashOf();
    const res = await request({ idempotencyKey: 'wdr-one' });

    assert.equal(res.replayed, true);
    assert.equal(res.withdrawal.reference, reference);
    assert.equal(await cashOf(), before, 'a replay debited the account again');
    assert.equal(await LedgerEntry.countDocuments({ reference }), 1);
  });

  /**
   * The guard is `post()`'s overdraw filter, which is one atomic operation
   * rather than a read followed by a hopeful write.
   */
  await t.test('more than the balance holds is refused', async () => {
    const before = await cashOf();
    await assert.rejects(
      () => request({ amountCents: before + 100_000, idempotencyKey: 'wdr-toobig' }),
      (err) => ['INSUFFICIENT_FUNDS', 'AMOUNT_TOO_LARGE'].includes(/** @type {any} */ (err).code),
    );
    assert.equal(await cashOf(), before, 'a refused withdrawal still moved money');
  });

  await t.test('below the minimum and above the ceiling are both refused', async () => {
    await assert.rejects(
      () => request({ amountCents: 100, idempotencyKey: 'wdr-tiny' }),
      (err) => /** @type {any} */ (err).code === 'BAD_AMOUNT',
    );
    await assert.rejects(
      () => request({ amountCents: 90_000_00, idempotencyKey: 'wdr-huge' }),
      (err) => /** @type {any} */ (err).code === 'AMOUNT_TOO_LARGE',
    );
  });

  /**
   * THE ADDRESS IS THE ONE MISTAKE NOBODY CAN UNDO.
   *
   * The length check this replaced accepted the third string below — observed
   * on a live $3,937 request during testing. A reviewer cannot eyeball a Tron
   * address either, so nothing downstream would have caught it.
   */
  await t.test('an address that is not one for that chain is refused', async () => {
    const { checkAddress } = await import('../src/services/withdrawal.service.js');

    const bad = [
      ['nope', 'TRC20'],
      ['', 'TRC20'],
      // Long enough to pass a length check, and keyboard mash.
      ['gdghsdhjsdhdjsdksjdhdjsjdujdu', 'TRC20'],
      // Right shape, WRONG CHAIN — the mistake that actually happens.
      ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'TRC20'],
      ['TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'ERC20'],
      ['TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'BITCOIN'],
      // One character short, and one character too many.
      ['TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLS', 'TRC20'],
      ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe', 'ERC20'],
      // Base58 excludes 0/O/I/l precisely so a mis-copy fails here.
      ['T0n9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'TRC20'],
    ];
    for (const [address, network] of bad) {
      assert.ok(checkAddress(address, network), `${network} accepted "${address}"`);
    }

    const good = [
      ['TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'TRC20'],
      ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'ERC20'],
      ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'BEP20'],
      ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BITCOIN'],
      ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BITCOIN'],
      ['DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', 'DOGECOIN'],
      ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'SPL'],
    ];
    for (const [address, network] of good) {
      assert.equal(checkAddress(address, network), null, `${network} rejected "${address}"`);
    }

    // And it is enforced, not merely available.
    await assert.rejects(
      () => request({ address: 'gdghsdhjsdhdjsdksjdhdjsjdujdu', idempotencyKey: 'wdr-badaddr' }),
      (err) => /** @type {any} */ (err).code === 'BAD_ADDRESS',
    );
  });

  await t.test('an unsupported network is refused', async () => {
    await assert.rejects(
      () => request({ network: 'BEP20', idempotencyKey: 'wdr-badnet' }),
      (err) => /** @type {any} */ (err).code === 'NO_NETWORK',
    );
  });

  await t.test('it cannot be approved before it has been claimed', async () => {
    await assert.rejects(
      () => approveWithdrawal({ reference, adminId: admin._id, txHash: '0xsent00000000' }),
      (err) => ['BAD_TRANSITION', 'STALE_STATE'].includes(/** @type {any} */ (err).code),
    );
    const w = await getWithdrawal({ userId, reference });
    assert.equal(w.status, WITHDRAWAL_STATUS.REQUESTED);
  });

  await t.test('only one operator can claim it', async () => {
    const first = await claimWithdrawal({ reference, adminId: admin._id });
    assert.equal(first.withdrawal.status, WITHDRAWAL_STATUS.UNDER_REVIEW);

    // The second operator on the same row matches no document.
    await assert.rejects(
      () => claimWithdrawal({ reference, adminId: admin._id }),
      (err) => ['STALE_STATE', 'BAD_TRANSITION'].includes(/** @type {any} */ (err).code),
    );
  });

  await t.test('a claimed withdrawal can no longer be cancelled by the user', async () => {
    const before = await cashOf();
    await assert.rejects(
      () => cancelWithdrawal({ userId, reference }),
      (err) => /** @type {any} */ (err).code === 'STALE_STATE',
    );
    assert.equal(await cashOf(), before);
  });

  await t.test('approval requires evidence that a transfer exists', async () => {
    await assert.rejects(
      () => approveWithdrawal({ reference, adminId: admin._id, txHash: '' }),
      (err) => /** @type {any} */ (err).code === 'BAD_TX_HASH',
    );
  });

  /**
   * APPROVAL MOVES NO MONEY. The debit already happened; this records that an
   * operator sent the funds. That ordering is what makes a double approval
   * harmless — there is nothing left to debit.
   */
  await t.test('approval records the transfer and moves no money', async () => {
    const before = await cashOf();
    const res = await approveWithdrawal({
      reference, adminId: admin._id, txHash: '0xa1b2c3d4e5f60718',
    });

    assert.equal(res.sent, true);
    assert.equal(res.withdrawal.status, WITHDRAWAL_STATUS.APPROVED);
    assert.equal(res.withdrawal.txHash, '0xa1b2c3d4e5f60718');
    assert.equal(await cashOf(), before, 'approval moved money a second time');
    assert.equal(await LedgerEntry.countDocuments({ reference }), 1);
  });

  await t.test('approving again sends nothing', async () => {
    const before = await cashOf();
    await assert.rejects(
      () => approveWithdrawal({ reference, adminId: admin._id, txHash: '0xa1b2c3d4e5f60718' }),
      (err) => ['STALE_STATE', 'BAD_TRANSITION'].includes(/** @type {any} */ (err).code),
    );
    assert.equal(await cashOf(), before);
    assert.equal(await LedgerEntry.countDocuments({ reference }), 1);
  });

  /* ----------------------------------------------- the money coming back */

  await t.test('cancelling hands the hold back in full', async () => {
    const before = await cashOf();
    const { withdrawal } = await request({ amountCents: 25_000, idempotencyKey: 'wdr-cancel' });
    assert.equal(await cashOf(), before - 25_000);

    const res = await cancelWithdrawal({ userId, reference: withdrawal.reference });
    assert.equal(res.withdrawal.status, WITHDRAWAL_STATUS.CANCELLED);
    assert.equal(await cashOf(), before, 'the hold was not returned');

    // Two entries under one reference, distinguished by type — the ledger
    // records the round trip rather than erasing it.
    const entries = await LedgerEntry.find({ reference: withdrawal.reference }).lean();
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.amountCents).sort((a, b) => a - b),
      [-25_000, 25_000],
    );
  });

  await t.test('rejection hands the hold back in full', async () => {
    const before = await cashOf();
    const { withdrawal } = await request({ amountCents: 30_000, idempotencyKey: 'wdr-reject' });
    await claimWithdrawal({ reference: withdrawal.reference, adminId: admin._id });

    const res = await rejectWithdrawal({
      reference: withdrawal.reference, adminId: admin._id, reason: 'address failed screening',
    });

    assert.equal(res.withdrawal.status, WITHDRAWAL_STATUS.REJECTED);
    assert.equal(res.withdrawal.rejectionReason, 'address failed screening');
    assert.equal(await cashOf(), before, 'a rejected payout kept the money');
  });

  await t.test('a cancelled withdrawal is not counted as a loss', async () => {
    const before = await getPortfolio(userId, await cashOf());
    const { withdrawal } = await request({ amountCents: 40_000, idempotencyKey: 'wdr-return' });

    // While it is held, the money has genuinely left the account — so it is out
    // of both buying power and invested capital, and the return is unchanged.
    const held = await getPortfolio(userId, await cashOf());
    assert.equal(held.summary.buyingPowerCents, before.summary.buyingPowerCents - 40_000);
    assert.equal(held.summary.investedCents, before.summary.investedCents - 40_000);
    assert.equal(held.summary.allTimeReturnCents, before.summary.allTimeReturnCents);

    await cancelWithdrawal({ userId, reference: withdrawal.reference });
    const after = await getPortfolio(userId, await cashOf());
    assert.deepEqual(after.summary, before.summary, 'the round trip left a trace');
  });

  await t.test('one user cannot read or cancel another’s withdrawal', async () => {
    await assert.rejects(
      () => getWithdrawal({ userId: other._id, reference }),
      (err) => /** @type {any} */ (err).status === 404,
    );
    await assert.rejects(
      () => cancelWithdrawal({ userId: other._id, reference }),
      (err) => /** @type {any} */ (err).status === 404,
    );
  });

  await t.test('the queue is capped per user', async () => {
    const open = await listWithdrawals({ userId, status: WITHDRAWAL_STATUS.REQUESTED });
    for (let i = open.length; i < env.MAX_OPEN_WITHDRAWALS; i++) {
      await request({ amountCents: 20_000, idempotencyKey: `wdr-cap-${i}` });
    }
    await assert.rejects(
      () => request({ amountCents: 20_000, idempotencyKey: 'wdr-cap-over' }),
      (err) => /** @type {any} */ (err).code === 'TOO_MANY_PENDING',
    );
  });

  /**
   * The check that makes the whole thing trustworthy: after holds, returns,
   * approvals and refusals, the sum of the ledger still equals the balance.
   */
  await t.test('the ledger reconciles against the balance', async () => {
    const report = await reconcile(userId, { openingCents });
    assert.equal(report.balanced, true, `ledger drifted by ${report.driftCents} cents`);
  });

  await t.test('every persisted withdrawal amount is an integer', async () => {
    for (const w of await Withdrawal.find({}).lean()) {
      assert.ok(Number.isInteger(w.amountCents), `${w.reference} amountCents is not an integer`);
    }
    for (const e of await LedgerEntry.find({}).lean()) {
      assert.ok(Number.isInteger(e.amountCents));
      assert.ok(Number.isInteger(e.balanceAfterCents));
    }
  });
});
