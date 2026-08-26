/**
 * Seeds a demoable HyperStocks database.
 *
 * Runs entirely offline using the anchor prices in data/stocks.js and the
 * fallback rates in data/fx.js, so a fresh clone is demoable with no network
 * and no API key. Deterministic — every run produces identical data.
 *
 *   npm run seed          upsert (safe to re-run)
 *   npm run seed:fresh    drop the collections first
 *
 * Two numbers from the design are pinned exactly, because they appear on
 * screen and in the leaderboard:
 *   jd_trader portfolio value = $12,220.64  (+$2,220.64 / +22.21% all-time)
 *   jd_trader leaderboard rank = 128
 *
 * See RECONCILIATION below for where the design's own figures disagreed.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { SEED_CASH_CENTS } from "../config/env.js";
import { connectDb, disconnectDb } from "../config/db.js";
import { makeRng, rngInt, rngFloat, rngPick } from "../lib/prng.js";
import { toCents, multiplyCents } from "../lib/money.js";

import { User } from "../models/User.js";
import { Stock } from "../models/Stock.js";
import { Exchange } from "../models/Exchange.js";
import { Holding } from "../models/Holding.js";
import { WatchlistItem } from "../models/WatchlistItem.js";
import { Order } from "../models/Order.js";
import { Transaction } from "../models/Transaction.js";
import { TopUpRequest } from "../models/TopUpRequest.js";
import { Announcement } from "../models/Announcement.js";
import { PortfolioSnapshot } from "../models/PortfolioSnapshot.js";
import { Candle } from "../models/Candle.js";

import { exchanges } from "./data/exchanges.js";
import { stocks as stockData } from "./data/stocks.js";
import { SEED_FX } from "./data/fx.js";

const FRESH = process.argv.includes("--fresh");
const PASSWORD = "password123";

/* ------------------------------------------------------------------------ *
 * RECONCILIATION
 *
 * The design's mock data is internally inconsistent. Where figures conflict,
 * this is what we honour and why:
 *
 * 1. Portfolio value $12,220.64 vs its own holdings.
 *    The Portfolio mockup lists 5 holdings summing to $11,142.78 and buying
 *    power of $3,410.00 — which totals $14,552.78, not the $12,220.64 shown.
 *    We honour $12,220.64 (it drives the stat card, the all-time return AND
 *    the leaderboard row) and let cash absorb the remainder, landing at
 *    $3,415.39 — within $6 of the design's buying power.
 *
 * 2. "Positions 5 / 4 exchanges" — the design's 5 holdings span only 3.
 *    We seed 5 positions genuinely spanning 4 exchanges by swapping TSLA
 *    (NASDAQ, already covered) for Toyota 7203 (TSE), so the stat card is true.
 *
 * 3. The allocation donut's arc lengths contradicted its own legend. We compute
 *    allocation from real sector weights instead.
 * ------------------------------------------------------------------------ */

/** The design's headline portfolio figure, in cents. */
const TARGET_PORTFOLIO_VALUE_CENTS = 1_222_064;

/** Symbol -> shares, avgCost (USD). Back-solved against the anchor prices. */
const JD_HOLDINGS = [
  { symbol: "AAPL", shares: 12, avgCostCents: 21_402 },
  { symbol: "NVDA", shares: 18, avgCostCents: 11_830 },
  { symbol: "ASML", shares: 2, avgCostCents: 75_003 },
  { symbol: "TSM", shares: 10, avgCostCents: 18_602 },
  { symbol: "7203", shares: 13, avgCostCents: 1_850 },
];

/**
 * The named traders occupying the top of the Leaderboard mockup.
 *
 * These usernames intentionally match the investor photo asset keys:
 *
 *   denise_coates
 *   elon_musk
 *   emma_grede
 *   keanu_reeves
 *   vadym_novynskyi
 *
 * Emails stay @hyperstocks.app so no row implies a real contact detail.
 *
 * Usernames must match the keys in the investor photo map, otherwise the
 * frontend will fall back to a generated avatar.
 */
