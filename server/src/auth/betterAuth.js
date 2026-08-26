import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { username as usernamePlugin } from 'better-auth/plugins';
import { env, SEED_CASH_CENTS, isProd } from '../config/env.js';
import { supportsTransactions } from '../config/db.js';
import { Transaction } from '../models/Transaction.js';

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
    baseURL: `http://localhost:${env.PORT}`,
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
      // No mail transport exists in this repo, so requiring verification would
      // lock out every account that ever registered. The flag is here, named,
      // so the decision is visible rather than defaulted into.
      requireEmailVerification: false,
      minPasswordLength: 8,
      password,
    },

    user: { additionalFields },

    plugins: [
      usernamePlugin({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        // The same rule the Mongoose model carries, so the two cannot disagree
        // about what a handle is. Letters, numbers and underscores only — it
        // appears in URLs and in `lib/monogram.js`.
        usernameValidator: (value) => /^[a-z0-9_]+$/i.test(value),
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
        create: {
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
