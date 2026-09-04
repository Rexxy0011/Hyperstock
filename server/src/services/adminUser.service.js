import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Stock } from "../models/Stock.js";
import { ApiError } from "../lib/ApiError.js";
import {
  computedRowsFor,
  invalidateLeaderboard,
} from "./leaderboard.service.js";
import { getPortfolio } from "./portfolio.service.js";
import { post as ledgerPost } from "./ledger.service.js";
import { LEDGER_TYPE } from "../models/LedgerEntry.js";
import { withTransaction } from "../config/db.js";
import { Holding } from "../models/Holding.js";
import { WatchlistItem } from "../models/WatchlistItem.js";
import { getInstruments } from "./market.service.js";

/**
 * The user listing behind /admin/users.
 *
 * THE COLUMN THIS SCREEN EXISTS FOR IS `canSignIn`. Since Better Auth took over,
 * a credential is a row in `accounts`, not a field on the user — so "can this
 * person log in" stopped being visible anywhere. 209 user documents look
 * identical in the database and two of them hold a password. That distinction
 * is the difference between a real account and a leaderboard fixture, and
 * nothing in the product said which was which.
 *
 * It is computed by joining `accounts`, never stored. A stored flag needs a
 * writer on the signup path, the credential-migration path and the deletion
 * path, and one of the three would eventually be forgotten — the same reasoning
 * `subscriber.service.js` gives for computing `converted` on every read.
 */

const PAGE_SIZE = 25;

/** Escapes a user-supplied search string so it cannot act as a regex. */
const literal = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Exactly the fields an operator needs and nothing else.
 *
 * `passwordHash` is excluded by the schema's `select: false` and is not named
 * here either — belt and braces on the one field that must never travel. There
 * is no session token, no `accounts.password` and no unsubscribe token in this
 * shape: an admin listing needs to know that a credential EXISTS, never what it
 * is.
 */
const publicRow = (user, canSignIn, computed = null, override = null) => ({
  id: String(user._id),
  username: user.username,
  displayName: user.displayName ?? null,
  name: user.name ?? null,
  email: user.email,
  image: user.image ?? null,
  avatarUrl: user.image ?? null,
  role: user.role,
  status: user.status,
  cashBalanceCents: user.cashBalanceCents,
  tradeCount: user.tradeCount,
  emailVerified: Boolean(user.emailVerified),
  createdAt: user.createdAt,
  canSignIn,

  /**
   * WHAT THE BOARD WOULD SHOW FOR THIS ACCOUNT ON ITS OWN, so the edit form
   * opens on reality instead of an empty box. Null for anybody the board does
   * not rank — administrators, and any account the pipeline's `role: 'user'`
   * filter excludes.
   *
   * Deliberately the PRE-MERGE figures. An already-overridden trader must still
   * be editable against their real numbers, or each edit would compound on the
   * last and the original would become unrecoverable.
   */
  computed: computed
    ? {
        rank: computed.rank,
        portfolioValueCents: computed.portfolioValueCents,
        returnPct: computed.returnPct,
        trades: computed.trades,
        best: computed.best ?? null,
      }
    : null,

  /**
   * The curated row standing in for this account, if one exists.
   *
   * Present on the listing rather than fetched per row when a modal opens: the
   * table has to mark which traders are overridden BEFORE anybody clicks, or
   * the screen cannot answer the one question an operator has when they arrive
   * — which of these numbers are real.
   */
  override: override
    ? {
        id: String(override._id),
        portfolioValueCents: override.portfolioValueCents,
        changePct: override.changePct,
        trades: override.trades ?? 0,
        bestSymbol: override.bestSymbol || "",
        bestReturnPct: override.bestReturnPct ?? 0,
        avatarUrl: override.avatarUrl || "",
        active: override.active !== false,
        updatedAt: override.updatedAt,
      }
    : null,
});

/**
 * @param {{ q?: string, page?: number, limit?: number }} [options]
 */