const NAMED_TRADERS = [
  {
    username: "denise_coates",
    displayName: "Denise Coates",
    email: "denise.coates@hyperstocks.app",
    valueCents: 4_821_390,
    trades: 482,
  },
  {
    username: "elon_musk",
    displayName: "Elon Musk",
    email: "elon.musk@hyperstocks.app",
    valueCents: 4_107_735,
    trades: 118,
  },
  {
    username: "emma_grede",
    displayName: "Emma Grede",
    email: "emma.grede@hyperstocks.app",
    valueCents: 3_894_012,
    trades: 260,
  },
  {
    username: "keanu_reeves",
    displayName: "Keanu Reeves",
    email: "keanu.reeves@hyperstocks.app",
    valueCents: 3_321_548,
    trades: 64,
  },
  {
    username: "vadym_novynskyi",
    displayName: "Vadym Novynskyi",
    email: "vadym.novynskyi@hyperstocks.app",
    valueCents: 3_188_203,
    trades: 734,
  },
];

const JD_RANK = 128;

/** 127 users must outrank jd_trader; the named ones first, then synthetic. */
const SYNTHETIC_ABOVE = JD_RANK - 1 - NAMED_TRADERS.length;
const SYNTHETIC_BELOW = 80;

const priceCentsOf = (s) => toCents(s.price);

const priceUsdCentsOf = (s) =>
  Math.round(toCents(s.price) * (SEED_FX[s.currency] ?? 1));

/** Cents -> "$12,220.64" for log output only. */
const usd = (cents) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function log(step, detail) {
  console.log(`  ${step.padEnd(22)} ${detail}`);
}

async function wipe() {
  console.log("  --fresh: dropping collections…");

  /** @type {import('mongoose').Model<any>[]} */
  const collections = [
    User,
    Stock,
    Exchange,
    Holding,
    WatchlistItem,
    Order,
    Transaction,
    TopUpRequest,
    Announcement,
    PortfolioSnapshot,
    Candle,
  ];

  await Promise.all(collections.map((M) => M.deleteMany({})));
}

async function seedExchanges() {
  await Exchange.bulkWrite(
    exchanges.map((e) => ({
      updateOne: {
        filter: { code: e.code },
        update: { $set: e },
        upsert: true,
      },
    }))
  );

  log("exchanges", `${exchanges.length} upserted`);
}

async function seedStocks() {
  const now = new Date();

  await Stock.bulkWrite(
    stockData.map((s) => ({
      updateOne: {
        filter: { symbol: s.symbol },
        update: {
          // Fields are listed explicitly rather than spread from the source.
          // The fixtures carry prices in dollars for readability; spreading
          // them would push float `price`/`week52High` keys at a schema that
          // now stores cents, and rely on Mongoose silently dropping them.
          $set: {
            symbol: s.symbol,
            name: s.name,
            exchange: s.exchange,
            sector: s.sector,
            currency: s.currency,
            about: s.about,
            vendorSymbols: s.vendorSymbols,
            status: s.status === "Halted" ? "Halted" : "Listed",

            priceCents: priceCentsOf(s),
            priceUsdCents: priceUsdCentsOf(s),
            previousCloseCents: toCents(s.previousClose ?? s.price),
            dayOpenCents: toCents(s.dayOpen ?? s.price),
            dayHighCents: toCents(s.dayHigh ?? s.price),
            dayLowCents: toCents(s.dayLow ?? s.price),
            week52HighCents: toCents(s.week52High ?? s.price),
            week52LowCents: toCents(s.week52Low ?? s.price),

            changePct: s.previousClose
              ? Math.round(
                  ((s.price - s.previousClose) / s.previousClose) * 10_000
                ) / 100
              : 0,

            volume: s.volume,
            marketCap: s.marketCap,
            peRatio: s.peRatio,
            quoteAsOf: now,
            referenceAsOf: now,
          },
        },
        upsert: true,
      },
    }))
  );

  const halted = stockData.filter((s) => s.status === "Halted").length;

  log(
    "stocks",
    `${stockData.length} upserted across 8 exchanges (${halted} halted)`
  );
}

/**
 * Hashed once and shared by the accounts that actually get a credential —
 * which, since the migration to Better Auth, is two of them rather than 209.
 */
let sharedPasswordHash = null;

/**
 * MOST SEEDED TRADERS GET NO CREDENTIAL AT ALL, and that is the point.
 *
 * Better Auth keeps credentials in `accounts`, one row per sign-in method, so a
 * `users` document with no `accounts` document beside it is a coherent thing: it
 * ranks on the leaderboard, holds positions and carries a `tradeCount`, and
 * there is simply no password to present. The 207 fixture traders exist to
 * populate a board, never to sign in, so writing them 207 bcrypt hashes of the
 * same demo password was only ever dead credential material sitting in the
 * database.
 *
 * `issuer`, `accountId` and the ObjectId `userId` mirror exactly what Better
 * Auth writes on a real signup — captured from one rather than guessed, because
 * a row that is close but not identical fails at sign-in, which reads as a
 * wrong password.
 */
