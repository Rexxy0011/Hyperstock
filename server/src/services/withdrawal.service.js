import crypto from 'node:crypto';
import {
  DEPOSIT_DESTINATIONS,
  WITHDRAWAL_NETWORKS,
  MAX_WITHDRAWAL_CENTS,
  MIN_WITHDRAWAL_CENTS,
  env,
} from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { ApiError } from '../lib/ApiError.js';
import { usdFromCents } from '../lib/money.js';
import { LEDGER_TYPE } from '../models/LedgerEntry.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { traderOf, TRADER_FIELDS } from './adminQueue.service.js';
import {
  REVERSING_STATUSES,
  WITHDRAWAL_STATUS,
  WITHDRAWAL_TRANSITIONS,
  Withdrawal,
} from '../models/Withdrawal.js';
import { post } from './ledger.service.js';
import { invalidateLeaderboard } from './leaderboard.service.js';
import { findInstrument, getInstruments } from './market.service.js';

/**
 * Paying money OUT.
 *
 * The deposit service is the model for the shape of this — a first-class row
 * with a data-driven state machine, one `transition()` carrying the expected
 * state in the update filter, and a reference that is the permanent handle. The
 * differences are in `models/Withdrawal.js`, and the one that drives most of
 * this file is that the cash moves at REQUEST time rather than at approval.
 *
 * WHAT THIS DOES NOT DO. Nothing here sends anything. `approveWithdrawal`
 * records that an operator sent funds by hand and what hash they got back;
 * there is no wallet, no signing key and no chain client anywhere in this
 * repository. `WITHDRAWALS_ENABLED` defaults to false because a payout screen
 * that works perfectly against a treasury that does not exist is worse than no
 * payout screen at all.
 */

const ASSET_NAME = {
  USDT: 'Tether',
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  BNB: 'BNB',
};

const CHAIN_TOKEN = {
  TRC20: 'TRX',
  ERC20: 'ETH',
  BEP20: 'BNB',
  BITCOIN: 'BTC',
  SPL: 'SOL',
  SOLANA: 'SOL',
  DOGECOIN: 'DOGE',
  ETHEREUM: 'ETH',
};

const NETWORK_LABEL = {
  TRC20: 'Tron (TRC20)',
  ERC20: 'Ethereum (ERC20)',
  BEP20: 'BNB Smart Chain (BEP20)',
  BITCOIN: 'Bitcoin',
  SPL: 'Solana (SPL)',
  SOLANA: 'Solana',
  DOGECOIN: 'Dogecoin',
  ETHEREUM: 'Ethereum',
};

/**
 * The chains this deployment can pay out on.
 *
 * DERIVED FROM THE DEPOSIT DESTINATIONS, which is a real coupling rather than a
 * shortcut: if we can receive USDT on TRC20 then we hold USDT on TRC20 and can
 * send it back, and if we cannot receive an asset we have none of it to send.
 * One list also means the two screens can never disagree about which networks
 * exist. What is NOT carried over is the address — a payout goes to the user's
 * wallet, and ours has no business being on this screen.
 */
/**
 * The {asset, network} pairs payouts are offered on.
 *
 * `WITHDRAWAL_NETWORKS` when set, otherwise derived from the deposit
 * destinations — which keeps the old behaviour for any deployment that has not
 * configured payouts separately, and is a sensible default besides: if we can
 * receive on a chain we hold funds there.
 *
 * The DESTINATION ADDRESS IS STRIPPED either way. Ours is a receiving address
 * and has no business on a payout screen; a test asserts it never appears.
 */
export function payoutNetworks() {
  return WITHDRAWAL_NETWORKS.length ? WITHDRAWAL_NETWORKS : DEPOSIT_DESTINATIONS;
}

