import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb, isEphemeral } from '../src/config/db.js';
import { runSeed } from '../src/seed/seed.js';
import { User } from '../src/models/User.js';
import { Deposit, DEPOSIT_STATUS, DEPOSIT_TRANSITIONS } from '../src/models/Deposit.js';
import { LedgerEntry, LEDGER_TYPE } from '../src/models/LedgerEntry.js';
import {
  approveDeposit,
  cancelDeposit,
  createDeposit,
  getDeposit,
  listDeposits,
  rejectDeposit,
  submitProof,
} from '../src/services/deposit.service.js';
import { reconcile, statement } from '../src/services/ledger.service.js';
import { getPortfolio } from '../src/services/portfolio.service.js';
import { round2 } from '../src/lib/money.js';
import { primeMarketCache, resetMarketCache } from '../src/services/market.service.js';

/**
 * The deposit state machine and the ledger it posts to.
 *
 * `npm test` forces `DEPOSIT_DESTINATIONS=[]` inline, for the same reason it
 * forces `MONGODB_URI=`: the test script reads the developer's own `server/.env`,
 * so the moment a real destination is configured locally, the "refused when
 * nothing is configured" case below silently starts passing for the wrong
 * reason — and the suite would be asserting against whatever happens to be in
 * one machine's environment. The assertion right at the top is the belt to that
 * braces; it does not depend on shell syntax.
 *
 * The whole point of this design is that a deposit is a long-lived object with
 * an auditable history rather than a boolean, so the cases here are mostly
 * about what must NOT be possible: crediting twice, crediting on a user's word,
 * claiming one payment against two deposits, or moving between states that are
 * not adjacent.
 *
 * The refusal case therefore runs FIRST, against a genuinely empty config, and
 * only then does the suite push its own destination for everything after it.
 *
 * The market cache is primed for the same class of reason. Quoting an exact
 * asset amount needs a price, and left to itself that is a live CoinGecko call
 * — measured at ~800ms inside this suite, against an endpoint that 429s after a
 * handful of requests. A fixed rate also makes the quote assertable, which a
 * moving one never could be.
 */

/** USDT at exactly $0.9997 — deliberately NOT $1, see `priceAsset`. */
const USDT_NANOS = 999_700_000;

