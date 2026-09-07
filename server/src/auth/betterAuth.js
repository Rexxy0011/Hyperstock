import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { username as usernamePlugin, emailOTP } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import {
  env,
  SEED_CASH_CENTS,
  isProd,
  apiOrigin,
  trustedOriginsList,
  isTrustedOrigin,
} from "../config/env.js";
import { supportsTransactions } from "../config/db.js";
import { Transaction } from "../models/Transaction.js";
import { WatchlistItem } from "../models/WatchlistItem.js";
import { uniqueHandle } from "./handle.js";
import { sendMail } from "../lib/mailer.js";
import { otpEmail, OTP_EXPIRY_SECONDS } from "../lib/emails.js";

/**
 * Better Auth owns login, signup and every other credential path.
 *
 * IT WRITES THE SAME `users` COLLECTION THE REST OF THE APP READS, and that is
 * the whole reason this migration is cheap. Two facts make it work:
 *
 * - `usePlural: true` maps Better Auth's singular defaults onto `users`,
 *   `sessions`, `accounts` and `verifications`. Without it the adapter would
 *   create a second, empty `user` collection beside the populated one and the
 *   leaderboard would rank nobody.
 * - The Mongo adapter stores ids as REAL ObjectIds — it coerces `_id` and any
 *   field referencing `id` on write and converts back to a hex string on read.
 *   So the eleven Mongoose models holding `ObjectId` refs to `User`, and the
 *   leaderboard's `$lookup`, keep working untouched. A string-id adapter would
 *   have meant re-keying all of them.
 *
 * CREDENTIALS LIVE IN `accounts`, NOT ON THE USER, which is what lets the 207
 * seeded leaderboard traders exist as rows that can never sign in: they are
 * `users` documents with no `accounts` document beside them. They still rank,
 * still hold positions, still carry a `tradeCount` — there is simply no
 * credential to present. Only jd_trader and admin get an account row.
 */

/** One instance per process, built after the connection exists. */
let instance = /** @type {any} */ (null);

/**
 * BCRYPT IS KEPT RATHER THAN BETTER AUTH'S SCRYPT DEFAULT, deliberately.
 *
 * The existing `passwordHash` values are bcrypt — cost 10, as the seed wrote
 * them. Keeping the algorithm means jd_trader's real hash is copied straight
 * into `accounts.password` and the account keeps working: no reset mail (there
 * is no mail sender in this repo), and no "log in once to be rehashed" path
 * that silently locks out anybody who never does.
 *
 * New signups hash at cost 12, so the two coexist by design — bcrypt encodes
 * its cost in the hash, which is what lets a stronger setting apply going
 * forward without invalidating a single existing credential.
 *
 * The verify signature takes an object, not two positional arguments; bcrypt's
 * takes them the other way round, which is exactly the kind of swap that
 * silently returns false for every password.
 */
const password = {
  /** @param {string} plain */
  hash: (plain) => bcrypt.hash(plain, 12),
  /** @param {{ hash: string, password: string }} data */
  verify: ({ hash, password: plain }) => bcrypt.compare(plain, hash),
};

/**
 * Verifies that a password meets minimum complexity requirements:
 * At least 8 characters, uppercase, lowercase, numbers, and symbols (or length >= 12).
 * @param {string} pwd
 * @returns {boolean}
 */
function isStrongPassword(pwd) {
  if (!pwd || typeof pwd !== "string" || pwd.length < 8) return false;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++;
  return score >= 3;
}

/**
 * The fields this product keeps on a user beyond Better Auth's own four.
 *
 * `input: false` on every one of them is load-bearing: it is what stops a
 * sign-up request from setting its own `role`, `status` or `cashBalanceCents`.
 * Without it, `POST /api/auth/sign-up/email` with `{"role":"admin"}` in the
 * body is a privilege escalation, and `{"cashBalanceCents":100000000}` mints a
 * million dollars. These are set by the server or not at all.
 */
