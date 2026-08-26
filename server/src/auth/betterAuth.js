import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { username as usernamePlugin, emailOTP } from 'better-auth/plugins';
import { env, SEED_CASH_CENTS, isProd, apiOrigin } from '../config/env.js';
import { supportsTransactions } from '../config/db.js';
import { Transaction } from '../models/Transaction.js';
import { uniqueHandle } from './handle.js';
import { sendMail } from '../lib/mailer.js';
import { otpEmail, OTP_EXPIRY_SECONDS } from '../lib/emails.js';

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
  displayName: { type: /** @type {const} */ ('string'), required: false, input: false },
  role: { type: /** @type {const} */ ('string'), required: false, defaultValue: 'user', input: false },
  status: { type: /** @type {const} */ ('string'), required: false, defaultValue: 'Active', input: false },
  cashBalanceCents: {
    type: /** @type {const} */ ('number'),
    required: false,
    defaultValue: SEED_CASH_CENTS,
    input: false,
  },
  tradeCount: { type: /** @type {const} */ ('number'), required: false, defaultValue: 0, input: false },
};

/**
 * Whether the Google provider can actually work. Exported so the client can be
 * told, rather than rendering a button that bounces the user to a Google error
 * page when the credentials are absent.
 */
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * Builds the instance. MUST be called after `connectDb()` — it borrows that
 * connection rather than opening a second one, so the auth writes and the
 * app's own writes share a pool, a replica set and a transaction session.
 */
export function createAuth() {
  if (instance) return instance;

  const connection = mongoose.connection;
  if (!connection?.db) {
    throw new Error('createAuth() called before connectDb() — no mongoose connection');
  }

  instance = betterAuth({
    appName: 'HyperStocks',
    // Its own secret rather than the old JWT one, which was `min(8)` and made
    // Better Auth warn about low entropy on every boot. The env schema pins
    // this at its 32-character floor and production refuses the dev default.
    secret: env.BETTER_AUTH_SECRET,
    // NOT hardcoded to localhost: the Google callback URL is derived from this,
    // so a production deploy with the dev value sends users to a machine that
    // is not on the internet. `config/env.js` refuses to boot on that in prod.
    baseURL: apiOrigin,
    basePath: '/api/auth',
    // The browser is a different origin in development (Vite on 5173 proxying
    // to 4000), so it has to be trusted explicitly or the cookie is refused.
    trustedOrigins: [env.CLIENT_ORIGIN],

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

    emailAndPassword: {
      enabled: true,
      /**
       * STILL FALSE, BUT NO LONGER FOR WANT OF A MAILER — there is one now, and
       * `/email-otp/send-verification-otp` will deliver a code to anyone who
       * asks. It stays off because turning it on locks every account created
       * before this out of its own portfolio until it verifies, and gates a
       * simulated-trading demo behind an inbox round trip to prevent fraud that
       * cannot happen: there is no real money and no payout without an operator.
       *
       * Verification is AVAILABLE and opt-in. Flip this to true the moment
       * anything of value hangs off an address being real.
       */
      requireEmailVerification: false,
      minPasswordLength: 8,
      password,
      /**
       * Password reset goes through the OTP plugin's own
       * `/email-otp/request-password-reset`, so no link-based `sendResetPassword`
       * is configured here. Two reset paths would be two things to keep in step
       * and two ways for the copy to disagree about what arrives.
       */
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
          prompt: 'select_account',
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
         */
        trustedProviders: ['google'],
      },
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
        storeOTP: 'hashed',
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          const { subject, text, html } = otpEmail({ otp, type });
          await sendMail({ to: email, subject, text, html });
        },
      }),
    ],

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
          before: async (user) => {
            if (user.username) return undefined;
            const username = await uniqueHandle({ email: user.email, name: user.name });
            // `displayUsername` is the username plugin's cased variant; left
            // unset it renders blank wherever the plugin prefers it.
            return { data: { ...user, username, displayUsername: username } };
          },
          after: async (user) => {
            await Transaction.create({
              userId: user.id,
              type: 'Top-up',
              detail: 'Initial virtual capital',
              amountCents: SEED_CASH_CENTS,
              status: 'Approved',
            });
          },
        },
      },
    },

    advanced: {
      // Same posture the hand-rolled cookie had: httpOnly, lax, secure in
      // production only so localhost over plain HTTP still works.
      useSecureCookies: isProd,
      cookiePrefix: 'hs',
    },
  });

  return instance;
}

/** The built instance, for callers that run after boot. */
export function getAuth() {
  if (!instance) throw new Error('auth not initialised — call createAuth() first');
  return instance;
}