export async function listUsers({ q = "", page = 1, limit = PAGE_SIZE } = {}) {
  const size = Math.min(100, Math.max(1, limit));
  const current = Math.max(1, page);

  const term = q.trim();
  const filter = term
    ? {
        $or: [
          { username: { $regex: literal(term), $options: "i" } },
          { email: { $regex: literal(term), $options: "i" } },
          { displayName: { $regex: literal(term), $options: "i" } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((current - 1) * size)
      .limit(size)
      .lean(),
    User.countDocuments(filter),
  ]);

  /**
   * ONE QUERY FOR THE WHOLE PAGE, not one per row. Twenty-five sequential
   * `findOne`s against `accounts` is the shape that looks free on a seeded
   * database and is not — the same note `/admin/queues` carries about counting
   * with `.length`.
   */
  const ids = rows.map((r) => r._id);

  /**
   * THREE LOOKUPS FOR THE WHOLE PAGE, and the same rule governs all of them.
   * Per-row would be 75 round trips for 25 rows, which looks free on a seeded
   * database and is not. The board read is a memo hit in the ordinary case, so
   * it costs nothing beyond a filter over rows already in memory.
   */
  const [credentialRows, computed] = await Promise.all([
    mongoose.connection
      .collection("accounts")
      .find({ userId: { $in: ids } })
      .project({ userId: 1 })
      .toArray(),
    computedRowsFor(ids),
  ]);

  const withCredentials = new Set(credentialRows.map((a) => String(a.userId)));

  return {
    items: rows.map((r) => {
      const key = String(r._id);
      return publicRow(r, withCredentials.has(key), computed.get(key) ?? null);
    }),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * What the Best-position picker offers: the account's holdings, then every
 * other equity the platform lists.
 *
 * FREE TEXT WAS THE WRONG CONTROL. "Best position" names a holding, and a typed
 * box lets an operator publish a trader's best position as a symbol they have
 * never owned — or as a typo, which renders as a ticker that does not exist
 * beside a return that cannot be checked against anything.
 *
 * It goes through `getPortfolio` rather than reading `Holding` directly, so the
 * returns offered here are the same numbers the trader's own portfolio screen
 * shows. A second valuation path would eventually disagree with the first, and
 * the disagreement would surface on a public board.
 *
 * Returns TWO groups, and keeping them apart is the point: `held` carries a
 * real return that reconciles with the trader's own portfolio screen, while
 * `available` carries none. Flattening them would put an invented figure and a
 * measured one in the same shape.
 *
 * Fetched when the editor opens, not with the listing: twenty-five portfolio
 * valuations to populate a dropdown nobody may open is the per-row cost this
 * file already has a note about.
 */
export async function listPositions(userId = null) {
  /**
   * `userId` IS OPTIONAL, because both editors ask this question and only one
   * of them has an account to ask it about. A standalone curated row belongs to
   * nobody, so it has no holdings — it gets the available list and an empty
   * `held`, rather than a second endpoint that would be this one minus four
   * lines.
   */
  let holdings = [];

  if (userId) {
    const user = await User.findById(userId).select("cashBalanceCents").lean();
    if (!user) throw ApiError.notFound("No such user", "USER_NOT_FOUND");

    // `holdings`, not `positions` — the local variable inside `getPortfolio` is
    // named `positions` but the key it returns is `holdings`, and destructuring
    // the wrong one yields `undefined` rather than an error.
    ({ holdings } = await getPortfolio(userId, user.cashBalanceCents));
  }

  /**
   * HELD FIRST, SORTED BY RETURN RATHER THAN BY VALUE.
   *
   * "Best position" means the best PERFORMING one, so the list has to put it
   * where the eye lands. `getPortfolio` sorts by market value, which is the
   * right order for a portfolio table and the wrong one here — the largest
   * holding is routinely not the best one, and an operator picking the top
   * entry would have been picking the biggest.
   */
  const held = holdings
    .map((p) => ({
      symbol: p.symbol,
      assetClass: p.assetClass,
      name: p.name,
      shares: p.shares,
      priceCents: p.priceCents ?? p.priceUsdCents ?? 0,
      priceUsdCents: p.priceUsdCents ?? p.priceCents ?? 0,
      returnPct: p.totalReturnPct,
      valueCents: p.marketValueCents,
      held: true,
    }))
    .sort((a, b) => b.returnPct - a.returnPct);

  const owned = new Set(held.map((p) => p.symbol));

  const [stocks, cryptoRes, forexRes] = await Promise.all([
    Stock.find({ status: { $ne: "Halted" } })
      .select("symbol name exchange priceCents priceUsdCents")
      .lean(),
    getInstruments({ assetClass: "crypto" }),
    getInstruments({ assetClass: "forex" }),
  ]);

  const allListed = [
    ...stocks.map((s) => ({ ...s, assetClass: "stocks" })),
    ...(cryptoRes?.items || []).map((s) => ({ ...s, assetClass: "crypto" })),
    ...(forexRes?.items || []).map((s) => ({ ...s, assetClass: "forex" })),
  ];

  const available = allListed
    .filter((s) => !owned.has(s.symbol))
    .map((s) => ({
      symbol: s.symbol,
      assetClass: s.assetClass,
      name: s.name,
      exchange: s.exchange,
      priceCents: s.priceCents || s.priceUsdCents || 0,
      priceUsdCents: s.priceUsdCents || s.priceCents || 0,
      returnPct: null,
      valueCents: 0,
      held: false,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return { held, available };
}

/**
 * The headline counts.
 *
 * `withCredentials` is a count over `accounts` rather than over users, because
 * that collection IS the answer — one row per sign-in method. It is the figure
 * that explains the gap between "209 accounts" and "2 people who can log in".
 */
export async function userCounts() {
  const [total, admins, suspended, withCredentials] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ status: "Suspended" }),
    mongoose.connection
      .collection("accounts")
      .countDocuments({ providerId: "credential" }),
  ]);
  return {
    total,
    admins,
    suspended,
    withCredentials,
    fixtures: total - withCredentials,
  };
}

const STATUSES = ["Active", "Flagged", "Suspended"];

/**
 * Changes an account's status, which is the only write this screen offers.
 *
 * ROLE IS DELIBERATELY NOT EDITABLE HERE. Granting `admin` from a table row is
 * a privilege escalation one misclick wide, and unlike a suspension it cannot
 * be noticed by the person it happened to. It belongs behind its own deliberate
 * flow if it is ever wanted.
 *
 * AN ADMIN CANNOT SUSPEND THEMSELVES. With one administrator — which is what
 * this database has — that single click removes the only account that could
 * undo it, and the recovery is a database edit. The guard is on the actor, not
 * on the role, so it still holds when there are several.
 *
 * Suspension takes effect on the NEXT REQUEST regardless of this function:
 * `requireAuth` reloads the user and refuses `Suspended`. The session rows are
 * deleted anyway, because leaving them means the account is refused while its
 * session sits there valid — two answers to "is this person signed in", and the
 * database should carry the one the product means.
 */
export async function setUserStatus(userId, status, actingAdminId) {
  if (!STATUSES.includes(status)) {
    throw ApiError.badRequest("BAD_STATUS", "Unknown status", { status });
  }
  if (String(userId) === String(actingAdminId)) {
    throw ApiError.badRequest(
      "SELF_STATUS_CHANGE",
      "You cannot change your own account status"
    );
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { status } },
    { new: true }
  ).lean();
  if (!user) throw ApiError.notFound("No such user", "USER_NOT_FOUND");

  let sessionsRevoked = 0;
  if (status === "Suspended") {
    const result = await mongoose.connection
      .collection("sessions")
      .deleteMany({ userId: user._id });
    sessionsRevoked = result.deletedCount ?? 0;
  }

  const canSignIn = Boolean(
    await mongoose.connection
      .collection("accounts")
      .findOne({ userId: user._id, providerId: "credential" })
  );

  return { user: publicRow(user, canSignIn), sessionsRevoked };
}

export async function adminUpdateCash(userId, targetCashCents, adminId) {
  return withTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw ApiError.notFound("User not found");

    const diff = targetCashCents - user.cashBalanceCents;
    if (diff === 0) return { cashBalanceCents: user.cashBalanceCents };

    const { balanceAfterCents } = await ledgerPost({
      userId,
      type: LEDGER_TYPE.ADJUSTMENT,
      amountCents: diff,
      reference: `admin_${Date.now()}`,
      detail: `Admin adjustment by ${adminId}`,
      session,
    });

    invalidateLeaderboard();
    return { cashBalanceCents: balanceAfterCents };
  });
}