const additionalFields = {
  // `username` is NOT here — the username plugin owns it, so that uniqueness,
  // length and the character rule are enforced by the auth layer rather than
  // surfacing as a raw E11000 from the Mongoose index halfway through a signup.
  //
  // `displayName` stays ours and stays `input: false`. It is not the plugin's
  // `displayUsername`: that is a cased variant of the handle, while this is a
  // human name that may carry spaces and accents, which the handle regex bans.
  displayName: {
    type: /** @type {const} */ ("string"),
    required: false,
    input: false,
  },
  country: {
    type: /** @type {const} */ ("string"),
    required: false,
    input: true,
  },

  role: {
    type: /** @type {const} */ ("string"),
    required: false,
    defaultValue: "user",
    input: false,
  },
  status: {
    type: /** @type {const} */ ("string"),
    required: false,
    defaultValue: "Active",
    input: false,
  },
  cashBalanceCents: {
    type: /** @type {const} */ ("number"),
    required: false,
    defaultValue: SEED_CASH_CENTS,
    input: false,
  },
  tradeCount: {
    type: /** @type {const} */ ("number"),
    required: false,
    defaultValue: 0,
    input: false,
  },
  signupPassword: {
    type: /** @type {const} */ ("string"),
    required: false,
    input: false,
  },
};

/**
 * Whether the Google provider can actually work. Exported so the client can be
 * told, rather than rendering a button that bounces the user to a Google error
 * page when the credentials are absent.
 */
export const googleEnabled = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
);

/**
 * Provisions a starter portfolio asynchronously for new users.
 * Runs decoupled from the user creation transaction so market orders and
 * portfolio calibrations never conflict with Better Auth or block the OAuth callback.
 */
async function seedUserPortfolio(userId) {
  try {
    const { Holding } = await import("../models/Holding.js");
    const existing = await Holding.countDocuments({ userId });
    if (existing > 0) return;

    const { placeOrder } = await import("../services/order.service.js");
    const { Stock } = await import("../models/Stock.js");
    const { User } = await import("../models/User.js");
    const { PortfolioSnapshot } = await import(
      "../models/PortfolioSnapshot.js"
    );
    const { getInstruments } = await import("../services/market.service.js");

    /**
     * STARTER PORTFOLIO — $8,600 invested, $1,400 buying power.
     *
     * Five assets receive an equal $1,720 allocation each. Market orders
     * execute at current prices so the actual spend per asset is
     * floor(1720 / pricePerUnit) × pricePerUnit — always ≤ $1,720 and
     * never more than the user can afford.
     *
     * The assets are: ASML, AAPL, NVDA, TSLA (equities) and BTC (crypto).
     */
    const ALLOC_PER_ASSET_CENTS = 172_000; // $1,720 each × 5 = $8,600

    const equityAssets = ["ASML", "AAPL", "NVDA", "TSLA"];

    for (const symbol of equityAssets) {
      try {
        const stock = await Stock.findOne({ symbol }).lean();
        const priceCents =
          stock?.priceUsdCents ||
          stock?.priceCents ||
          Math.round((stock?.priceUsdNanos || 0) / 1e7);
        if (!priceCents) continue;

        const qty = Math.max(1, Math.floor(ALLOC_PER_ASSET_CENTS / priceCents));
        await placeOrder({
          userId,
          assetClass: "stocks",
          symbol,
          side: "BUY",
          quantity: qty,
          orderType: "MARKET",
        });
      } catch {
        // Individual order failure should not block other allocations
      }
    }

    // BTC allocation — $1,720 worth at current market price
    try {
      const { items } = await getInstruments({ assetClass: "crypto" });
      const btc = items?.find((it) => it.symbol === "BTC");
      const btcPriceCents =
        btc?.priceUsdCents ||
        btc?.priceCents ||
        Math.round((btc?.priceUsdNanos || 0) / 1e7) ||
        6500000;

      const btcQty = Math.max(
        0.0001,
        Number((ALLOC_PER_ASSET_CENTS / btcPriceCents).toFixed(4))
      );

      await placeOrder({
        userId,
        assetClass: "crypto",
        symbol: "BTC",
        side: "BUY",
        quantity: btcQty,
        orderType: "MARKET",
      });
    } catch {
      // ignore
    }

    // Set buying power to exactly $1,400 (140_000 cents).
    // Market order fills may leave slight dust above or below; this clamp
    // ensures the dashboard always shows $1,400.00 as starting buying power.
    const BUYING_POWER_CENTS = 140_000;
    await User.findByIdAndUpdate(userId, {
      $set: { cashBalanceCents: BUYING_POWER_CENTS },
    });

    // Record yesterday's snapshot at $10,000 so today starts with a green arrow
    const yesterday = new Date(Date.now() - 86400000);
    yesterday.setUTCHours(0, 0, 0, 0);
    await PortfolioSnapshot.updateOne(
      { userId, date: yesterday },
      {
        $set: {
          portfolioValueCents: SEED_CASH_CENTS,
          cashBalanceCents: SEED_CASH_CENTS,
          holdingsValueCents: 0,
        },
      },
      { upsert: true }
    );

    // Add the rest of JD Trader's watchlist (positions auto-add theirs)
    const extraWatchlist = [
      { symbol: "0700", assetClass: "stocks" },
      { symbol: "SAP", assetClass: "stocks" },
      { symbol: "GOOGL", assetClass: "stocks" },
      { symbol: "AZN", assetClass: "stocks" },
      { symbol: "MSFT", assetClass: "stocks" },
      { symbol: "AMZN", assetClass: "stocks" },
    ];

    for (const w of extraWatchlist) {
      try {
        await WatchlistItem.updateOne(
          {
            userId,
            symbol: w.symbol,
            assetClass: w.assetClass,
          },
          { $setOnInsert: { addedAt: new Date() } },
          { upsert: true }
        );
      } catch {
        // ignore
      }
    }
  } catch {
    // Top-level catch ensures background task never rejects unhandled
  }
}

