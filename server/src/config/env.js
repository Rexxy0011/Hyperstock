import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Env is validated once, at import time, and fails fast with a readable list of
 * problems. Everything downstream imports `env` and can trust it.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

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
  API_ORIGIN: z.string().default(''),

  // Blank means "start an in-memory replica set" — see config/db.js
  MONGODB_URI: z.string().default(''),

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
    .default('dev-better-auth-secret-change-me-0123456789'),

  /**
   * GOOGLE OAUTH. Both halves are optional and default to empty: the provider
   * is registered only when both are present, so a clone with no Google project
   * boots normally and simply does not offer the button. Registering it with an
   * empty client id fails at the moment somebody presses it, on a Google error
   * page, which is the worst place to learn an env var is missing.
   */
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

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
  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('HyperStocks <onboarding@resend.dev>'),

  /**
   * SUPERSEDED BY BETTER AUTH and kept only because a deployed `.env` still
   * carries them. Nothing reads these now: sessions are rows in `sessions`, not
   * self-contained JWTs, so there is no access token to sign and no refresh
   * token to rotate. Delete them once no environment sets them.
   */
  JWT_ACCESS_SECRET: z.string().min(8).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(8).default('dev-refresh-secret-change-me'),

  MARKET_DATA_PROVIDER: z.enum(['yahoo', 'finnhub', 'mock']).default('yahoo'),
  MARKET_DATA_API_KEY: z.string().default(''),

  // News. FINNHUB_API_KEY is the one to set; MARKET_DATA_API_KEY is accepted as
  // a fallback because when MARKET_DATA_PROVIDER is 'finnhub' it holds the same
  // vendor's key, and having two names for one credential is how people end up
  // filling in the wrong box.
  //
  // 'rss' forces the keyless Nasdaq feed, which is also where an unset key, a
  // rejected key or a vendor outage lands. 'none' disables market news
  // entirely, leaving /news as announcements only.
  NEWS_PROVIDER: z.enum(['finnhub', 'rss', 'none']).default('finnhub'),
  FINNHUB_API_KEY: z.string().default(''),
  NEWS_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  /** How long a cached article stays servable. */
  NEWS_TTL_MS: z.coerce.number().int().positive().default(15 * 60_000),
  /** Floor between vendor calls for the same feed — the real quota guard. */
  NEWS_MIN_FETCH_MS: z.coerce.number().int().positive().default(5 * 60_000),

  // Markets. Crypto and forex are keyless; live equity quotes reuse
  // FINNHUB_API_KEY and only reach the US symbols the free tier allows.
  MARKET_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  // Non-US equity quotes. Free key from twelvedata.com — there is no demo
  // path, `apikey=demo` 401s. Unset means the six non-US exchanges keep their
  // seeded prices, which is what they did before this provider existed.
  TWELVEDATA_API_KEY: z.string().default(''),
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
  DEPOSIT_DESTINATIONS: z.string().default('[]'),

  /**
   * A readable alternative to the JSON blob above.
   *
   * DEPOSIT_DESTINATIONS is a single line of JSON holding twelve objects — over
   * 1,700 characters — and hand-editing that is where a misplaced brace turns
   * into a boot failure, or worse, a wrong character in a treasury address. A
   * path here loads the same array from a pretty-printed file instead.
   *
   * It takes PRECEDENCE over the inline value when set. The file must be
   * gitignored for the same reason the inline value lives in env: an address in
   * source cannot be rotated without a deploy and leaks into every clone.
   */
  DEPOSIT_DESTINATIONS_FILE: z.string().default(''),
  /** Confirmations before a detected payment is put in front of a reviewer. */
  DEPOSIT_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(1),
  /** An unpaid deposit stops being quotable after this long. */
  DEPOSIT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  /** Shown on the payment screen for an amount that does not match the quote. */
  SUPPORT_EMAIL: z.string().trim().default('support@hyperstocks.app'),

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
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
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
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
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
export const DEPOSIT_DESTINATIONS = (() => {
  let raw;
  let source = 'DEPOSIT_DESTINATIONS';
  let text = env.DEPOSIT_DESTINATIONS;

  if (env.DEPOSIT_DESTINATIONS_FILE) {
    source = env.DEPOSIT_DESTINATIONS_FILE;
    try {
      text = readFileSync(resolve(env.DEPOSIT_DESTINATIONS_FILE), 'utf8');
    } catch (err) {
      // A path that was set and cannot be read is a misconfiguration, never a
      // reason to silently fall back to the inline value — that would serve
      // whatever addresses happened to be in env while the operator believes
      // the file is live.
      console.error(`Refusing to start: cannot read ${source} — ${err?.message ?? err}`);
      process.exit(1);
    }
  }

  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`Refusing to start: ${source} is not valid JSON.`);
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error('Refusing to start: DEPOSIT_DESTINATIONS must be a JSON array.');
    process.exit(1);
  }
  for (const d of raw) {
    if (!d?.asset || !d?.network || !d?.address) {
      console.error(
        'Refusing to start: every DEPOSIT_DESTINATIONS entry needs asset, network and address.',
      );
      process.exit(1);
    }
  }
  return raw;
})();

export const isProd = env.NODE_ENV === 'production';

/**
 * The API's own origin, with the development fallback applied.
 *
 * A getter rather than a literal in `betterAuth.js`, so exactly one place
 * decides it and the production guard below has something to check.
 */
export const apiOrigin = env.API_ORIGIN || `http://localhost:${env.PORT}`;

if (isProd) {
  for (const key of ['BETTER_AUTH_SECRET']) {
    if (env[key].startsWith('dev-')) {
      console.error(`Refusing to start: ${key} is still the development default.`);
      process.exit(1);
    }
  }

  /**
   * A PRODUCTION DEPLOY POINTING AT LOCALHOST IS BROKEN IN A WAY THAT ONLY
   * SHOWS WHEN SOMEBODY TRIES TO SIGN IN WITH GOOGLE — consent succeeds, and
   * the redirect goes to a machine that is not on the internet. Refusing at
   * boot turns a confusing user-facing failure into an obvious startup one.
   */
  if (apiOrigin.includes('localhost') || apiOrigin.includes('127.0.0.1')) {
    console.error(
      'Refusing to start: API_ORIGIN is unset or points at localhost. ' +
        'Set it to this API\'s public URL — the Google callback is derived from it.',
    );
    process.exit(1);
  }
}