export async function withdrawalMethods() {
  const groups = new Map();

  for (const d of payoutNetworks()) {
    const group = (d.assetGroup ?? d.asset).toUpperCase();
    if (!groups.has(group)) {
      groups.set(group, { symbol: group, name: ASSET_NAME[group] ?? group, networks: [] });
    }
    groups.get(group).networks.push({
      asset: d.asset,
      network: d.network,
      chainToken: CHAIN_TOKEN[d.network] ?? '',
      label: d.label ?? NETWORK_LABEL[d.network] ?? d.network,
      differsFromGroup: d.asset.toUpperCase() !== group,
      note: d.note ?? '',
      // The format rule travels with the network, so the screen can say what a
      // valid address looks like BEFORE one is pasted rather than refusing
      // afterwards. The server still checks — this is guidance, not the guard.
      addressHint: addressHint(d.network),
    });
  }

  try {
    const { items } = await getInstruments({ assetClass: 'crypto', limit: 250 });
    const bySymbol = new Map(items.map((i) => [i.symbol.toUpperCase(), i]));
    for (const g of groups.values()) {
      g.logoUrl = bySymbol.get(g.symbol)?.logoUrl ?? '';
      for (const n of g.networks) n.logoUrl = bySymbol.get(n.chainToken)?.logoUrl ?? '';
    }
  } catch {
    for (const g of groups.values()) {
      g.logoUrl = '';
      for (const n of g.networks) n.logoUrl = '';
    }
  }

  return {
    crypto: {
      /**
       * Two independent reasons this can be false, and the screen says which:
       * the operator has not enabled payouts, or no chain is configured to pay
       * out on. Collapsing them into one "unavailable" leaves whoever has to
       * fix it guessing.
       */
      available: env.WITHDRAWALS_ENABLED && payoutNetworks().length > 0,
      enabled: env.WITHDRAWALS_ENABLED,
      assets: [...groups.values()],
    },
    minAmountCents: MIN_WITHDRAWAL_CENTS,
    maxAmountCents: MAX_WITHDRAWAL_CENTS,
    supportEmail: env.SUPPORT_EMAIL,
  };
}

/**
 * THE ADDRESS IS THE ONE MISTAKE NOBODY CAN UNDO, so it is checked against the
 * chain's actual format rather than for a plausible length.
 *
 * This started as `length >= 16`, which accepts `gdghsdhjsdhdjsdksjdhdjsjdujdu`
 * — observed in testing, on a live $3,937 payout request. A reviewer looking at
 * that row sees a string they have no way to validate by eye either, and if it
 * is approved the funds are irrecoverable. Length is not a check.
 *
 * These are FORMAT checks, not existence checks — no amount of regex proves an
 * address is reachable or that it belongs to the person asking. What they do
 * catch is the whole class of typos, truncations and wrong-chain pastes, which
 * is what actually goes wrong: an ERC20 address pasted into a Tron withdrawal
 * is a real mistake with a real cost, and `0x…` against `T…` is unambiguous.
 *
 * Base58 alphabets deliberately exclude 0/O/I/l — the characters people confuse
 * when copying by hand — so a transposition tends to fail the pattern rather
 * than silently address a different wallet.
 */
/**
 * EVERY EVM CHAIN SHARES ONE ADDRESS FORMAT, so it is defined once. The three
 * hand-copied `0x` rules this replaces were identical apart from the hint, and
 * a rule duplicated per chain is a rule that drifts the moment one is edited.
 *
 * The chain name goes in the hint because that is the sentence somebody reads
 * when their paste is rejected: "an Ethereum address" is unhelpful when they
 * are trying to withdraw on Polygon.
 */
const evm = (chain) => ({
  test: (a) => /^0x[a-fA-F0-9]{40}$/.test(a),
  hint: `A ${chain} address starts with 0x and is 42 characters.`,
});

const ADDRESS_RULES = {
  BITCOIN: {
    // P2PKH/P2SH base58, or bech32 (including the longer taproot forms).
    test: (a) => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/.test(a),
    hint: 'A Bitcoin address starts with 1, 3 or bc1.',
  },
  LITECOIN: {
    test: (a) => /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{25,39})$/.test(a),
    hint: 'A Litecoin address starts with L, M or ltc1.',
  },
  DOGECOIN: {
    test: (a) => /^[DA9][1-9A-HJ-NP-Za-km-z]{25,39}$/.test(a),
    hint: 'A Dogecoin address starts with D, A or 9.',
  },
  TRC20: {
    test: (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a),
    hint: 'A Tron address starts with T and is 34 characters.',
  },
  SPL: {
    test: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
    hint: 'A Solana address is 32–44 base58 characters.',
  },
  SOLANA: {
    test: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
    hint: 'A Solana address is 32–44 base58 characters.',
  },

  /**
   * The EVM family. They are listed separately rather than collapsed to one
   * entry because `network` is what the user PICKS and what the operator reads
   * on the payout — sending Polygon USDC to an address the user meant for
   * Arbitrum is a real loss, and the label is the only thing that distinguishes
   * them. The format check cannot tell them apart; the name is what carries it.
   */
  ETHEREUM: evm('Ethereum'),
  ERC20: evm('Ethereum'),
  BEP20: evm('BNB Smart Chain'),
  POLYGON: evm('Polygon'),
  ARBITRUM: evm('Arbitrum'),
  OPTIMISM: evm('Optimism'),
  BASE: evm('Base'),
  AVALANCHE: evm('Avalanche C-Chain'),
};
/** Returns a problem string, or null when the address is well-formed. */
export function checkAddress(address, network) {
  if (!address) return 'Enter the wallet address to send to';

  const rule = ADDRESS_RULES[String(network).toUpperCase()];
  if (!rule) {
    // An unknown network gets the weak check rather than a free pass. Adding a
    // chain to config without a rule here should be inconvenient, not silent.
    return address.length >= 16 && address.length <= 200
      ? null
      : 'That does not look like a wallet address';
  }

  return rule.test(address) ? null : `That is not a valid address for this network. ${rule.hint}`;
}

