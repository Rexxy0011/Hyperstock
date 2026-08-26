import { env } from '../config/env.js';

/**
 * What every message this product sends actually says.
 *
 * Copy lives here rather than at the call sites so the voice is consistent and
 * so a change to the footer is one edit rather than four. Plain text and HTML
 * are built from the same pieces for the same reason — a text part that drifts
 * from the HTML is the version half of the world reads.
 *
 * DELIBERATELY NOT IN THE i18n BUNDLES. Those are loaded in the browser from
 * the reader's own language setting; an email is composed on the server for
 * somebody who is not on the site, and the only language signal available is a
 * stored preference this product does not keep. English until there is a
 * per-user locale to key off — the same call the legal documents made, and for
 * a related reason.
 */

const BRAND = 'HyperStocks';

/**
 * Ten minutes. Declared here rather than in the plugin config because the copy
 * QUOTES it — "expires in 10 minutes" and the actual expiry drifting apart is
 * the kind of small lie that teaches people to distrust the rest of the mail.
 * `auth/betterAuth.js` reads this value; it is not repeated there.
 */
export const OTP_EXPIRY_SECONDS = 600;

/** Wraps a body in the one shell every message shares. */
const shell = (bodyText, { footer }) =>
  `${bodyText}\n\n—\n${BRAND}\n${footer}`;

/**
 * A one-time code, for sign-in, email verification or a password reset.
 *
 * THE THREE TYPES GET DIFFERENT SUBJECTS AND DIFFERENT SENTENCES, which is not
 * decoration: somebody who receives "Your sign-in code" when they asked to
 * reset a password has learned that a stranger is inside their account, and
 * somebody who receives a generic "Your code" has learned nothing at all. The
 * subject is the part most people read first and often the only part they read.
 *
 * The code is spaced (`123 456`) in the HTML only. In plain text it stays
 * unbroken so it can be copied in one go, and because some clients turn a
 * spaced run of digits into a phone number link.
 */
export function otpEmail({ otp, type }) {
  const reason = {
    'sign-in': {
      subject: `${otp} is your ${BRAND} sign-in code`,
      lead: `Use this code to sign in to ${BRAND}.`,
    },
    'email-verification': {
      subject: `${otp} is your ${BRAND} verification code`,
      lead: `Use this code to confirm your email address.`,
    },
    'forget-password': {
      subject: `${otp} is your ${BRAND} password reset code`,
      lead: `Use this code to choose a new password.`,
    },
    'change-email': {
      subject: `${otp} is your ${BRAND} confirmation code`,
      lead: `Use this code to confirm your new email address.`,
    },
  }[type] ?? {
    subject: `${otp} is your ${BRAND} code`,
    lead: `Use this code to continue.`,
  };

  /**
   * "If you didn't request this, ignore it" IS THE SECURITY NOTICE, and it has
   * to be specific about what ignoring achieves. A code that expires unused
   * grants nothing, and saying so is what stops somebody acting on a code they
   * did not ask for — which is exactly what an attacker who has guessed an
   * address is hoping they will do.
   */
  const text = shell(
    `${reason.lead}\n\n${otp}\n\n` +
      `The code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes and can only be used once.\n\n` +
      `If you did not request it, you can ignore this email — the code is useless on its own and nobody can act on it without it.`,
    { footer: 'Simulated trading. No real securities are bought or sold.' },
  );

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5">${reason.lead}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:.18em;font-variant-numeric:tabular-nums;padding:16px 0;text-align:center;background:#f5f6f7;border-radius:10px">
        ${String(otp).replace(/(\d{3})(?=\d)/g, '$1 ')}
      </div>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5c6470">
        The code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes and can only be used once.
      </p>
      <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#5c6470">
        If you did not request it, you can ignore this email — the code is useless on its own.
      </p>
      <hr style="border:0;border-top:1px solid #e4e7eb;margin:28px 0 16px">
      <p style="margin:0;font-size:12px;color:#8a929e">
        ${BRAND} — simulated trading. No real securities are bought or sold.
      </p>
    </div>`;

  return { subject: reason.subject, text, html };
}

/**
 * A newsletter send.
 *
 * THE UNSUBSCRIBE LINK IS NOT OPTIONAL AND IS NOT A COURTESY. The consent line
 * under the subscribe button was removed on the explicit grounds that people
 * "could unsubscribe from the emails" — so every email this product sends to a
 * marketing list has to carry the link that sentence promised. It is also what
 * CAN-SPAM requires and what keeps a sending domain out of spam folders.
 *
 * Keyed on the row's own token, never the address: an endpoint that unsubscribes
 * whatever address it is handed lets anyone remove anyone, and confirms whether
 * an address is on the list — the oracle the subscribe endpoint goes out of its
 * way not to be.
 *
 * `List-Unsubscribe` would be the next thing to add here; Gmail and Outlook
 * surface a one-click control from that header, and it is a deliverability
 * signal as much as a courtesy.
 */
export function newsletterEmail({ subject, body, unsubscribeToken }) {
  const url = `${env.CLIENT_ORIGIN}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const text = shell(`${body}\n\nUnsubscribe: ${url}`, {
    footer: 'Simulated trading. No real securities are bought or sold.',
  });

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <div style="font-size:15px;line-height:1.6">${body.replace(/\n/g, '<br>')}</div>
      <hr style="border:0;border-top:1px solid #e4e7eb;margin:28px 0 16px">
      <p style="margin:0 0 8px;font-size:12px;color:#8a929e">
        ${BRAND} — simulated trading. No real securities are bought or sold.
      </p>
      <p style="margin:0;font-size:12px;color:#8a929e">
        <a href="${url}" style="color:#8a929e">Unsubscribe</a>
      </p>
    </div>`;

  return { subject, text, html };
}
