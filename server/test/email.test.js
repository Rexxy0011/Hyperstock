import test from 'node:test';
import assert from 'node:assert/strict';
import { otpEmail, newsletterEmail, OTP_EXPIRY_SECONDS } from '../src/lib/emails.js';
import { sendMail, mailEnabled } from '../src/lib/mailer.js';

/**
 * What the product actually puts in somebody's inbox.
 *
 * These need no database and no network: the mailer degrades to a console
 * fallback without a key, and the templates are pure functions. What is worth
 * pinning is the copy that carries an obligation — the unsubscribe link, the
 * expiry the sentence quotes, and the fact that a reset code never announces
 * itself as a sign-in.
 */
test('emails', async (t) => {
  await t.test('each OTP type gets its own subject and reason', () => {
    const signIn = otpEmail({ otp: '123456', type: 'sign-in' });
    const reset = otpEmail({ otp: '123456', type: 'forget-password' });
    const verify = otpEmail({ otp: '123456', type: 'email-verification' });

    assert.notEqual(signIn.subject, reset.subject);
    assert.notEqual(signIn.subject, verify.subject);

    /**
     * THE ONE THAT MATTERS. Somebody who asked to reset a password and receives
     * "your sign-in code" has just been told a stranger is in their account.
     */
    assert.match(reset.subject, /reset/i);
    assert.equal(/sign-in code/i.test(reset.subject), false);
    assert.match(signIn.subject, /sign-in/i);
  });

  await t.test('the code is in the subject, so it is readable from a notification', () => {
    const { subject } = otpEmail({ otp: '408212', type: 'sign-in' });
    assert.match(subject, /^408212/);
  });

  await t.test('the quoted expiry matches the configured one', () => {
    const { text, html } = otpEmail({ otp: '123456', type: 'sign-in' });
    const minutes = Math.round(OTP_EXPIRY_SECONDS / 60);
    assert.match(text, new RegExp(`expires in ${minutes} minutes`));
    assert.match(html, new RegExp(`expires in ${minutes} minutes`));
  });

  await t.test('the plain-text code is unbroken so it can be copied', () => {
    const { text, html } = otpEmail({ otp: '123456', type: 'sign-in' });
    assert.match(text, /\n123456\n/, 'text carries the digits as one run');
    // The HTML may space them for legibility; the text must not.
    assert.match(html, /123\s456/);
  });

  await t.test('every OTP mail carries the "ignore this" notice', () => {
    for (const type of ['sign-in', 'email-verification', 'forget-password']) {
      const { text } = otpEmail({ otp: '123456', type });
      assert.match(text, /did not request/i, `${type} explains what to do`);
    }
  });

  await t.test('an unknown type still produces a usable mail', () => {
    const { subject, text } = otpEmail({ otp: '123456', type: 'something-new' });
    assert.ok(subject.includes('123456'));
    assert.ok(text.includes('123456'));
  });

  /**
   * THE OBLIGATION THE REMOVED CONSENT LINE LEFT BEHIND. The sentence under the
   * subscribe button was deleted on the grounds that people "could unsubscribe
   * from the emails" — so every marketing mail has to carry the link that
   * promise depends on.
   */
  await t.test('a newsletter always carries an unsubscribe link', () => {
    const { text, html } = newsletterEmail({
      subject: 'Market wrap',
      body: 'Quiet week.',
      unsubscribeToken: 'tok_abc123',
    });
    assert.match(text, /Unsubscribe: http/i);
    assert.match(html, /Unsubscribe<\/a>/i);
    assert.ok(text.includes('tok_abc123'), 'keyed on the row token');
    assert.ok(html.includes('tok_abc123'));
  });

  await t.test('the unsubscribe link is keyed on the token, never the address', () => {
    const { text, html } = newsletterEmail({
      subject: 'x',
      body: 'y',
      unsubscribeToken: 'tok_xyz',
    });
    // An address in the link would make it an "unsubscribe anyone" endpoint and
    // an oracle for which addresses are on the list.
    assert.equal(/unsubscribe\?[^\s]*email=/i.test(text), false);
    assert.equal(/unsubscribe\?[^\s]*email=/i.test(html), false);
  });

  await t.test('a token with URL-unsafe characters is encoded', () => {
    const { text } = newsletterEmail({
      subject: 'x',
      body: 'y',
      unsubscribeToken: 'a b&c=d',
    });
    assert.ok(text.includes('a%20b%26c%3Dd'), 'the token is percent-encoded');
  });

  await t.test('messages carry hyperstocks.finance link tag in footer', () => {
    const otp = otpEmail({ otp: '123456', type: 'sign-in' });
    const news = newsletterEmail({ subject: 'x', body: 'y', unsubscribeToken: 't' });
    for (const { text, html } of [otp, news]) {
      assert.match(text, /hyperstocks\.finance/i);
      assert.match(html, /<a href="https:\/\/hyperstocks\.finance"[^>]*>hyperstocks\.finance<\/a>/i);
    }
  });

  /**
   * Without a key the mailer must not throw — a password-reset request that
   * 500s because mail is unconfigured is worse than one that quietly logs.
   */
  await t.test('sending without a key is reported, not thrown', async () => {
    assert.equal(mailEnabled, false, 'this suite runs with no RESEND_API_KEY');
    const result = await sendMail({
      to: 'someone@example.com',
      subject: 'test',
      text: 'body',
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  });
});
