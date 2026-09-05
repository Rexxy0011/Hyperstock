import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { z } from "zod";

/**
 * Env is validated once, at import time, and fails fast with a readable list of
 * problems. Everything downstream imports `env` and can trust it.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),

  /**
   * Where THIS API is reachable from the public internet.
   *
   * Better Auth derives absolute URLs from it, and the one that matters is the
   * OAuth callback: `{API_ORIGIN}/api/auth/callback/google` is what gets sent
   * to Google and what must be registered in the Cloud Console. Left at the
   * localhost default in production, consent succeeds and Google redirects the
   * user to a machine that is not there.
   *
   * NOT the client's URL and NOT a mail subdomain. If the API is deployed
   * separately from the front end these are three different hosts.
   *
   * Empty means "derive from PORT", which is right in development and refused
   * in production below.
   */
  API_ORIGIN: z.string().default(""),

  // Blank means "start an in-memory replica set" — see config/db.js
  MONGODB_URI: z.string().default(""),

  /**
   * Better Auth signs session tokens with this. `min(32)` is its own floor, not
   * an arbitrary one — below it the library logs a low-entropy warning at every
   * boot, and a warning nobody can act on is a warning everybody learns to
   * ignore. The development default is deliberately long enough to clear the
   * check and obviously fake enough that `isProd` below refuses it.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default("dev-better-auth-secret-change-me-0123456789"),

  /**
   * THE OPERATOR ACCOUNT. The one seeded user with `role: 'admin'`, and so the
   * only credential in this database that can reach `/admin/*` — the approvals
   * queues, the user list, the featured-trader board.
   *
   * IT IS CONFIGURATION RATHER THAN A LITERAL IN `seed.js` because an admin
   * password committed to a repository is an admin password on every clone,
   * every fork and every screenshot of the file. The seed still has to run on a
   * machine that has never been configured, so both carry the previous
   * hardcoded values as DEFAULTS — the zero-config path is unchanged and
   * `npm run seed` on a fresh clone still produces a usable operator.
   *
   * The default password is refused in production by the `isProd` block below,
   * which is the same treatment `BETTER_AUTH_SECRET` gets and for the same
   * reason: a development default that survives a deploy is not a warning
   * anybody reads, it is an open door.
   *
   * CHANGING `ADMIN_EMAIL` AFTER SEEDING DOES NOT MOVE THE EXISTING ACCOUNT.
   * The seed upserts on `username: 'admin'`, so the address is updated in
   * place on the next run — but a database seeded under the old address keeps
   * it until `npm run seed` runs again.
   */
  ADMIN_EMAIL: z.string().trim().toLowerCase().default("admin@hyperstocks.app"),
  ADMIN_PASSWORD: z.string().min(8).default("password123"),

  /**
   * GOOGLE OAUTH. Both halves are optional and default to empty: the provider
   * is registered only when both are present, so a clone with no Google project
   * boots normally and simply does not offer the button. Registering it with an
   * empty client id fails at the moment somebody presses it, on a Google error
   * page, which is the worst place to learn an env var is missing.
   */
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),

  /**
   * EMAIL. Optional: with no key the mailer prints messages to the terminal in
   * development instead of sending, so a fresh clone can still complete a
   * code-based sign-in. In production a missing key is reported as the
   * misconfiguration it is and nothing is printed — the body of a sign-in mail
   * is a live one-time code.
   *
   * MAIL_FROM must be an address on a domain verified with the provider, and
   * a SUBDOMAIN is the right choice: `send.hyperstocks.app` keeps a newsletter
   * that gets spam-flagged from poisoning the reputation that password resets
   * depend on.
   */
  RESEND_API_KEY: z.string().default(""),
  MAIL_FROM: z.string().default("HyperStocks <support@hyperstocks.finance>"),

  /**
   * SUPERSEDED BY BETTER AUTH and kept only because a deployed `.env` still
   * carries them. Nothing reads these now: sessions are rows in `sessions`, not
   * self-contained JWTs, so there is no access token to sign and no refresh
   * token to rotate. Delete them once no environment sets them.
   */
  JWT_ACCESS_SECRET: z.string().min(8).default("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(8).default("dev-refresh-secret-change-me"),

  MARKET_DATA_PROVIDER: z.enum(["yahoo", "finnhub", "mock"]).default("yahoo"),
  MARKET_DATA_API_KEY: z.string().default(""),

  // News. FINNHUB_API_KEY is the one to set; MARKET_DATA_API_KEY is accepted as
  // a fallback because when MARKET_DATA_PROVIDER is 'finnhub' it holds the same
  // vendor's key, and having two names for one credential is how people end up
  // filling in the wrong box.
  //
  // 'rss' forces the keyless Nasdaq feed, which is also where an unset key, a
  // rejected key or a vendor outage lands. 'none' disables market news
  // entirely, leaving /news as announcements only.
  NEWS_PROVIDER: z.enum(["finnhub", "rss", "none"]).default("finnhub"),
  FINNHUB_API_KEY: z.string().default(""),
  NEWS_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  /** How long a cached article stays servable. */
  NEWS_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
  /** Floor between vendor calls for the same feed — the real quota guard. */
  NEWS_MIN_FETCH_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),

  // Markets. Crypto and forex are keyless; live equity quotes reuse
  // FINNHUB_API_KEY and only reach the US symbols the free tier allows.
  MARKET_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  // Non-US equity quotes. Free key from twelvedata.com — there is no demo
  // path, `apikey=demo` 401s. Unset means the six non-US exchanges keep their
  // seeded prices, which is what they did before this provider existed.
  TWELVEDATA_API_KEY: z.string().default(""),
  /** Floor between vendor calls per asset class — the quota guard, as for news. */
  MARKET_MIN_FETCH_MS: z.coerce.number().int().positive().default(60_000),
  QUOTE_REFRESH_MS: z.coerce.number().int().positive().default(15_000),
  QUOTE_FULL_REFRESH_MS: z.coerce.number().int().positive().default(60_000),
  QUOTE_MAX_AGE_MS: z.coerce.number().int().positive().default(120_000),
  MAX_SLIPPAGE_PCT: z.coerce.number().positive().default(0.5),

  // Configured in whole dollars for readability; converted to cents at the
  // boundary below so nothing downstream ever sees a float amount.
  SEED_CASH: z.coerce.number().positive().default(10_000),
  MAX_TOPUP_AMOUNT: z.coerce.number().positive().default(5_000),
  /**
   * Top-ups at or below this are credited immediately; anything larger queues
   * for review. See wallet.service.js for why there is a threshold at all
   * rather than one rule for everything.
   */
  AUTO_TOPUP_LIMIT: z.coerce.number().nonnegative().default(1_000),

  /**
   * Crypto deposit destinations, as JSON: `[{asset,network,address,minAmount}]`.
   *
   * CONFIGURATION, NEVER A LITERAL. A treasury address in source is wrong three
   * ways over — it cannot be rotated without a deploy, it leaks into every
   * clone and screenshot of the repository, and a typo in it sends real funds
   * somewhere unrecoverable. Empty by default, and `deposit.service.js` refuses
   * to open a crypto deposit while it is empty, so no screen can instruct
   * anyone to send money until an operator has deliberately configured where.
   */
  DEPOSIT_DESTINATIONS: z.string().default("[]"),

  /**
   * Which chains payouts may be SENT on, as JSON.
   *
   * DECOUPLED FROM DEPOSITS ON PURPOSE. Payout networks used to be derived from
   * `DEPOSIT_DESTINATIONS`, on the reasoning that if we can receive USDT on
   * TRC20 then we hold it there and can send it back. That coupling is true for
   * the assets we custody, but it caps payouts at the receiving list — and
   * there is no reason the two must match: an operator holding BTC can pay it
   * out on Lightning, or hold a treasury on a chain nobody deposits to.
   *
   * Unlike a deposit destination, THERE IS NO ADDRESS HERE. The user supplies
   * theirs; this only says which {asset, network} pairs are offered.
   *
   * Empty means "derive from DEPOSIT_DESTINATIONS", which is the previous
   * behaviour and stays the default so nothing changes for a deployment that
   * does not set it.
   */
  WITHDRAWAL_NETWORKS: z.string().default("[]"),

  /** Confirmations before a detected payment is put in front of a reviewer. */
  DEPOSIT_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(1),
  /** An unpaid deposit stops being quotable after this long. */
  DEPOSIT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  /** Shown on the payment screen for an amount that does not match the quote. */
  SUPPORT_EMAIL: z.string().trim().default("support@hyperstocks.finance"),

  /**
   * Tawk.to live chat. Empty property id means no chat, and the client asks
   * before it renders anything — the same shape as `googleEnabled`, for the
   * same reason: a control that cannot work must not be drawn.
   *
   * NEITHER OF THESE TWO IS A SECRET. They sit in the embed URL that every
   * visitor's browser fetches, so there is nothing to protect and they are
   * handed to the client deliberately. They live here rather than in a
   * `client/.env` because that would be a SECOND place to configure one
   * feature, which is the failure `DEPOSIT_DESTINATIONS` records under ONE
   * SOURCE, AND THAT IS DELIBERATE.
   */
  TAWK_PROPERTY_ID: z.string().trim().default(""),
  /** Tawk's own default widget is literally named `default`. */
  TAWK_WIDGET_ID: z.string().trim().default("default"),

  /**
   * OPTIONAL, AND OFF BY DEFAULT. Tawk's "secure mode" key, from
   * Administration -> Channels -> Chat Widget.
   *
   * Chat works fully without it. What it changes is whether the operator may
   * TRUST the name beside the conversation: `setAttributes` runs in the
   * browser, so unsigned attributes are self-asserted and somebody could open a
   * console and claim another account's address. With a key set the server
   * HMACs the address and Tawk refuses an unsigned one.
   *
   * Left empty the config response says `verified: false`, so which mode is
   * running is reported rather than guessed.
   */
  TAWK_API_KEY: z.string().trim().default(""),

  /**
   * WITHDRAWALS ARE OFF UNLESS AN OPERATOR TURNS THEM ON, and the default is
   * `false` for a reason that is not caution about the code.
   *
   * Every position this product opens is simulated and there is no custody
   * behind any of it — approving a payout means a human sends real funds from a
   * real wallet against a balance that was never backed by one. The flow below
   * is complete and correct as a workflow; what does not exist is the treasury
   * it would draw on. This flag is the switch that keeps the two facts from
   * being confused by accident.
   */
  WITHDRAWALS_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Floor per payout, in dollars. Below this the network fee dominates. */
  MIN_WITHDRAWAL_AMOUNT: z.coerce.number().positive().default(20),
  /** Ceiling per payout, in dollars — a manual review process has a limit. */
  MAX_WITHDRAWAL_AMOUNT: z.coerce.number().positive().default(10_000),
  /** A user may not stack unbounded payouts on the queue. */
  MAX_OPEN_WITHDRAWALS: z.coerce.number().int().positive().default(3),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