/** What the screen shows under the address field, before anything is typed. */
export const addressHint = (network) => ADDRESS_RULES[String(network).toUpperCase()]?.hint ?? '';

/**
 * `WDR-2026-8F92K1`. Same Crockford-ish alphabet as a deposit reference — no
 * I/L/O/U, so it survives being read aloud and typed back — and a different
 * prefix, so an operator never has to guess which queue a code belongs to.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function makeReference(year) {
  const bytes = crypto.randomBytes(6);
  let body = '';
  for (let i = 0; i < 6; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return `WDR-${year}-${body}`;
}

/**
 * The one place a withdrawal changes state.
 *
 * The expected current status is IN THE UPDATE FILTER, so a double-clicked
 * Approve — or two operators on the same queue row — matches no document rather
 * than moving the row twice. On a payout that is the difference between one
 * transfer and two.
 */
async function transition(id, from, to, { by = null, note = '', set = {}, session = null } = {}) {
  const allowed = WITHDRAWAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.unprocessable('BAD_TRANSITION', `A withdrawal cannot go from ${from} to ${to}`);
  }

  const updated = await Withdrawal.findOneAndUpdate(
    { _id: id, status: from },
    {
      $set: { status: to, ...set },
      $push: { history: { from, to, at: new Date(), by, note } },
    },
    { new: true, session },
  );

  if (!updated) {
    const current = await Withdrawal.findById(id).lean();
    throw ApiError.conflict(
      'STALE_STATE',
      current ? `That withdrawal is already ${current.status}` : 'No such withdrawal',
    );
  }

  return updated;
}

/* --------------------------------------------------------------- creating */

/**
 * @param {{ userId: any, asset: string, network: string, address: string,
 *   amountCents: number, contactEmail?: string, idempotencyKey?: string }} input
 */