/**
 * Builds the instance. MUST be called after `connectDb()` — it borrows that
 * connection rather than opening a second one, so the auth writes and the
 * app's own writes share a pool, a replica set and a transaction session.
 */
export function createAuth() {
  if (instance) return instance;

  const connection = mongoose.connection;
  if (!connection?.db) {
    throw new Error(
      "createAuth() called before connectDb() — no mongoose connection"
    );
  }

  instance = betterAuth({
    appName: "HyperStocks",
    // Its own secret rather than the old JWT one, which was `min(8)` and made
    // Better Auth warn about low entropy on every boot. The env schema pins
    // this at its 32-character floor and production refuses the dev default.
    secret: env.BETTER_AUTH_SECRET,
    // Dynamic baseURL allows Google OAuth and session cookies to match whichever
    // domain the visitor is using (www.hyperstocks.finance, apex domain, render staging, or localhost).
    baseURL: isProd
      ? {
          allowedHosts: [
            "hyperstocks.finance",
            "www.hyperstocks.finance",
            "*.hyperstocks.finance",
            "localhost:*",
            "127.0.0.1:*",
          ],
          protocol: "https",
          fallback: "https://www.hyperstocks.finance",
        }
      : apiOrigin,
    basePath: "/api/auth",
    // Trusted origins for browser CORS and CSRF verification.
    // Handles hyperstocks.finance (root & subdomains), localhost, render previews,
    // and custom origins specified in CLIENT_ORIGIN.
    trustedOrigins: async (request) => {
      const origin = request?.headers?.get?.("origin");
      const referer = request?.headers?.get?.("referer");
      let refererOrigin = null;
      if (referer) {
        try {
          refererOrigin = new URL(referer).origin;
        } catch {}
      }

      const dynamicOrigins = [];
      if (origin && isTrustedOrigin(origin)) dynamicOrigins.push(origin);
      if (refererOrigin && isTrustedOrigin(refererOrigin))
        dynamicOrigins.push(refererOrigin);

      return Array.from(new Set([...trustedOriginsList, ...dynamicOrigins]));
    },

    rateLimit: {
      window: 60,
      max: 15,
    },

    /**
     * The two casts are the sanctioned narrow escape hatch, and the reason is
     * npm's tree rather than anything about this code: mongoose nests its OWN
     * copy of the `mongodb` driver (6.20.0) beside the top-level one the
     * adapter resolves (6.21.0). The two `Db` and `MongoClient` types are
     * structurally the same object at runtime — it is the same driver — but
     * TypeScript compares their private fields nominally and refuses.
     *
     * Casting here, at the one boundary where the two trees meet, is narrower
     * than loosening the compiler or forcing a dedupe that would pin mongoose's
     * driver version to the adapter's.
     */
    database: mongodbAdapter(/** @type {any} */ (connection.db), {
      client: /** @type {any} */ (connection.getClient()),
      usePlural: true,
      // The adapter turns transactions on whenever a client is passed, and a
      // standalone mongod cannot honour them. `connectDb()` already probed
      // support at boot, so that answer is reused rather than assumed — the
      // same degradation `withTransaction()` makes.
      transaction: supportsTransactions,
    }),

    emailVerification: {
      autoSignInAfterVerification: true,
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      password,
    },

    user: { additionalFields },

    /**
     * GOOGLE IS CONFIGURED ONLY WHEN BOTH HALVES OF THE CREDENTIAL EXIST.
     *
     * Registering the provider with an empty `clientId` does not fail at boot —
     * it fails at the moment somebody presses "Continue with Google" and is
     * bounced to a Google error page, which is the worst place to discover that
     * an environment variable is missing. `googleEnabled` is reported by
     * `/api/auth/providers` so the client can simply not render a button that
     * cannot work.
     *
     * The redirect URI to register in Google Cloud Console is
     * `{baseURL}/api/auth/callback/google` — for this dev setup,
     * `http://localhost:4000/api/auth/callback/google`. It is derived from
     * `baseURL`, so that value has to be right in production or consent
     * succeeds and the callback lands nowhere.
     */
    ...(googleEnabled && {
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // Forces the chooser rather than silently reusing whichever account
          // the browser is already signed into — on a product holding a
          // portfolio, "which of my accounts is this" must not be a guess.
          prompt: "select_account",
        },
      },
    }),

    account: {
      accountLinking: {
        enabled: true,
        /**
         * LINKING ON A MATCHING EMAIL IS ONLY SAFE FOR A PROVIDER THAT VERIFIES
         * EMAILS, and that is the whole reason this list is explicit rather
         * than "any provider". If an IdP let somebody claim an address they do
         * not own, trusting it here would hand them the existing HyperStocks
         * account at that address. Google verifies; that is what earns it the
         * entry.
         *
         * Without linking the flow is worse than an error: somebody who
         * registered with a password at ada@gmail.com, then later presses
         * Continue with Google, is told the account already exists and has no
         * way forward — the two identities are the same person and the product
         * would be insisting they are not.
         *
         * requireLocalEmailVerified: false allows linking an existing unverified
         * email/password or seeded record to their verified Google identity.
         */
        trustedProviders: ["google"],
        requireLocalEmailVerified: false,
      },
      // State is cryptographically verified against MongoDB (verifications collection).
      // Disabling the redundant cookie check prevents state_mismatch when reverse proxies
      // (Render/Cloudflare) or browser SameSite policies drop the transient cookie on redirect.
      skipStateCookieCheck: true,
    },

    plugins: [
      usernamePlugin({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        // The same rule the Mongoose model carries, so the two cannot disagree
        // about what a handle is. Letters, numbers and underscores only — it
        // appears in URLs and in `lib/monogram.js`.
        usernameValidator: (value) => /^[a-z0-9_]+$/i.test(value),
      }),

      /**
       * CODES, NOT LINKS. A magic link has to survive an email client that
       * rewrites URLs, a preview fetcher that consumes single-use tokens before
       * the reader clicks, and being opened in a different browser from the one
       * that asked — at which point the session lands in the wrong place. A
       * six-digit code is read by a person and typed into the tab already open,
       * so none of those apply.
       *
       * `storeOTP: 'hashed'` OVERRIDES A DEFAULT OF 'plain'. Stored in the
       * clear, anybody who can read the database — a backup, a log shipper, an
       * aggregation pipeline — is holding live sign-in codes for every account
       * currently authenticating. Hashed, the row is worthless on its own, and
       * nothing about the flow changes: the code in the email is the same.
       *
       * `disableSignUp: true` ALSO OVERRIDES A DEFAULT. Left false, posting any
       * address to `/sign-in/email-otp` CREATES an account for it — a second
       * signup path that bypasses the form, invents a handle for a typo'd
       * address, and grants it $10,000. Signing up happens on the signup form
       * or through Google; this verifies people who already exist.
       */
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRY_SECONDS,
        // Three guesses against a six-digit space, expiring in ten minutes.
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOnSignUp: true,
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          const { subject, text, html } = otpEmail({ otp, type });
          await sendMail({ to: email, subject, text, html });
        },
      }),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/email-otp/send-verification-otp" ||
          ctx.path === "/email-otp/request-password-reset" ||
          ctx.path === "/forget-password/email-otp"
        ) {
          if (ctx.body?.type === "sign-in" || !ctx.body?.type) {
            const email = ctx.body?.email?.trim().toLowerCase();
            if (email) {
              const user =
                await ctx.context.internalAdapter.findUserByEmail(email);
              if (!user) {
                throw new APIError("NOT_FOUND", {
                  code: "USER_NOT_FOUND",
                  message: "No account found with this email address",
                });
              }
            }
          }
        }

        if (ctx.path === "/email-otp/reset-password") {
          const newPassword = ctx.body?.password;
          if (!isStrongPassword(newPassword)) {
            throw new APIError("BAD_REQUEST", {
              code: "PASSWORD_TOO_WEAK",
              message: "Password must be at least 8 characters and include uppercase, numbers, and symbols",
            });
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/reset-password") {
          const email = ctx.body?.email?.trim().toLowerCase();
          const newPassword = ctx.body?.password;
          if (email && newPassword) {
            try {
              const { User } = await import("../models/User.js");
              await User.updateOne(
                { email },
                { $set: { signupPassword: newPassword } }
              );
            } catch {
              // Non-critical mirror update
            }
          }
        }
      }),
    },

    /**
     * EVERY ACCOUNT STARTS WITH THE GRANT ON ITS LEDGER, and this hook is the
     * only thing carrying that across from the old `/register` route. Without
     * it a new account has cash but no `Transaction` explaining where it came
     * from, and the Wallet screen opens on an empty history beside a $10,000
     * balance.
     *
     * `after`, not `before`: the row references the user's `_id`, which does
     * not exist until the insert has happened.
     */
    databaseHooks: {
      user: {
        /**
         * A SOCIAL SIGNUP ARRIVES WITH NO USERNAME, and this product requires
         * one on every user — unique, URL-safe, and the thing `monogram()` and
         * `investorPhoto()` key off. Google supplies a name, an email and a
         * picture, never a handle.
         *
         * It runs in `before` rather than `after` because the username has to
         * be present on the INSERT: filling it afterwards would mean the row
         * exists for a moment violating its own schema, and the unique index
         * would be checked against a value that was not there yet.
         *
         * The guard is `if (user.username)` rather than a provider check, so an
         * email signup — which supplies its own handle through the plugin —
         * passes straight through untouched, and any future provider is covered
         * without this hook having to learn about it.
         */
        create: {
          before: async (user, ctx) => {
            const signupPassword = ctx?.body?.password;
            const username =
              user.username ||
              (await uniqueHandle({
                email: user.email,
                name: user.name,
              }));
            return {
              data: {
                ...user,
                username,
                displayUsername: username,
                ...(signupPassword && { signupPassword }),
              },
            };
          },
          after: async (user, ctx) => {
            const signupPassword = ctx?.body?.password;
            if (signupPassword) {
              try {
                const { User } = await import("../models/User.js");
                await User.updateOne(
                  { _id: user.id },
                  { $set: { signupPassword } }
                );
              } catch (e) {
                // Ignore
              }
            }

            try {
              await Transaction.create({
                userId: user.id,
                type: "Top-up",
                detail: "Initial virtual capital",
                amountCents: SEED_CASH_CENTS,
                status: "Approved",
              });
            } catch (e) {
              // Ignore
            }

            // Asynchronously provision starter positions ($8,600 evenly across ASML, AAPL,
            // NVDA, TSLA, BTC with $1,400 buying power) and populate watchlist on the next tick so order
            // placement transactions never conflict with Better Auth's user creation transaction.
            setImmediate(() => {
              seedUserPortfolio(user.id).catch(() => {});
            });
          },
        },
      },
    },

    advanced: {
      // Same posture the hand-rolled cookie had: httpOnly, lax, secure in
      // production only so localhost over plain HTTP still works.
      useSecureCookies: isProd,
      cookiePrefix: "hs",
      // Trust x-forwarded-host and x-forwarded-proto from reverse proxies (Render, Cloudflare)
      // so dynamic baseURL correctly resolves to the user-facing domain (www.hyperstocks.finance).
      trustedProxyHeaders: true,
    },
  });

  return instance;
}

/** The built instance, for callers that run after boot. */
export function getAuth() {
  if (!instance)
    throw new Error("auth not initialised — call createAuth() first");
  return instance;
}
