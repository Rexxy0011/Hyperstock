import { env, isProd } from '../config/env.js';

/**
 * The only module that sends email.
 *
 * One owner, for the reason `lib/toast.js` owns notification durations and
 * `PriceChange` owns the signed percentage: two call sites picking their own
 * from-address, subject line or footer disagree, and on email an inconsistency
 * is not a rough edge — it is the difference between a message that looks like
 * the product and one that looks like phishing.
 *
 * NO SDK. Resend's API is a single POST, and `market/providers/*` already reach
 * their vendors with `fetch` directly; a dependency for one request would be
 * the odd one out. Node 22 has `fetch` globally.
 *
 * WITHOUT A KEY IT LOGS INSTEAD OF THROWING, which is what keeps a fresh clone
 * usable: `npm run dev` with no Resend account still lets somebody sign in with
 * a code, because the code is printed to the terminal. That is a development
 * affordance and it is gated — see `deliver()`.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Whether anything can actually be delivered. */
export const mailEnabled = Boolean(env.RESEND_API_KEY);

/**
 * Sends one message.
 *
 * Returns `{ ok, id, skipped }` rather than throwing on a vendor failure. A
 * password-reset request that 500s because a mail provider is down tells the
 * caller which addresses exist — every other outcome on that endpoint is a
 * deliberate 202. The caller decides what a failure means; this reports it.
 *
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled) {
    /**
     * NEVER IN PRODUCTION. The dev fallback prints the body, and the body of a
     * sign-in mail is a live one-time code — putting that in a production log
     * means anybody who can read logs can sign in as anybody. In production a
     * missing key is a misconfiguration, so it is reported as one and nothing
     * is printed.
     */
    if (isProd) {
      console.error(`mail: RESEND_API_KEY is not set — "${subject}" to ${to} was NOT sent`);
      return { ok: false, skipped: true };
    }
    // `warn`, not `log` — the repo's lint rule allows only warn and error on
    // the server, and the level is right anyway: this is reporting that
    // something which normally happens did not.
    console.warn(
      `\n  ── mail (not sent: no RESEND_API_KEY) ────────────────\n` +
        `  to:      ${to}\n  subject: ${subject}\n\n${text.replace(/^/gm, '  ')}\n` +
        `  ─────────────────────────────────────────────────────\n`,
    );
    return { ok: true, skipped: true };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        text,
        ...(html && { html }),
      }),
      // A hung mail provider must not hold a request open — the caller is a
      // person waiting on a form.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The body carries the vendor's reason; the SUBJECT is logged, never the
      // text, which may hold a one-time code.
      const detail = await response.text().catch(() => '');
      console.error(`mail: ${response.status} sending "${subject}" — ${detail.slice(0, 200)}`);
      return { ok: false, skipped: false };
    }

    const { id } = await response.json().catch(() => ({}));
    return { ok: true, id, skipped: false };
  } catch (err) {
    console.error(`mail: failed sending "${subject}" — ${err?.message ?? err}`);
    return { ok: false, skipped: false };
  }
}