export async function createWithdrawal(input) {
  if (!env.WITHDRAWALS_ENABLED) {
    throw ApiError.unprocessable(
      'WITHDRAWALS_DISABLED',
      'Withdrawals are not enabled on this deployment',
    );
  }

  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < MIN_WITHDRAWAL_CENTS) {
    throw ApiError.badRequest(
      'BAD_AMOUNT',
      `The minimum withdrawal is ${usdFromCents(MIN_WITHDRAWAL_CENTS)}`,
    );
  }
  if (amountCents > MAX_WITHDRAWAL_CENTS) {
    throw ApiError.badRequest(
      'AMOUNT_TOO_LARGE',
      `The most that can be withdrawn at once is ${usdFromCents(MAX_WITHDRAWAL_CENTS)}`,
    );
  }

  const asset = String(input.asset ?? '').toUpperCase();
  const network = String(input.network ?? '').toUpperCase();

  // `payoutNetworks()`, NOT the deposit list — otherwise a chain configured in
  // WITHDRAWAL_NETWORKS is offered by the picker and then refused here with
  // NO_NETWORK, which reads to the user as the product breaking rather than as
  // a config mismatch.
  const destination = payoutNetworks().find(
    (d) => d.asset.toUpperCase() === asset && d.network.toUpperCase() === network,
  );
  if (!destination) {
    throw ApiError.unprocessable(
      'NO_NETWORK',
      `${asset} on ${network} is not a supported withdrawal network`,
    );
  }

  const address = String(input.address ?? '').trim();
  const addressProblem = checkAddress(address, network);
  if (addressProblem) throw ApiError.badRequest('BAD_ADDRESS', addressProblem);

  /**
   * THE QUEUE IS CAPPED PER USER. Each open payout is holding cash, so an
   * uncapped queue lets one account tie up its whole balance in requests
   * nobody has looked at — and gives a reviewer a list that only grows.
   */
  const open = await Withdrawal.countDocuments({
    userId: input.userId,
    status: { $in: [WITHDRAWAL_STATUS.REQUESTED, WITHDRAWAL_STATUS.UNDER_REVIEW] },
  });
  if (open >= env.MAX_OPEN_WITHDRAWALS) {
    throw ApiError.unprocessable(
      'TOO_MANY_PENDING',
      `You already have ${open} withdrawals awaiting review`,
    );
  }

  const quote = await priceAsset(asset, destination);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const reference = makeReference(new Date().getUTCFullYear());

      /**
       * THE ROW IS WRITTEN AND THE CASH IS HELD IN ONE TRANSACTION.
       *
       * Insert-first idempotency, as everywhere else that moves money: a
       * double-tapped Submit collides on the unique partial index over
       * `idempotencyKey` before `post()` is reached. And `post()`'s own
       * overdraw guard lives in the update filter, so "you cannot withdraw more
       * than you hold" is one atomic operation rather than a read followed by a
       * hopeful write — two concurrent withdrawals cannot both pass a balance
       * check and both debit.
       */
      const result = await withTransaction(async (session) => {
        const [created] = await Withdrawal.create(
          [
            {
              userId: input.userId,
              reference,
              method: 'crypto',
              asset,
              network,
              destinationAddress: address,
              networkNote: destination.note ?? '',
              amountCents,
              assetAmount: toAssetAmount(amountCents, quote.rateUsdNanos, quote.decimals),
              assetDecimals: quote.decimals,
              rateUsdNanos: quote.rateUsdNanos,
              quotedAt: new Date(),
              ...(input.contactEmail && { contactEmail: input.contactEmail }),
              status: WITHDRAWAL_STATUS.REQUESTED,
              history: [{ from: null, to: WITHDRAWAL_STATUS.REQUESTED, at: new Date() }],
              ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
            },
          ],
          { session },
        );

        const { balanceAfterCents } = await post({
          userId: input.userId,
          type: LEDGER_TYPE.WITHDRAWAL,
          // NEGATIVE: this is the debit, not a record of an intention to debit.
          amountCents: -amountCents,
          reference,
          detail: `${asset} withdrawal ${usdFromCents(amountCents)}`,
          session,
        });

        await Transaction.create(
          [
            {
              userId: input.userId,
              type: 'Withdrawal',
              detail: `Withdrawal ${reference} — ${usdFromCents(amountCents)} ${asset}`,
              amountCents: -amountCents,
              status: 'Pending',
              relatedWithdrawalId: created._id,
            },
          ],
          { session },
        );

        return { withdrawal: publicWithdrawal(created.toObject()), balanceAfterCents };
      });

      // Cash is part of portfolio value, so the board is stale the moment the
      // hold lands — the same reason a fill invalidates it.
      invalidateLeaderboard();
      return { ...result, replayed: false };
    } catch (err) {
      if (err?.code === 11000 && input.idempotencyKey) {
        const existing = await Withdrawal.findOne({
          idempotencyKey: input.idempotencyKey,
        }).lean();
        if (existing) {
          const user = await User.findById(input.userId).lean();
          return {
            withdrawal: publicWithdrawal(existing),
            balanceAfterCents: user?.cashBalanceCents ?? 0,
            replayed: true,
          };
        }
      }
      if (err?.code === 11000 && /reference/.test(err?.message ?? '')) continue;
      throw err;
    }
  }

  throw ApiError.unavailable('REFERENCE_EXHAUSTED', 'Could not allocate a withdrawal reference');
}

/**
 * The USD price of one unit of the payout asset, from the same market cache the
 * rest of the product reads — so a payout quote cannot disagree with the price
 * on the Markets table.
 *
 * An asset that cannot be priced is REFUSED rather than quoted at a guess:
 * sending an amount computed from an unknown rate is how a payout and a debit
 * end up disagreeing, and here the disagreement is real money out of the door.
 */
