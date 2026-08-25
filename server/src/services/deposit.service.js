import crypto from 'node:crypto';
import { DEPOSIT_DESTINATIONS, env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { ApiError } from '../lib/ApiError.js';
import { usdFromCents } from '../lib/money.js';
import { Deposit, DEPOSIT_STATUS, DEPOSIT_TRANSITIONS, isTerminal } from '../models/Deposit.js';
import { LEDGER_TYPE } from '../models/LedgerEntry.js';
import { Transaction } from '../models/Transaction.js';
import { post } from './ledger.service.js';
import { findInstrument, getInstruments } from './market.service.js';
import { invalidateLeaderboard } from './leaderboard.service.js';
import { traderOf, TRADER_FIELDS } from './adminQueue.service.js';

/**
 * Deposits: create → await payment → user claims it → review → approve → post.
 *
 * NOTHING HERE CREDITS AN ACCOUNT EXCEPT `approve`, and it is the only function
 * that touches the ledger. "The user pressed I've sent the funds" is a claim,
 * not a payment, and treating it as one is the single most expensive mistake
 * available in this file.
 *
 * THE STATE MACHINE IS DATA, in models/Deposit.js, and every move goes through
 * `transition()` below. That matters because the guard is the same one the
 * order ledger uses: the update FILTER carries the expected current status, so
 * a double-clicked Approve matches no document rather than crediting twice.
 * There is no read-then-check window anywhere in this file.
 */

/** Display names, so the picker reads as a person would say it. */
const ASSET_NAME = {
  USDT: 'Tether', BTC: 'Bitcoin', BTCB: 'Bitcoin (BTCB)', ETH: 'Ethereum',
  SOL: 'Solana', DOGE: 'Dogecoin', BNB: 'BNB',
};

/**
 * The native token of each chain, used only to give a NETWORK a real logo.
 *
 * A network is not an asset and has no price here, but every chain in this list
 * has a token whose mark IS the chain's mark — Tron's is TRX, BNB Smart Chain's
 * is BNB. Borrowing it means the network rows carry the same real artwork the
 * asset rows do instead of grey initials, without inventing a glyph for a
 * trademark.
 */
const CHAIN_TOKEN = {
  TRC20: 'TRX',
  ERC20: 'ETH',
  ETHEREUM: 'ETH',
  BEP20: 'BNB',
  SPL: 'SOL',
  SOLANA: 'SOL',
  BITCOIN: 'BTC',
  DOGECOIN: 'DOGE',
};

const NETWORK_LABEL = {
  TRC20: 'TRC20 · Tron',
  ERC20: 'ERC20 · Ethereum',
  BEP20: 'BEP20 · BNB Smart Chain',
  SPL: 'SPL · Solana',
  BITCOIN: 'Bitcoin',
  ETHEREUM: 'Ethereum',
  SOLANA: 'Solana',
  DOGECOIN: 'Dogecoin',
};

/**
 * Sent to the client so the picker renders what is actually configured.
 *
 * GROUPED BY THE ASSET A PERSON THINKS THEY ARE SENDING, which is not always
 * the asset that arrives. Choosing "Bitcoin" should offer both the Bitcoin
 * network and BEP20 — but on BEP20 the thing that actually moves is BTCB, a
 * different token. `assetGroup` lets one choice span both while every
 * destination keeps its own real ticker, decimals and warning, so nothing
 * downstream has to pretend BTCB is BTC.
 */
export async function depositMethods() {
  const groups = new Map();

  for (const d of DEPOSIT_DESTINATIONS) {
    const group = (d.assetGroup ?? d.asset).toUpperCase();
    if (!groups.has(group)) {
      groups.set(group, { symbol: group, name: ASSET_NAME[group] ?? group, networks: [] });
    }
    groups.get(group).networks.push({
      asset: d.asset,
      network: d.network,
      chainToken: CHAIN_TOKEN[d.network] ?? '',
      label: d.label ?? NETWORK_LABEL[d.network] ?? d.network,
      // Surfaced so the picker can say "you will be sending BTCB" before the
      // user commits to a network, rather than after.
      differsFromGroup: d.asset.toUpperCase() !== group,
      minAmountCents: Math.round((d.minAmount ?? 0) * 100),
      note: d.note ?? '',
    });
  }

  /**
   * Coin logos, off the market cache that is already loaded for the tables.
   *
   * Best-effort and non-blocking-on-failure: a picker without icons is a
   * picker, a picker that 500s because a vendor is slow is not. Falls back to
   * the ticker rendered as a monogram on the client.
   */
  try {
    const { items } = await getInstruments({ assetClass: 'crypto', limit: 250 });
    const bySymbol = new Map(items.map((i) => [i.symbol.toUpperCase(), i]));
    for (const g of groups.values()) {
      g.logoUrl = bySymbol.get(g.symbol)?.logoUrl ?? '';
      for (const n of g.networks) {
        n.logoUrl = bySymbol.get(n.chainToken)?.logoUrl ?? '';
      }
    }
  } catch {
    for (const g of groups.values()) {
      g.logoUrl = '';
      for (const n of g.networks) n.logoUrl = '';
    }
  }

  return {
    crypto: {
      available: DEPOSIT_DESTINATIONS.length > 0,
      // Config order is intentional order — it is how the list is presented.
      assets: [...groups.values()],
    },
    ttlMinutes: env.DEPOSIT_TTL_MINUTES,
    minConfirmations: env.DEPOSIT_MIN_CONFIRMATIONS,
    /** Where a user goes when the amount they sent does not match the quote. */
    supportEmail: env.SUPPORT_EMAIL,
  };
}

/**
 * `DEP-2026-8F92K1`. Crockford-ish base32 over random bytes — no I/L/O/U, so it
 * survives being read aloud, written down and typed back in, which is what a
 * payment reference has to do.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function makeReference(year) {
  const bytes = crypto.randomBytes(6);
  let body = '';
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `DEP-${year}-${body}`;
}

const publicDeposit = (d) => ({
  id: String(d._id),
  reference: d.reference,
  method: d.method,
  asset: d.asset,
  network: d.network,
  destinationAddress: d.destinationAddress,
  networkNote: d.networkNote ?? '',
  amountCents: d.amountCents,
  assetAmount: d.assetAmount ?? null,
  assetDecimals: d.assetDecimals ?? 8,
  rateUsdNanos: d.rateUsdNanos ?? null,
  quotedAt: d.quotedAt ?? null,
  contactEmail: d.contactEmail ?? '',
  txHash: d.txHash ?? null,
  confirmations: d.confirmations ?? 0,
  status: d.status,
  expiresAt: d.expiresAt ?? null,
  detectedAt: d.detectedAt ?? null,
  reviewedAt: d.reviewedAt ?? null,
  completedAt: d.completedAt ?? null,
  rejectionReason: d.rejectionReason ?? '',
  createdAt: d.createdAt,
  history: (d.history ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at, note: h.note })),
});

/**
 * The ONLY way a deposit changes state.
 *
 * `from` is carried in the filter, so this is a compare-and-set: whoever loses
 * a race matches nothing and gets a conflict, which is how approving twice is
 * made impossible rather than merely unlikely. Callers never write `status`
 * directly.
 */
/**
 * @param {any} id
 * @param {string} from
 * @param {string} to
 * @param {{ by?: any, note?: string, set?: Record<string, any>,
 *   session?: import('mongoose').ClientSession | null }} [opts]
 */
async function transition(id, from, to, { by = null, note = '', set = {}, session = null } = {}) {
  const allowed = DEPOSIT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.unprocessable('BAD_TRANSITION', `A deposit cannot go from ${from} to ${to}`);
  }

  const updated = await Deposit.findOneAndUpdate(
    { _id: id, status: from },
    {
      $set: { status: to, ...set },
      $push: { history: { from, to, at: new Date(), by, note } },
    },
    { new: true, session },
  );

  if (!updated) {
    // Either it never existed or somebody else moved it first. Both are the
    // same answer to the caller: your view of this deposit is stale.
    const current = await Deposit.findById(id).lean();
    throw ApiError.conflict(
      'STALE_STATE',
      current
        ? `That deposit is already ${current.status}`
        : 'No such deposit',
    );
  }

  return updated;
}