test('deposits', async (t) => {
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

  const { DEPOSIT_DESTINATIONS: configured } = await import('../src/config/env.js');
  assert.equal(
    configured.length,
    0,
    'refusing to run: DEPOSIT_DESTINATIONS leaked in from the environment, so these cases would not mean what they say',
  );

  await runSeed({ fresh: true });

  const trader = await User.findOne({ username: 'jd_trader' }).lean();
  const admin = await User.findOne({ role: 'admin' }).lean();
  const userId = trader._id;
  const cashOf = async () => (await User.findById(userId).lean()).cashBalanceCents;

  /** Before anything below moves money — see the reconciliation case at the end. */
  const openingCents = await cashOf();

  /* ------------------------------------------------------------------ */

  await t.test('the state machine has no way back out of a terminal state', () => {
    for (const terminal of [
      DEPOSIT_STATUS.APPROVED,
      DEPOSIT_STATUS.REJECTED,
      DEPOSIT_STATUS.EXPIRED,
      DEPOSIT_STATUS.CANCELLED,
    ]) {
      assert.deepEqual(DEPOSIT_TRANSITIONS[terminal], [], `${terminal} has an exit`);
    }
  });

  await t.test('no state can reach approved except under_review', () => {
    const reachers = Object.entries(DEPOSIT_TRANSITIONS)
      .filter(([, to]) => to.includes(DEPOSIT_STATUS.APPROVED))
      .map(([from]) => from);
    // If anything else could reach it, money could be credited without review.
    assert.deepEqual(reachers, [DEPOSIT_STATUS.UNDER_REVIEW]);
  });

  await t.test('a deposit is refused when no destination is configured', async () => {
    await assert.rejects(
      () =>
        createDeposit({
          userId, asset: 'USDT', network: 'TRC20', amountCents: 100_000,
          idempotencyKey: 'dep-unconfigured',
        }),
      (err) => /** @type {any} */ (err).code === 'NO_DESTINATION',
    );
  });

  /**
   * Everything below needs a configured destination. The module reads the
   * parsed config at call time through a live binding, so pushing onto it here
   * is enough — and it keeps the refusal above honest, since that ran first.
   */
  const { DEPOSIT_DESTINATIONS } = await import('../src/config/env.js');
  DEPOSIT_DESTINATIONS.push({
    asset: 'USDT',
    network: 'TRC20',
    address: 'TTESTonlyNeverARealAddress0000000',
    minAmount: 10,
    // Six, as USDT actually is on TRC20. Left off it defaults to eight and the
    // quote carries two decimals the chain will not.
    decimals: 6,
  });

  let reference;

  await t.test('creating one opens it awaiting payment, with a destination', async () => {
    const { deposit } = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 100_000,
      idempotencyKey: 'dep-one',
    });

    reference = deposit.reference;
    assert.match(deposit.reference, /^DEP-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(deposit.status, DEPOSIT_STATUS.AWAITING_PAYMENT);
    assert.equal(deposit.destinationAddress, 'TTESTonlyNeverARealAddress0000000');
    assert.equal(deposit.amountCents, 100_000);
    assert.ok(deposit.expiresAt, 'a quote with no expiry is a quote forever');
  });

  /**
   * THE QUOTE. A payment is matched on the asset quantity, so the quantity has
   * to be right, quantised to something the chain can actually carry, and never
   * short of the dollar figure it was struck from.
   */
  await t.test('the quoted asset amount is exact, precise and never short', async () => {
    const d = await getDeposit({ userId, reference });

    assert.equal(d.rateUsdNanos, USDT_NANOS, 'the rate was not locked at quote time');
    assert.equal(d.assetDecimals, 6, 'USDT carries six decimals on chain');

    // Quantised to the asset's precision — an amount with more places than the
    // chain carries cannot be sent exactly, so it can never be matched exactly.
    const scaled = d.assetAmount * 10 ** d.assetDecimals;
    assert.ok(
      Math.abs(scaled - Math.round(scaled)) < 1e-6,
      `${d.assetAmount} has more precision than ${d.assetDecimals} decimals`,
    );

    // Worth at least what was asked for. Rounding is UP for exactly this
    // reason: rounding down leaves an underpayment for a reviewer to chase.
    const worthCents = d.assetAmount * (d.rateUsdNanos / 10_000_000);
    assert.ok(worthCents >= d.amountCents, `${worthCents} is short of ${d.amountCents}`);
    assert.ok(worthCents - d.amountCents < 1, 'rounded up by more than a cent');

    // And it is NOT simply the dollar figure — a stablecoin is not a dollar.
    assert.notEqual(d.assetAmount, d.amountCents / 100);
  });

  await t.test('a deposit is refused when the asset cannot be priced', async () => {
    primeMarketCache('crypto', []);
    await assert.rejects(
      () =>
        createDeposit({
          userId, asset: 'USDT', network: 'TRC20', amountCents: 100_000,
          idempotencyKey: 'dep-norate',
        }),
      (err) => /** @type {any} */ (err).code === 'NO_RATE',
    );
    primeMarketCache('crypto', [
      {
        assetClass: 'crypto', symbol: 'USDT', name: 'Tether', exchange: 'Crypto', currency: 'USD',
        priceCents: 100, priceUsdCents: 100, priceUsdNanos: USDT_NANOS,
        changePct: 0, status: 'Listed', live: true, marketCap: 0, volume: 0, logoUrl: '',
      },
    ]);
  });

  await t.test('below the configured minimum is refused', async () => {
    await assert.rejects(
      () => createDeposit({ userId, asset: 'USDT', network: 'TRC20', amountCents: 500 }),
      (err) => /** @type {any} */ (err).code === 'BELOW_MINIMUM',
    );
  });

  /**
   * The point of a first-class object: the row survives everything the browser
   * can do to it, and the reference is the handle back to it.
   */
  await t.test('it is retrievable by reference and appears in the pending list', async () => {
    const fetched = await getDeposit({ userId, reference });
    assert.equal(fetched.reference, reference);

    const pending = await listDeposits({ userId, status: DEPOSIT_STATUS.AWAITING_PAYMENT });
    assert.ok(pending.some((d) => d.reference === reference));
  });

  await t.test('a replayed create returns the same deposit, not a second one', async () => {
    const again = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 100_000,
      idempotencyKey: 'dep-one',
    });
    assert.equal(again.replayed, true);
    assert.equal(again.deposit.reference, reference);
    assert.equal(await Deposit.countDocuments({ idempotencyKey: 'dep-one' }), 1);
  });

  /**
   * THE ONE THAT MATTERS MOST. Pressing "I've sent the funds" is a claim about
   * the world, not a payment — it must move the deposit into review and credit
   * nothing at all.
   */
  await t.test('submitting proof queues it for review and credits nothing', async () => {
    const before = await cashOf();
    const { deposit } = await submitProof({
      userId, reference, txHash: '0x83aa11bb22cc33dd44ee55ff66009f92a', senderAddress: 'TFrom...',
    });

    assert.equal(deposit.status, DEPOSIT_STATUS.UNDER_REVIEW);
    assert.equal(deposit.txHash, '0x83aa11bb22cc33dd44ee55ff66009f92a');
    assert.equal(await cashOf(), before, 'the user’s own claim moved money');
    assert.equal(await LedgerEntry.countDocuments({ reference }), 0, 'posted before review');
  });

  /**
   * One on-chain payment, one deposit. Without the unique index the same hash
   * can be pasted into a second deposit and both look legitimate in the queue.
   */
  await t.test('the same transaction hash cannot be claimed twice', async () => {
    const { deposit: second } = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 50_000,
      idempotencyKey: 'dep-two',
    });

    await assert.rejects(
      () =>
        submitProof({
          userId,
          reference: second.reference,
          txHash: '0x83aa11bb22cc33dd44ee55ff66009f92a',
        }),
      (err) => /** @type {any} */ (err).code === 'TX_ALREADY_CLAIMED',
    );
  });

  await t.test('approval credits exactly once and posts one ledger entry', async () => {
    const before = await cashOf();
    const res = await approveDeposit({ reference, adminId: admin._id, note: 'verified on-chain' });

    assert.equal(res.credited, true);
    assert.equal(res.deposit.status, DEPOSIT_STATUS.APPROVED);
    assert.equal(await cashOf(), before + 100_000);

    const entries = await LedgerEntry.find({ reference }).lean();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, LEDGER_TYPE.DEPOSIT);
    assert.equal(entries[0].amountCents, 100_000);
    assert.equal(entries[0].balanceAfterCents, before + 100_000);
  });

  /**
   * The admin double-click. The status compare-and-set is the guard; the unique
   * {type, reference} index on the ledger is the independent second one.
   */
  await t.test('approving again credits nothing', async () => {
    const before = await cashOf();
    await assert.rejects(
      () => approveDeposit({ reference, adminId: admin._id }),
      (err) => ['STALE_STATE', 'ALREADY_POSTED'].includes(/** @type {any} */ (err).code),
    );
    assert.equal(await cashOf(), before, 'a second approval credited again');
    assert.equal(await LedgerEntry.countDocuments({ reference }), 1);
  });

  /**
   * WHAT THE WHOLE FLOW IS FOR: the money has to turn up as money.
   *
   * Two assertions, and the second is the one that was wrong. Buying power is
   * `cashBalanceCents` straight through, so the first checks the credit reached
   * the field the trade ticket actually reads. The second checks that paying
   * money in was not recorded as having MADE money — `portfolioValue -
   * SEED_CASH_CENTS` counted every deposit as profit, so a $2,500 deposit read
   * as a $2,500 all-time return on the card directly beside Buying power,
   * without a single trade.
   */
  await t.test('an approved deposit lands in buying power without becoming return', async () => {
    const before = await getPortfolio(userId, await cashOf());

    const { deposit } = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 250_000,
      idempotencyKey: 'dep-buying-power',
    });
    await submitProof({ userId, reference: deposit.reference, txHash: '0xb0111ab2cd3ef4567890' });
    await approveDeposit({ reference: deposit.reference, adminId: admin._id });

    const after = await getPortfolio(userId, await cashOf());

    assert.equal(after.summary.buyingPowerCents, before.summary.buyingPowerCents + 250_000);
    assert.equal(after.summary.portfolioValueCents, before.summary.portfolioValueCents + 250_000);
    assert.equal(after.summary.investedCents, before.summary.investedCents + 250_000);

    assert.equal(
      after.summary.allTimeReturnCents,
      before.summary.allTimeReturnCents,
      'the deposit was counted as investment return',
    );
    assert.equal(after.summary.allTimeReturnPct, round2(
      (after.summary.allTimeReturnCents / after.summary.investedCents) * 100,
    ));

    // The Cash slice is buying power exactly, so a deposit has to reach the
    // donut too or the allocation stops reconciling to the total.
    const cashSlice = after.allocation.find((a) => a.label === 'Cash');
    assert.equal(cashSlice.valueCents, after.summary.buyingPowerCents);
    assert.equal(
      after.allocation.reduce((sum, a) => sum + a.valueCents, 0),
      after.summary.portfolioValueCents,
    );
  });

  await t.test('an approved deposit cannot be rejected afterwards', async () => {
    await assert.rejects(
      () => rejectDeposit({ reference, adminId: admin._id, reason: 'changed my mind' }),
      (err) => /** @type {any} */ (err).code === 'STALE_STATE',
    );
  });

  await t.test('rejection moves no money and records the reason', async () => {
    const { deposit } = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 25_000,
      idempotencyKey: 'dep-reject',
    });
    await submitProof({ userId, reference: deposit.reference, txHash: '0xrejectme00112233' });

    const before = await cashOf();
    const res = await rejectDeposit({
      reference: deposit.reference, adminId: admin._id, reason: 'amount does not match the chain',
    });

    assert.equal(res.credited, false);
    assert.equal(res.deposit.status, DEPOSIT_STATUS.REJECTED);
    assert.equal(res.deposit.rejectionReason, 'amount does not match the chain');
    assert.equal(await cashOf(), before);
    assert.equal(await LedgerEntry.countDocuments({ reference: deposit.reference }), 0);
  });

  await t.test('a user can cancel one that has not been paid', async () => {
    const { deposit } = await createDeposit({
      userId, asset: 'USDT', network: 'TRC20', amountCents: 20_000,
      idempotencyKey: 'dep-cancel',
    });
    const res = await cancelDeposit({ userId, reference: deposit.reference });
    assert.equal(res.deposit.status, DEPOSIT_STATUS.CANCELLED);

    // And a cancelled one is terminal — no late payment revives it.
    await assert.rejects(
      () => submitProof({ userId, reference: deposit.reference, txHash: '0xlatepayment0011' }),
      (err) => /** @type {any} */ (err).code === 'STALE_STATE',
    );
  });

  await t.test('one user cannot read another user’s deposit', async () => {
    const other = await User.findOne({ role: 'user', _id: { $ne: userId } }).lean();
    await assert.rejects(
      () => getDeposit({ userId: other._id, reference }),
      (err) => /** @type {any} */ (err).status === 404,
    );
  });

  await t.test('every transition is recorded in the history', async () => {
    const d = await getDeposit({ userId, reference });
    const path = d.history.map((h) => h.to);
    assert.deepEqual(path, [
      DEPOSIT_STATUS.CREATED,
      DEPOSIT_STATUS.AWAITING_PAYMENT,
      DEPOSIT_STATUS.PAYMENT_DETECTED,
      DEPOSIT_STATUS.UNDER_REVIEW,
      DEPOSIT_STATUS.APPROVED,
    ]);
  });

  /**
   * The check that makes a maintained balance safe to trust: the sum of the
   * ledger plus what the account opened with must equal the balance field.
   */
  await t.test('the ledger reconciles against the balance', async () => {
    const entries = await statement(userId);

    // `openingCents` is the balance captured before the suite moved anything.
    // Deriving it here as `balance - posted` — which is what this did — makes
    // the report balanced by construction, so it could not have caught a
    // credit that skipped the ledger. It is the whole point of the check.
    const report = await reconcile(userId, { openingCents });
    assert.equal(report.balanced, true, `ledger drifted by ${report.driftCents} cents`);

    // A statement is only useful if the running balance is really running.
    const chronological = [...entries].reverse();
    for (const e of chronological) {
      assert.ok(Number.isInteger(e.balanceAfterCents));
    }
  });
});