/** Money constants in the unit the ledger actually uses. */
export const SEED_CASH_CENTS = Math.round(env.SEED_CASH * 100);
export const MAX_TOPUP_CENTS = Math.round(env.MAX_TOPUP_AMOUNT * 100);
export const AUTO_TOPUP_LIMIT_CENTS = Math.round(env.AUTO_TOPUP_LIMIT * 100);
export const MIN_WITHDRAWAL_CENTS = Math.round(env.MIN_WITHDRAWAL_AMOUNT * 100);
export const MAX_WITHDRAWAL_CENTS = Math.round(env.MAX_WITHDRAWAL_AMOUNT * 100);

/**
 * Parsed once at boot and validated, so a malformed value fails loudly here
 * rather than at the moment a user is being told where to send money.
 */
/**
 * The chains payouts may be sent on.
 *
 * REFUSES TO BOOT ON A NETWORK WITH NO ADDRESS RULE. `checkAddress()` falls back
 * to a length check for an unknown network, and that is not a check — this
 * project already shipped a $3,937 payout request to
 * `gdghsdhjsdhdjsdksjdhdjsjdujdu` because of it. Offering a chain the validator
 * does not know is therefore a configuration error, caught here rather than at
 * the moment somebody pastes an address nothing will verify.
 */
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export const WITHDRAWAL_NETWORKS = (() => {
  let raw;
  try {
    if (env.WITHDRAWAL_NETWORKS && env.WITHDRAWAL_NETWORKS !== "[]") {
      raw = JSON.parse(env.WITHDRAWAL_NETWORKS);
    } else {
      const filePath = [
        path.join(serverRoot, "withdrawal-networks.json"),
        path.join(projectRoot, "withdrawal-networks.json"),
      ].find((p) => fs.existsSync(p));
      if (filePath) {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } else {
        raw = [];
      }
    }
  } catch {
    console.error("Refusing to start: WITHDRAWAL_NETWORKS is not valid JSON.");
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error(
      "Refusing to start: WITHDRAWAL_NETWORKS must be a JSON array."
    );
    process.exit(1);
  }
  for (const n of raw) {
    if (!n?.asset || !n?.network) {
      console.error(
        "Refusing to start: every WITHDRAWAL_NETWORKS entry needs asset and network."
      );
      process.exit(1);
    }
  }
  return raw;
})();