/* --------------------------------------------------------------- creating */

/**
 * @param {{ userId: any, method?: string, asset: string, network: string,
 *   amountCents: number, idempotencyKey?: string }} input
 */
export async function createDeposit(input) {
  const method = String(input.method ?? 'crypto').toLowerCase();
  if (method !== 'crypto') {
    throw ApiError.badRequest('UNSUPPORTED_METHOD', 'Only crypto deposits are configured');
  }

  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 100) {
    throw ApiError.badRequest('BAD_AMOUNT', 'Enter an amount of at least $1.00');
  }

  const asset = String(input.asset ?? '').toUpperCase();
  const network = String(input.network ?? '').toUpperCase();

  /**
   * NO DESTINATION, NO DEPOSIT. If nobody has configured where funds should go,
   * the correct behaviour is to refuse — not to invent an address, and not to
   * show a screen that asks for money with a blank in it.
   */
  const destination = DEPOSIT_DESTINATIONS.find(
    (d) => d.asset.toUpperCase() === asset && d.network.toUpperCase() === network,
  );
  if (!destination) {
    throw ApiError.unprocessable(
      'NO_DESTINATION',
      DEPOSIT_DESTINATIONS.length === 0
        ? 'Crypto deposits are not configured on this deployment'
        : `${asset} on ${network} is not a supported destination`,
    );
  }

  const minCents = Math.round((destination.minAmount ?? 0) * 100);
  if (minCents > 0 && amountCents < minCents) {
    throw ApiError.badRequest(
      'BELOW_MINIMUM',
      `The minimum ${asset} deposit is ${usdFromCents(minCents)}`,
    );
  }

  /**
   * PRICE THE ASSET AND LOCK THE QUOTE.
   *
   * Rounded UP at the asset's own precision: rounding down would leave the
   * deposit a few cents short of what was asked for, which is an underpayment
   * the reviewer then has to chase for the sake of a rounding decision made
   * here. Erring by a fraction of a unit in the depositor's favour costs
   * nothing and keeps every approved deposit whole.
   */
  const quote = await priceAsset(asset, destination);
  const expiresAt = new Date(Date.now() + env.DEPOSIT_TTL_MINUTES * 60_000);

  // Created and moved to awaiting_payment in one call, because a deposit that
  // exists but has never been quotable is not a state anything needs to see.
  // Reference collisions are astronomically unlikely but cheap to retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await Deposit.create({
        userId: input.userId,
        reference: makeReference(new Date(expiresAt).getUTCFullYear()),
        method,
        asset,
        network,
        destinationAddress: destination.address,
        // Stored, not looked up at read time: a note is a warning about what
        // was sent, so rotating the config must not rewrite it on old rows.
        networkNote: destination.note ?? '',
        amountCents,
        assetAmount: toAssetAmount(amountCents, quote.rateUsdNanos, quote.decimals),
        assetDecimals: quote.decimals,
        rateUsdNanos: quote.rateUsdNanos,
        quotedAt: new Date(),
        status: DEPOSIT_STATUS.CREATED,
        expiresAt,
        history: [{ from: null, to: DEPOSIT_STATUS.CREATED, at: new Date() }],
        ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
      });

      const ready = await transition(
        created._id,
        DEPOSIT_STATUS.CREATED,
        DEPOSIT_STATUS.AWAITING_PAYMENT,
      );
      return { deposit: publicDeposit(ready.toObject()), replayed: false };
    } catch (err) {
      if (err?.code === 11000 && input.idempotencyKey) {
        const existing = await Deposit.findOne({ idempotencyKey: input.idempotencyKey }).lean();
        if (existing) return { deposit: publicDeposit(existing), replayed: true };
      }
      // A duplicate reference is the only other collision worth retrying.
      if (err?.code === 11000 && /reference/.test(err?.message ?? '')) continue;
      throw err;
    }
  }

  // Five collisions on a 6-byte random reference is not bad luck, it is a
  // broken generator or a broken index — either way the caller should retry
  // later rather than be handed a deposit with no usable handle.
  throw ApiError.unavailable('REFERENCE_EXHAUSTED', 'Could not allocate a deposit reference');
}