export async function adminAddHolding(
  userId,
  { symbol, shares, costBasisCents },
  adminId
) {
  symbol = symbol.toUpperCase();
  // Find asset class and current price
  let asset = await Stock.findOne({ symbol }).lean();
  let assetClass = "stocks";
  if (!asset) {
    const { items } = await getInstruments({ assetClass: "crypto" });
    asset = items.find((i) => i.symbol === symbol);
    if (asset) assetClass = "crypto";
  }
  if (!asset) {
    const { items } = await getInstruments({ assetClass: "forex" });
    asset = items.find((i) => i.symbol === symbol);
    if (asset) assetClass = "forex";
  }
  if (!asset) throw ApiError.notFound("Symbol not found");

  const priceCents = costBasisCents || asset.priceCents;

  return withTransaction(async (session) => {
    const holding = await Holding.findOneAndUpdate(
      { userId, symbol },
      {
        $set: { assetClass, name: asset.name },
        $inc: {
          shares: shares,
          costBasisCents: Math.round(priceCents * shares),
        },
      },
      { upsert: true, new: true, session }
    );
    await User.updateOne(
      { _id: userId },
      { $inc: { tradeCount: 1 } },
      { session }
    );

    // Add to watchlist
    await WatchlistItem.updateOne(
      { userId, symbol, assetClass },
      { $setOnInsert: { addedAt: new Date() } },
      { upsert: true, session }
    );

    invalidateLeaderboard();
    return holding;
  });
}

export async function adminRemoveHolding(userId, symbol, adminId) {
  symbol = symbol.toUpperCase();
  await Holding.deleteOne({ userId, symbol });
  invalidateLeaderboard();
  return { success: true };
}

export async function adminUpdateAvatar(userId, image, adminId) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { image: image || null } },
    { new: true }
  ).lean();
  if (!user) throw ApiError.notFound("User not found");

  invalidateLeaderboard();
  return { success: true, image: user.image ?? null };
}

export async function adminAddFunds(userId, amountCents, adminId) {
  return withTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw ApiError.notFound("User not found");

    const { balanceAfterCents } = await ledgerPost({
      userId,
      type: LEDGER_TYPE.TOPUP,
      amountCents,
      reference: `admin_topup_${Date.now()}`,
      detail: `Virtual capital added by administrator`,
      session,
    });

    invalidateLeaderboard();
    return { cashBalanceCents: balanceAfterCents };
  });
}
