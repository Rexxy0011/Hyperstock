import { env } from "../config/env.js";

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

const BRAND = "HyperStocks";
const SITE_URL = "https://hyperstocks.finance";
const SITE_LABEL = "hyperstocks.finance";

/**
 * Ten minutes. Declared here rather than in the plugin config because the copy
 * QUOTES it — "expires in 10 minutes" and the actual expiry drifting apart is
 * the kind of small lie that teaches people to distrust the rest of the mail.
 * `auth/betterAuth.js` reads this value; it is not repeated there.
 */
export const OTP_EXPIRY_SECONDS = 600;

/** Wraps a body in the one shell every message shares. */
const shell = (bodyText, { footer }) =>
  `${bodyText}\n\n--\n${BRAND}\n${footer}`;

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
    "sign-in": {
      subject: `${otp} is your ${BRAND} sign-in code`,
      title: "Sign in to your account",
      lead: `Use the verification code below to complete your sign-in to ${BRAND}.`,
      security: `If you did not request this code or attempt to sign in, please disregard this email and check your account security.`,
    },
    "email-verification": {
      subject: `${otp} is your ${BRAND} verification code`,
      title: "Verify your email address",
      lead: `Welcome to ${BRAND}. Enter the verification code below to confirm your email address and activate your trading account.`,
      security: `If you did not request this code or create an account, you can safely disregard this message.`,
    },
    "forget-password": {
      subject: `${otp} is your ${BRAND} password reset code`,
      title: "Reset your password",
      lead: `We received a request to reset the password for your ${BRAND} account. Enter the verification code below to proceed with setting a new password.`,
      security: `If you did not request a password reset, no action is needed — your account remains secure.`,
    },
    "change-email": {
      subject: `${otp} is your ${BRAND} confirmation code`,
      title: "Confirm your new email address",
      lead: `Use the verification code below to confirm this new email address for your ${BRAND} account.`,
      security: `If you did not request this change, you can safely disregard this message.`,
    },
  }[type] ?? {
    subject: `${otp} is your ${BRAND} code`,
    title: "Verification code",
    lead: `Use the verification code below to continue.`,
    security: `If you did not request this code, you can safely disregard this message.`,
  };

  const text = shell(
    `${reason.title}\n\n${reason.lead}\n\n${otp}\n\n` +
      `The code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes and can only be used once.\n\n` +
      `${reason.security}`,
    { footer: SITE_URL }
  );

  const html = `
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:36px 24px;color:#111;line-height:1.5">
      <div style="margin:0 0 24px">
        <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0d1117">${BRAND}</span>
      </div>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111;letter-spacing:-0.01em">${reason.title}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${reason.lead}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums;padding:18px 0;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;color:#111827">
        ${String(otp).replace(/(\d{3})(?=\d)/g, "$1 ")}
      </div>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280">
        The code expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes and can only be used once.
      </p>
      <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#6b7280">
        ${reason.security}
      </p>
      <hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0 16px">
      <p style="margin:0;font-size:12px;color:#8a929e">
        <a href="${SITE_URL}" style="color:#8a929e;text-decoration:none">${SITE_LABEL}</a>
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
  const primaryOrigin =
    (env.CLIENT_ORIGIN || "")
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.includes("hyperstocks.finance")) ||
    (env.CLIENT_ORIGIN || "").split(",")[0].trim() ||
    SITE_URL;
  const url = `${primaryOrigin}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const text = shell(`${body}\n\nUnsubscribe: ${url}`, {
    footer: SITE_URL,
  });

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <div style="font-size:15px;line-height:1.6">${body.replace(/\n/g, "<br>")}</div>
      <hr style="border:0;border-top:1px solid #e4e7eb;margin:28px 0 16px">
      <p style="margin:0 0 8px;font-size:12px;color:#8a929e">
        <a href="${SITE_URL}" style="color:#8a929e">${SITE_LABEL}</a>
      </p>
      <p style="margin:0;font-size:12px;color:#8a929e">
        <a href="${url}" style="color:#8a929e">Unsubscribe</a>
      </p>
    </div>`;

  return { subject, text, html };
}