/**
 * The USD price of one unit of the deposit asset, from the same market cache
 * everything else in the product reads.
 *
 * A stablecoin is NOT assumed to be exactly a dollar — USDT quotes at $0.999696
 * and pretending otherwise builds a systematic 0.03% error into every deposit,
 * always in the same direction. If the asset cannot be priced the deposit is
 * refused: quoting an amount to send without knowing what it is worth is how a
 * deposit and a credit end up disagreeing.
 */
async function priceAsset(asset, destination) {
  /**
   * `priceSymbol` exists because a WRAPPED asset is not the asset it tracks.
   *
   * BTCB — "BTC on BEP20" — is a BNB Smart Chain token backed by Binance's
   * reserve, and it is not in CoinGecko's top 50, so pricing it by its own
   * ticker returns nothing and the deposit is refused. It is pegged 1:1 to
   * Bitcoin, so the honest fix is to say so in configuration rather than to
   * pretend the ticker is BTC: the deposit still records that BTCB is what was
   * asked for, while the quote is struck against the asset it tracks.
   */
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

/** Cents ÷ (cents per unit), rounded up at the asset's precision. */
function toAssetAmount(amountCents, rateUsdNanos, decimals) {
  const centsPerUnit = rateUsdNanos / 10_000_000;
  const scale = 10 ** decimals;
  return Math.ceil((amountCents / centsPerUnit) * scale) / scale;
}

/* ---------------------------------------------------------------- reading */

/**
 * @param {{ userId?: any, reference: string, admin?: boolean }} params
 */
export async function getDeposit({ userId = null, reference, admin = false }) {
  const filter = admin
    ? { reference: String(reference).toUpperCase() }
    : { userId, reference: String(reference).toUpperCase() };

  const found = await Deposit.findOne(filter).lean();
  if (!found) throw ApiError.notFound('No such deposit');
  return publicDeposit(expireIfDue(found));
}

export async function listDeposits({ userId = null, status = null, limit = 50, admin = false } = {}) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (status) filter.status = status;

  const query = Deposit.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, Math.max(1, limit)));
  // Only for the queue. A depositor reading their own list already knows whose
  // it is, and the join would be a round trip for a field nothing renders.
  if (admin) query.populate('userId', TRADER_FIELDS);

  const rows = await query.lean();

  return rows.map((r) => ({
    ...publicDeposit(expireIfDue(r)),
    ...(admin && { trader: traderOf(r.userId) }),
  }));
}