async function priceAsset(asset, destination) {
  // `priceSymbol` for the same reason as a deposit: BTCB is not BTC, is not in
  // CoinGecko's top 50, and is pegged 1:1 to the asset it tracks.
  const symbol = (destination.priceSymbol ?? asset).toUpperCase();
  const row = await findInstrument('crypto', symbol);
  const rateUsdNanos = row?.priceUsdNanos;

  if (!Number.isFinite(rateUsdNanos) || rateUsdNanos <= 0) {
    throw ApiError.unavailable(
      'NO_RATE',
      `No usable ${symbol} price right now — try again in a moment`,
    );
  }

  return { rateUsdNanos, decimals: destination.decimals ?? 8 };
}

/**
 * Cents ÷ (cents per unit), rounded DOWN at the asset's own precision.
 *
 * The opposite of a deposit, and deliberately: rounding up would send a
 * fraction more than the account was debited, which the ledger would then
 * disagree with. Both round in the house's favour by less than one unit of the
 * asset's smallest denomination, because in each case the alternative is a
 * mismatch somebody has to reconcile by hand.
 */
function toAssetAmount(amountCents, rateUsdNanos, decimals) {
  const centsPerUnit = rateUsdNanos / 10_000_000;
  const scale = 10 ** decimals;
  return Math.floor((amountCents / centsPerUnit) * scale) / scale;
}

/* ---------------------------------------------------------------- reading */

export async function getWithdrawal({ userId = null, reference, admin = false }) {
  const filter = admin
    ? { reference: String(reference).toUpperCase() }
    : { reference: String(reference).toUpperCase(), userId };

  const row = await Withdrawal.findOne(filter).lean();
  if (!row) throw ApiError.notFound('No such withdrawal');
  return publicWithdrawal(row);
}

export async function listWithdrawals({
  userId = null,
  status = null,
  limit = 50,
  admin = false,
} = {}) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (status) filter.status = status;

  const query = Withdrawal.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, limit)));
  // An operator about to send funds needs to know whose payout it is; the
  // person reading their own list already does.
  if (admin) query.populate('userId', TRADER_FIELDS);

  const rows = await query.lean();

  return rows.map((r) => ({
    ...publicWithdrawal(r),
    ...(admin && { trader: traderOf(r.userId) }),
  }));
}

/* ------------------------------------------------------ moving it forward */

/**
 * HANDING THE HOLD BACK, and the only path that does.
 *
 * Both terminal states that do not pay out come through here, so there is
 * exactly one implementation of "give the money back" rather than one per
 * caller. `reversedAt` is set in the same update, and the ledger's unique
 * {type, reference} index is the independent second guard: a reversal that
 * somehow ran twice collides on the index and, inside the transaction, aborts
 * the balance change with it.
 */
async function reverseHold({ withdrawal, to, adminId = null, note = '' }) {
  if (!REVERSING_STATUSES.includes(to)) {
    throw new Error(`withdrawal: ${to} does not reverse a hold`);
  }

  const result = await withTransaction(async (session) => {
    const moved = await transition(withdrawal._id, withdrawal.status, to, {
      by: adminId,
      note,
      set: {
        reversedAt: new Date(),
        ...(to === WITHDRAWAL_STATUS.REJECTED && {
          reviewedBy: adminId,
          reviewedAt: new Date(),
          rejectionReason: String(note).slice(0, 280),
        }),
      },
      session,
    });

    const { balanceAfterCents } = await post({
      userId: withdrawal.userId,
      type: LEDGER_TYPE.WITHDRAWAL_REVERSAL,
      amountCents: withdrawal.amountCents,
      reference: withdrawal.reference,
      detail: `${withdrawal.asset} withdrawal ${to} — ${usdFromCents(withdrawal.amountCents)} returned`,
      session,
    });

    await Transaction.updateOne(
      { relatedWithdrawalId: withdrawal._id },
      { $set: { status: to === WITHDRAWAL_STATUS.REJECTED ? 'Declined' : 'Cancelled' } },
      { session },
    );

    return { withdrawal: publicWithdrawal(moved.toObject()), balanceAfterCents };
  });

  invalidateLeaderboard();
  return { ...result, returned: true };
}

/** The user changing their mind, which is only theirs to do before review. */
export async function cancelWithdrawal({ userId, reference }) {
  const row = await Withdrawal.findOne({
    reference: String(reference).toUpperCase(),
    userId,
  }).lean();
  if (!row) throw ApiError.notFound('No such withdrawal');

  if (row.status !== WITHDRAWAL_STATUS.REQUESTED) {
    throw ApiError.conflict(
      'STALE_STATE',
      row.status === WITHDRAWAL_STATUS.UNDER_REVIEW
        ? 'That withdrawal is already being reviewed — contact support to stop it'
        : `That withdrawal is ${row.status}`,
    );
  }

  return reverseHold({ withdrawal: row, to: WITHDRAWAL_STATUS.CANCELLED, note: 'cancelled by user' });
}