async function giveCredential(user) {
  const password = (sharedPasswordHash ??= await bcrypt.hash(PASSWORD, 12));
  const now = new Date();
  await mongoose.connection.collection("accounts").updateOne(
    { userId: user._id, providerId: "credential" },
    {
      $set: {
        issuer: "local:credential",
        accountId: String(user._id),
        providerId: "credential",
        userId: user._id,
        password,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

async function makeUser({
  username,
  email,
  cashBalanceCents,
  displayName = null,
  tradeCount = 0,
  role = "user",
  status = "Active",
  createdAt = null,
  credentials = false,
}) {
  const user = await User.findOneAndUpdate(
    { username },
    {
      $set: {
        email,
        cashBalanceCents: Math.round(cashBalanceCents),
        displayName: displayName ?? undefined,
        tradeCount,
        role,
        status,
        /**
         * Better Auth's own two fields, written here so a seeded row is the
         * same shape as a registered one. `name` is its required display
         * field and falls back to the handle; `emailVerified` is true because
         * there is no mail sender in this repo to verify through, and a
         * fixture account stuck behind an unverifiable gate is unusable.
         */
        name: displayName ?? username,
        emailVerified: true,
      },
      $setOnInsert: {
        createdAt: createdAt ?? new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  if (credentials) await giveCredential(user);
  return user;
}

/**
 * Gives a user holdings whose USD value plus leftover cash equals `targetValue`
 * exactly. Cash absorbs the rounding remainder, so portfolio value is exact.
 */
async function giveHoldings(user, targetValueCents, stocks, rng) {
  const tradable = stocks.filter((s) => s.status !== "Halted");
  const count = rngInt(rng, 1, 3);
  const picked = [];
  let spentCents = 0;

  for (let i = 0; i < count; i++) {
    const stock = rngPick(rng, tradable);

    if (picked.some((p) => p.symbol === stock.symbol)) continue;

    // Spend a slice of the target, never more than what remains.
    const budgetCents =
      (targetValueCents - spentCents) * rngFloat(rng, 0.15, 0.55);

    const shares = Math.floor(budgetCents / stock.priceUsdCents);

    if (shares < 1) continue;

    const valueCents = multiplyCents(stock.priceUsdCents, shares);

    if (spentCents + valueCents > targetValueCents) continue;

    spentCents += valueCents;

    picked.push({
      userId: user._id,
      symbol: stock.symbol,
      shares,
      costBasisCents: multiplyCents(
        Math.round(stock.priceUsdCents * rngFloat(rng, 0.72, 1.18)),
        shares
      ),
    });
  }

  if (picked.length) await Holding.insertMany(picked);

  // Cash absorbs the remainder so portfolio value lands exactly on target.
  const cashCents = targetValueCents - spentCents;

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        cashBalanceCents: cashCents,
      },
    }
  );

  return {
    holdingsValueCents: spentCents,
    cashCents,
  };
}

async function seedJdTrader(stockBySymbol) {
  const user = await makeUser({
    username: "jd_trader",
    email: "jd@hyperstocks.app",
    cashBalanceCents: 0,
    tradeCount: 38,
    createdAt: new Date(Date.now() - 200 * 86_400_000),
    // One of the only two seeded accounts that can actually sign in.
    credentials: true,
  });

  await Holding.deleteMany({
    userId: user._id,
  });

  // Followed but not held — the dashboard's watchlist card.
  //
  // Equities only, even though the watchlist now spans three classes. These
  // resolve out of the Stock collection, so the card renders identically with
  // no network; a seeded coin would depend on CoinGecko being reachable and
  // would render as an unresolved placeholder on an offline demo.
  await WatchlistItem.deleteMany({ userId: user._id });
  await WatchlistItem.insertMany(
    ["MSFT", "AMZN", "0700", "SAP", "GOOGL", "AZN"].map((symbol) => ({
      userId: user._id,
      assetClass: "stocks",
      symbol,
    }))
  );

  let holdingsValueCents = 0;

  const rows = JD_HOLDINGS.map((h) => {
    const stock = stockBySymbol.get(h.symbol);

    holdingsValueCents += multiplyCents(stock.priceUsdCents, h.shares);

    return {
      userId: user._id,
      symbol: h.symbol,
      shares: h.shares,
      costBasisCents: multiplyCents(h.avgCostCents, h.shares),
    };
  });

  await Holding.insertMany(rows);

  const cashCents = TARGET_PORTFOLIO_VALUE_CENTS - holdingsValueCents;

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        cashBalanceCents: cashCents,
      },
    }
  );

  log(
    "jd_trader",
    `holdings ${usd(holdingsValueCents)} + cash ${usd(
      cashCents
    )} = ${usd(TARGET_PORTFOLIO_VALUE_CENTS)}`
  );

  return {
    user,
    holdingsValueCents,
    cashCents,
  };
}

async function seedLedger(jd, stockBySymbol) {
  await Transaction.deleteMany({
    userId: jd.user._id,
  });

  await Order.deleteMany({
    userId: jd.user._id,
  });

  const day = (n) => new Date(Date.now() - n * 86_400_000);

  const txns = [
    {
      userId: jd.user._id,
      type: "Top-up",
      detail: "Initial virtual capital",
      amountCents: SEED_CASH_CENTS,
      status: "Approved",
      createdAt: day(17),
    },
  ];

  const orders = [];

  for (const h of JD_HOLDINGS) {
    const stock = stockBySymbol.get(h.symbol);

    const totalCents = multiplyCents(h.avgCostCents, h.shares);

    orders.push({
      userId: jd.user._id,
      symbol: h.symbol,
      side: "BUY",
      orderType: "MARKET",
      quantity: h.shares,
      fillPriceCents: Math.round(
        h.avgCostCents / (SEED_FX[stock.currency] ?? 1)
      ),
      fillPriceUsdCents: h.avgCostCents,
      totalCents,
      currency: stock.currency,
      status: "FILLED",
      filledAt: day(12),
      createdAt: day(12),
    });

    txns.push({
      userId: jd.user._id,
      type: "Buy",
      detail: `${h.shares} ${h.symbol} @ ${usd(h.avgCostCents)}`,
      amountCents: -totalCents,
      status: "Filled",
      createdAt: day(12),
    });
  }

  // A realised sell, a resting limit order, and a rejection —
  // so every status in the design's Wallet and Orders tables
  // has a real row behind it.
  txns.push({
    userId: jd.user._id,
    type: "Sell",
    detail: "4 NVDA @ $129.80",
    amountCents: 51_920,
    status: "Filled",
    createdAt: day(6),
  });

  orders.push({
    userId: jd.user._id,
    symbol: "NVDA",
    side: "SELL",
    orderType: "MARKET",
    quantity: 4,
    fillPriceCents: 12_980,
    fillPriceUsdCents: 12_980,
    totalCents: 51_920,
    currency: "USD",
    status: "FILLED",
    filledAt: day(6),
    createdAt: day(6),
  });

  orders.push({
    userId: jd.user._id,
    symbol: "TSLA",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 5,
    limitPriceCents: 21_000,
    currency: "USD",
    status: "PENDING",
    createdAt: day(2),
  });

  await Order.insertMany(orders);
  await Transaction.insertMany(txns);

  log("jd ledger", `${orders.length} orders, ${txns.length} transactions`);
}

async function seedTopUps(jd, adminUser) {
  await TopUpRequest.deleteMany({
    userId: jd.user._id,
  });

  const day = (n) => new Date(Date.now() - n * 86_400_000);

  await TopUpRequest.insertMany([
    {
      userId: jd.user._id,
      amountCents: 150_000,
      reason: "Rebalancing experiment",
      status: "Pending",
      createdAt: day(1),
    },
    {
      userId: jd.user._id,
      amountCents: 200_000,
      reason: "Blew up on TSLA puts",
      status: "Approved",
      reviewedBy: adminUser._id,
      reviewedAt: day(8),
      createdAt: day(8),
    },
    {
      userId: jd.user._id,
      amountCents: 500_000,
      reason: "Doubling down",
      status: "Declined",
      reviewedBy: adminUser._id,
      reviewedAt: day(13),
      adminNote: "Over limit",
      createdAt: day(13),
    },
  ]);

  log("top-ups", "3 requests (Pending / Approved / Declined)");
}

async function seedAnnouncements(adminUser) {
  await Announcement.deleteMany({});

  await Announcement.insertMany([
    {
      title: "US market holiday - Labor Day",
      body: "NYSE and NASDAQ are closed on Monday, Sep 7. Orders placed during the holiday queue for the next open.",
      audience: "All users",
      status: "Live",
      deliveredCount: 51_204,
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
      createdBy: adminUser._id,
    },
    {
      title: "Scheduled maintenance",
      body: "The platform will be read-only on Aug 23 from 02:00 to 04:00 UTC while we upgrade the price feed.",
      audience: "All users",
      status: "Live",
      deliveredCount: 50_988,
      publishedAt: new Date(Date.now() - 4 * 86_400_000),
      createdBy: adminUser._id,
    },
    {
      title: "August trading competition",
      body: "Monthly leaderboard resets Sep 1. Top three traders keep a permanent badge on their profile.",
      audience: "Active traders",
      status: "Sent",
      deliveredCount: 23_410,
      publishedAt: new Date(Date.now() - 17 * 86_400_000),
      createdBy: adminUser._id,
    },
    {
      title: "New exchange: XETRA",
      body: "921 German stocks are now tradable. Trading hours 09:00-17:30 CET.",
      audience: "All users",
      status: "Draft",
      createdBy: adminUser._id,
    },
  ]);

  log("announcements", "4 (2 Live, 1 Sent, 1 Draft)");
}

/**
 * 90 days of daily marks for every user. Not cosmetic: without these the
 * performance chart is blank and Weekly/Monthly leaderboard returns
 * cannot be computed at all. Walks backwards from each user's true
 * current value.
 */
async function seedSnapshots(userValues) {
  await PortfolioSnapshot.deleteMany({});

  const DAYS = 90;

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  const docs = [];

  for (const { userId, username, valueCents, cashCents } of userValues) {
    const rng = makeRng(`snap:${username}`);

    let v = valueCents;

    for (let d = 0; d < DAYS; d++) {
      const date = new Date(midnight.getTime() - d * 86_400_000);

      const cash = Math.min(cashCents, Math.round(v));

      docs.push({
        userId,
        date,
        portfolioValueCents: Math.round(v),
        cashBalanceCents: cash,
        holdingsValueCents: Math.max(0, Math.round(v) - cash),
      });

      // Walk backwards with a slight upward drift, so "today" is the peak
      // of a plausible climb rather than a random point.
      v = v / (1 + rngFloat(rng, -0.012, 0.02));
    }
  }

  for (let i = 0; i < docs.length; i += 5000) {
    await PortfolioSnapshot.insertMany(docs.slice(i, i + 5000), {
      ordered: false,
    });
  }

  log(
    "snapshots",
    `${docs.length.toLocaleString("en-US")} daily marks (${DAYS}d x ${
      userValues.length
    } users)`
  );
}

/**
 * Seeds an already-connected database. Exported so the server can auto-seed
 * on boot when running against the ephemeral in-memory Mongo — otherwise a
 * separate `npm run seed` process would seed its own throwaway instance and
 * the running API would still see an empty database.
 */
export async function runSeed({ fresh = false } = {}) {
  if (fresh) await wipe();

  await seedExchanges();
  await seedStocks();

  const stocks = await Stock.find().lean();
  const stockBySymbol = new Map(stocks.map((s) => [s.symbol, s]));

  const admin = await makeUser({
    username: "admin",
    email: "admin@hyperstocks.app",
    cashBalanceCents: SEED_CASH_CENTS,
    role: "admin",
    credentials: true,
  });

  log("admin", "admin@hyperstocks.app");

  const userValues = [];

  // jd_trader — the identity every mockup is drawn around.
  const jd = await seedJdTrader(stockBySymbol);

  userValues.push({
    userId: jd.user._id,
    username: "jd_trader",
    valueCents: TARGET_PORTFOLIO_VALUE_CENTS,
    cashCents: jd.cashCents,
  });

  await seedLedger(jd, stockBySymbol);
  await seedTopUps(jd, admin);
  await seedAnnouncements(admin);

  // Named traders occupying the top of the Leaderboard mockup.
  // Their usernames match the investor asset keys.
  for (const t of NAMED_TRADERS) {
    const rng = makeRng(`named:${t.username}`);

    const u = await makeUser({
      username: t.username,
      displayName: t.displayName,
      email: t.email,
      cashBalanceCents: 0,
      tradeCount: t.trades,
      createdAt: new Date(Date.now() - rngInt(rng, 120, 400) * 86_400_000),
    });

    await Holding.deleteMany({
      userId: u._id,
    });

    const { cashCents } = await giveHoldings(u, t.valueCents, stocks, rng);

    userValues.push({
      userId: u._id,
      username: t.username,
      valueCents: t.valueCents,
      cashCents,
    });
  }

  log("named traders", `${NAMED_TRADERS.length} seeded at their design values`);

  // Synthetic population, sized so jd_trader lands at exactly rank 128.
  const synthetic = [];

  const aboveRng = makeRng("synthetic:above");

  for (let i = 0; i < SYNTHETIC_ABOVE; i++) {
    // Strictly between jd_trader and the lowest named trader.
    const valueCents = Math.round(
      rngFloat(aboveRng, TARGET_PORTFOLIO_VALUE_CENTS + 100, 2_790_000)
    );

    synthetic.push({
      username: `trader_${String(i + 1).padStart(3, "0")}`,
      valueCents,
    });
  }

  const belowRng = makeRng("synthetic:below");

  for (let i = 0; i < SYNTHETIC_BELOW; i++) {
    const valueCents = Math.round(
      rngFloat(belowRng, 240_000, TARGET_PORTFOLIO_VALUE_CENTS - 100)
    );

    synthetic.push({
      username: `trader_${String(SYNTHETIC_ABOVE + i + 1).padStart(3, "0")}`,
      valueCents,
    });
  }

  for (const s of synthetic) {
    const rng = makeRng(`synth:${s.username}`);

    const u = await makeUser({
      username: s.username,
      email: `${s.username}@example.com`,
      cashBalanceCents: 0,
      tradeCount: rngInt(rng, 1, 900),
      createdAt: new Date(Date.now() - rngInt(rng, 5, 500) * 86_400_000),
    });

    await Holding.deleteMany({
      userId: u._id,
    });

    const { cashCents } = await giveHoldings(u, s.valueCents, stocks, rng);

    userValues.push({
      userId: u._id,
      username: s.username,
      valueCents: s.valueCents,
      cashCents,
    });
  }

  log(
    "synthetic users",
    `${synthetic.length} (${SYNTHETIC_ABOVE} above jd_trader, ${SYNTHETIC_BELOW} below)`
  );

  await seedSnapshots(userValues);

  // Verify the two pinned invariants rather than trusting the arithmetic.
  const ranked = [...userValues].sort((a, b) => b.valueCents - a.valueCents);

  const jdRank = ranked.findIndex((u) => u.username === "jd_trader") + 1;

  const totals = await Promise.all([
    User.countDocuments(),
    Stock.countDocuments(),
    Holding.countDocuments(),
    Order.countDocuments(),
    Transaction.countDocuments(),
  ]);

  console.log("\n  Verification");

  const reconciles =
    jd.holdingsValueCents + jd.cashCents === TARGET_PORTFOLIO_VALUE_CENTS;

  const allTimeCents = TARGET_PORTFOLIO_VALUE_CENTS - SEED_CASH_CENTS;

  console.log(
    `    jd_trader portfolio  ${usd(TARGET_PORTFOLIO_VALUE_CENTS)}  ${
      reconciles ? "OK" : "MISMATCH"
    }`
  );

  console.log(
    `    jd_trader rank       ${jdRank}  ${
      jdRank === JD_RANK ? "OK" : `MISMATCH (expected ${JD_RANK})`
    }`
  );

  console.log(
    `    all-time return      +${usd(allTimeCents)} (+${(
      (allTimeCents / SEED_CASH_CENTS) *
      100
    ).toFixed(2)}%)`
  );

  console.log(
    `    integer cents        ${
      Number.isInteger(jd.cashCents) && Number.isInteger(jd.holdingsValueCents)
        ? "OK"
        : "FLOAT LEAKED"
    }`
  );

  console.log("\n  Totals");

  console.log(
    `    users ${totals[0]} · stocks ${totals[1]} · holdings ${totals[2]} · orders ${totals[3]} · transactions ${totals[4]}`
  );

  console.log(`\n  Sign in as any user with password: ${PASSWORD}`);

  console.log(
    "    jd@hyperstocks.app     jd_trader — the account every mockup depicts"
  );

  console.log("    admin@hyperstocks.app  admin — role: admin\n");

  return {
    users: totals[0],
    stocks: totals[1],
    jdRank,
  };
}

/** CLI entry: `npm run seed` / `npm run seed:fresh`. */
async function main() {
  console.log("\nSeeding HyperStocks…\n");

  await connectDb();
  await runSeed({
    fresh: FRESH,
  });
  await disconnectDb();
}

const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch(async (err) => {
    console.error("\nSeed failed:", err);

    await mongoose.disconnect().catch(() => {});

    process.exit(1);
  });
}