/**
 * Reports an unpaid, out-of-date deposit as expired without writing.
 *
 * The write happens on the next action against it. Reading must not mutate —
 * a listing endpoint that quietly rewrites rows is a listing endpoint that
 * cannot be called from a health check or a report.
 */
function expireIfDue(d) {
  const stale =
    d.status === DEPOSIT_STATUS.AWAITING_PAYMENT && d.expiresAt && d.expiresAt < new Date();
  return stale ? { ...d, status: DEPOSIT_STATUS.EXPIRED } : d;
}

/* ------------------------------------------------------- the user's claim */

/**
 * "I've sent the funds" — WHICH IS NOT A PAYMENT.
 *
 * It moves the deposit to `payment_detected` and records what the user says
 * they sent. Nothing is credited, nothing is verified, and the transaction hash
 * is taken at face value precisely because a human is going to check it. The
 * unique index on `txHash` is what stops the same on-chain payment being
 * claimed against two different deposits — each row would look perfectly
 * legitimate in the queue on its own.
 */
/**
 * @param {{ userId: any, reference: string, txHash: string, senderAddress?: string,
 *   contactEmail?: string }} params
 */
export async function submitProof({
  userId,
  reference,
  txHash,
  senderAddress = '',
  contactEmail = '',
}) {
  const hash = String(txHash ?? '').trim();
  if (hash.length < 10) {
    throw ApiError.badRequest('BAD_TX_HASH', 'Enter the transaction hash from your wallet');
  }

  const deposit = await Deposit.findOne({ userId, reference: String(reference).toUpperCase() });
  if (!deposit) throw ApiError.notFound('No such deposit');

  if (deposit.expiresAt && deposit.expiresAt < new Date() &&
      deposit.status === DEPOSIT_STATUS.AWAITING_PAYMENT) {
    await transition(deposit._id, DEPOSIT_STATUS.AWAITING_PAYMENT, DEPOSIT_STATUS.EXPIRED, {
      note: 'no payment claimed before expiry',
    });
    throw ApiError.unprocessable('EXPIRED', 'That deposit expired — start a new one');
  }

  try {
    const updated = await transition(
      deposit._id,
      DEPOSIT_STATUS.AWAITING_PAYMENT,
      DEPOSIT_STATUS.PAYMENT_DETECTED,
      {
        by: userId,
        note: 'claimed by user',
        set: {
          txHash: hash,
          senderAddress: String(senderAddress ?? '').trim(),
          ...(contactEmail && { contactEmail: String(contactEmail).trim().toLowerCase() }),
          detectedAt: new Date(),
        },
      },
    );

    // Straight into the queue. A separate confirmations gate belongs to the
    // chain monitor that is not built yet; until then a human is the check.
    const queued = await transition(
      updated._id,
      DEPOSIT_STATUS.PAYMENT_DETECTED,
      DEPOSIT_STATUS.UNDER_REVIEW,
      { note: 'awaiting manual verification' },
    );

    return { deposit: publicDeposit(queued.toObject()) };
  } catch (err) {
    if (err?.code === 11000) {
      throw ApiError.conflict(
        'TX_ALREADY_CLAIMED',
        'That transaction hash is already attached to another deposit',
      );
    }
    throw err;
  }
}