export const DEPOSIT_DESTINATIONS = (() => {
  let raw;
  try {
    if (env.DEPOSIT_DESTINATIONS && env.DEPOSIT_DESTINATIONS !== "[]") {
      raw = JSON.parse(env.DEPOSIT_DESTINATIONS);
    } else {
      const filePath = [
        path.join(serverRoot, "deposit-destinations.json"),
        path.join(projectRoot, "deposit-destinations.json"),
      ].find((p) => fs.existsSync(p));
      if (filePath) {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } else {
        raw = [];
      }
    }
  } catch {
    console.error("Refusing to start: DEPOSIT_DESTINATIONS is not valid JSON.");
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error(
      "Refusing to start: DEPOSIT_DESTINATIONS must be a JSON array."
    );
    process.exit(1);
  }
  for (const d of raw) {
    if (!d?.asset || !d?.network || !d?.address) {
      console.error(
        "Refusing to start: every DEPOSIT_DESTINATIONS entry needs asset, network and address."
      );
      process.exit(1);
    }
  }
  return raw;
})();

export const isProd = env.NODE_ENV === "production";

/**
 * The API's own origin, with the development fallback applied.
 *
 * A getter rather than a literal in `betterAuth.js`, so exactly one place
 * decides it and the production guard below has something to check.
 */