/* ----------------------------------------------------------------- admin */

/**
 * CLAIMING ONE, which exists so two operators cannot both send the funds.
 *
 * The compare-and-set on `requested → under_review` is the whole mechanism: the
 * second operator to click matches no document and is told the row is already
 * being reviewed. Nothing but `under_review` can reach `approved`, so a payout
 * is always claimed before it is confirmed sent.
 */
export async function claimWithdrawal({ reference, adminId }) {
  const row = await Withdrawal.findOne({ reference: String(reference).toUpperCase() }).lean();
  if (!row) throw ApiError.notFound('No such withdrawal');

  const moved = await transition(row._id, row.status, WITHDRAWAL_STATUS.UNDER_REVIEW, {
    by: adminId,
    note: 'claimed for review',
    set: { reviewedBy: adminId, reviewedAt: new Date() },
  });

  return { withdrawal: publicWithdrawal(moved.toObject()) };
}

/**
 * CONFIRMING THE FUNDS WERE SENT. It moves no money.
 *
 * The debit happened when the withdrawal was requested — this records that an
 * operator has now actually sent the asset, and what hash came back. That
 * ordering is what makes a double approval harmless: there is nothing left to
 * debit, so the worst case is a status conflict rather than a second transfer.
 *
 * `txHash` is required. An approved payout with no evidence of a transfer is a
 * row asserting money left the building with nothing to check it against.
 */
export async function approveWithdrawal({ reference, adminId, txHash, note = '' }) {
  const hash = String(txHash ?? '').trim();
  if (hash.length < 10) {
    throw ApiError.badRequest(
      'BAD_TX_HASH',
      'Record the transaction hash of the payment that was sent',
    );
  }

  const row = await Withdrawal.findOne({ reference: String(reference).toUpperCase() }).lean();
  if (!row) throw ApiError.notFound('No such withdrawal');

  const moved = await transition(row._id, row.status, WITHDRAWAL_STATUS.APPROVED, {
    by: adminId,
    note: note || 'sent',
    set: {
      txHash: hash,
      reviewedBy: adminId,
      reviewedAt: row.reviewedAt ?? new Date(),
      completedAt: new Date(),
    },
  });

  await Transaction.updateOne({ relatedWithdrawalId: row._id }, { $set: { status: 'Approved' } });

  return { withdrawal: publicWithdrawal(moved.toObject()), sent: true };
}

/** Refusing one. Hands the hold back — the money never left. */
export async function rejectWithdrawal({ reference, adminId, reason = '' }) {
  const row = await Withdrawal.findOne({ reference: String(reference).toUpperCase() }).lean();
  if (!row) throw ApiError.notFound('No such withdrawal');

  if (row.status !== WITHDRAWAL_STATUS.UNDER_REVIEW) {
    throw ApiError.conflict(
      'STALE_STATE',
      `That withdrawal is ${row.status} and cannot be rejected`,
    );
  }

  return reverseHold({
    withdrawal: row,
    to: WITHDRAWAL_STATUS.REJECTED,
    adminId,
    note: reason,
  });
}

/* ------------------------------------------------------------- projection */

/** What a client is allowed to see. The user's own address is theirs already. */
function publicWithdrawal(w) {
  return {
    id: String(w._id),
    reference: w.reference,
    status: w.status,
    method: w.method,
    asset: w.asset,
    network: w.network,
    destinationAddress: w.destinationAddress,
    networkNote: w.networkNote ?? '',
    amountCents: w.amountCents,
    assetAmount: w.assetAmount,
    assetDecimals: w.assetDecimals,
    rateUsdNanos: w.rateUsdNanos,
    quotedAt: w.quotedAt,
    contactEmail: w.contactEmail ?? '',
    txHash: w.txHash ?? '',
    rejectionReason: w.rejectionReason ?? '',
    history: (w.history ?? []).map((h) => ({ to: h.to, at: h.at, note: h.note ?? '' })),
    createdAt: w.createdAt,
    reviewedAt: w.reviewedAt,
    completedAt: w.completedAt,
  };
}