export async function cancelDeposit({ userId, reference }) {
  const deposit = await Deposit.findOne({ userId, reference: String(reference).toUpperCase() });
  if (!deposit) throw ApiError.notFound('No such deposit');
  if (isTerminal(deposit.status)) {
    throw ApiError.conflict('STALE_STATE', `That deposit is already ${deposit.status}`);
  }

  const updated = await transition(deposit._id, deposit.status, DEPOSIT_STATUS.CANCELLED, {
    by: userId,
    note: 'cancelled by user',
  });
  return { deposit: publicDeposit(updated.toObject()) };
}

/* ----------------------------------------------------------------- review */

/**
 * Approval — the one function that moves money, and the only one that posts.
 *
 * The status compare-and-set and the ledger post happen in ONE transaction, so
 * there is no window in which a deposit reads Approved without a corresponding
 * entry, or the reverse. The unique `{type, reference}` index on the ledger is
 * the second, independent guard: even if the status guard were somehow bypassed
 * the post itself would collide.
 */
export async function approveDeposit({ reference, adminId, note = '' }) {
  const ref = String(reference).toUpperCase();
  const deposit = await Deposit.findOne({ reference: ref }).lean();
  if (!deposit) throw ApiError.notFound('No such deposit');

  const result = await withTransaction(async (session) => {
    const approved = await transition(
      deposit._id,
      DEPOSIT_STATUS.UNDER_REVIEW,
      DEPOSIT_STATUS.APPROVED,
      {
        by: adminId,
        note: note || 'verified',
        set: { reviewedBy: adminId, reviewedAt: new Date(), completedAt: new Date() },
        session,
      },
    );

    const { balanceAfterCents } = await post({
      userId: deposit.userId,
      type: LEDGER_TYPE.DEPOSIT,
      amountCents: deposit.amountCents,
      // The deposit reference IS the ledger reference, so the two records point
      // at each other without a join table.
      reference: ref,
      detail: `${deposit.asset} deposit ${usdFromCents(deposit.amountCents)}`,
      session,
    });

    await Transaction.create(
      [
        {
          userId: deposit.userId,
          type: 'Top-up',
          detail: `Deposit ${ref} — ${usdFromCents(deposit.amountCents)} ${deposit.asset}`,
          amountCents: deposit.amountCents,
          status: 'Approved',
        },
      ],
      { session },
    );

    return { deposit: publicDeposit(approved.toObject()), balanceAfterCents };
  });

  // Cash is part of portfolio value, so the board is stale the moment this lands.
  invalidateLeaderboard();
  return { ...result, credited: true };
}

export async function rejectDeposit({ reference, adminId, reason = '' }) {
  const ref = String(reference).toUpperCase();
  const deposit = await Deposit.findOne({ reference: ref }).lean();
  if (!deposit) throw ApiError.notFound('No such deposit');

  const from = deposit.status;
  if (from !== DEPOSIT_STATUS.UNDER_REVIEW && from !== DEPOSIT_STATUS.PAYMENT_DETECTED) {
    throw ApiError.conflict('STALE_STATE', `That deposit is ${from} and cannot be rejected`);
  }

  // No ledger post: a rejection moves no money, so it has nothing to record
  // beyond the state change and the reason.
  const updated = await transition(deposit._id, from, DEPOSIT_STATUS.REJECTED, {
    by: adminId,
    note: reason,
    set: {
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: String(reason).slice(0, 280),
    },
  });

  return { deposit: publicDeposit(updated.toObject()), credited: false };
}