export const apiOrigin = env.API_ORIGIN || `http://localhost:${env.PORT}`;

export const getTrustedOrigins = () => {
  const configured = (env.CLIENT_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const defaults = [
    "https://hyperstocks.finance",
    "https://www.hyperstocks.finance",
    "http://hyperstocks.finance",
    "http://www.hyperstocks.finance",
    "https://*.hyperstocks.finance",
    "http://*.hyperstocks.finance",
    "http://localhost:5173",
    "http://localhost:4000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4000",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://*.onrender.com",
  ];

  if (apiOrigin) {
    try {
      defaults.push(new URL(apiOrigin).origin);
    } catch {}
  }

  return Array.from(new Set([...configured, ...defaults]));
};

export const trustedOriginsList = getTrustedOrigins();

export const isTrustedOrigin = (origin) => {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, "");
  if (trustedOriginsList.includes(normalized)) return true;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    // Any hyperstocks.finance subdomain or root domain
    if (
      hostname === "hyperstocks.finance" ||
      hostname.endsWith(".hyperstocks.finance")
    ) {
      return true;
    }

    // Localhost or loopback on any port
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }

    // Render preview / staging
    if (hostname.endsWith(".onrender.com")) {
      return true;
    }

    // Any configured wildcard patterns
    for (const pattern of trustedOriginsList) {
      if (pattern.includes("*")) {
        const regex = new RegExp(
          "^" +
            pattern
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*") +
            "$",
          "i"
        );
        if (regex.test(normalized)) return true;
      }
    }
  } catch {}

  return false;
};

if (isProd) {
  for (const key of ["BETTER_AUTH_SECRET"]) {
    if (env[key].startsWith("dev-")) {
      console.error(
        `Refusing to start: ${key} is still the development default.`
      );
      process.exit(1);
    }
  }

  /**
   * THE SEEDED ADMIN PASSWORD IS PUBLISHED IN THIS REPOSITORY — it is in
   * CLAUDE.md, in the seed's own terminal output and in every clone. Shipping
   * it to production means the approvals queues, the user list and the featured
   * board are reachable by anybody who has read the source.
   *
   * Checked by VALUE rather than by a `dev-` prefix, because unlike the auth
   * secret this default is an ordinary-looking password and nothing about it
   * announces itself as a placeholder.
   */
  if (env.ADMIN_PASSWORD === "password123") {
    console.error(
      "Refusing to start: ADMIN_PASSWORD is still the development default."
    );
    process.exit(1);
  }

  /**
   * A PRODUCTION DEPLOY POINTING AT LOCALHOST IS BROKEN IN A WAY THAT ONLY
   * SHOWS WHEN SOMEBODY TRIES TO SIGN IN WITH GOOGLE — consent succeeds, and
   * the redirect goes to a machine that is not on the internet. Refusing at
   * boot turns a confusing user-facing failure into an obvious startup one.
   */
  if (apiOrigin.includes("localhost") || apiOrigin.includes("127.0.0.1")) {
    console.error(
      "Refusing to start: API_ORIGIN is unset or points at localhost. " +
        "Set it to this API's public URL — the Google callback is derived from it."
    );
    process.exit(1);
  }
}
