import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { errorMessage } from '../../lib/apiError';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * The one-time-code flow, for signing in and for resetting a password.
 *
 * CODES RATHER THAN LINKS, which is a UX decision before it is a security one.
 * A magic link has to survive an email client that rewrites URLs, a preview
 * fetcher that burns a single-use token before the reader ever clicks, and being
 * opened in a different browser from the one that asked — where the session then
 * lands in the wrong place and the original tab sits there waiting forever. A
 * six-digit code is read by a person and typed into the tab already open.
 *
 * ONE COMPONENT FOR BOTH PURPOSES because the shape is identical — ask for an
 * address, then ask for what arrived — and the only difference is one extra
 * field on the second step. Two components would be two places to keep the
 * resend timer, the attempt handling and the back button in step.
 *
 * @param {object} props
 * @param {'sign-in'|'reset'} props.purpose
 * @param {string=} props.initialEmail carried over from the form behind this
 * @param {() => void} props.onCancel
 * @param {() => void} props.onSuccess
 */
export default function CodeForm({ purpose, initialEmail = '', onCancel, onSuccess }) {
  const { t } = useTranslation();
  const { requestCode, signInWithCode, resetPasswordWithCode } = useAuth();

  const [step, setStep] = useState(/** @type {'email'|'code'} */ ('email'));
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);

  /**
   * Seconds until another code can be asked for.
   *
   * A RESEND BUTTON WITH NO COOLDOWN IS AN EMAIL-BOMBING TOOL — each press is a
   * message to an address the presser does not have to own. It also burns the
   * sending quota and trains the provider to treat the domain as a spammer. Sixty
   * seconds is long enough to matter and short enough that somebody whose code
   * genuinely did not arrive is not stuck.
   */
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Moving to the code step should put the cursor in the code box — the whole
  // point of a code is that it is typed, and making somebody click first is a
  // step the flow does not need.
  const codeRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const isReset = purpose === 'reset';

  const send = async (e) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestCode({ email: email.trim(), purpose });
      setStep('code');
      setCooldown(60);
    } catch (err) {
      // Through `errorMessage`, so the CODE is the translation key — Better
              // Auth's own strings are developer English ("Invalid OTP") and do
              // not translate. It falls back to the server sentence, never to a
              // bare code.
              setError(errorMessage(err, t('auth.code.sendFailed')));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isReset) {
        await resetPasswordWithCode({ email: email.trim(), otp: otp.trim(), password });
      } else {
        await signInWithCode({ email: email.trim(), otp: otp.trim() });
      }
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, t('auth.code.wrong')));
      // The code stays in the box on failure. Clearing it makes a mistyped
      // digit indistinguishable from an expired code, and forces a full retype
      // of five characters that were right.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="m-0 text-2xl font-medium">
        {t(isReset ? 'auth.code.resetTitle' : 'auth.code.signInTitle')}
      </h1>

      <p className="mt-2 mb-6 text-sm text-text-muted">
        {step === 'email'
          ? t(isReset ? 'auth.code.resetLead' : 'auth.code.signInLead')
          : /* The address is repeated back because it is the thing most likely
               to be wrong, and because somebody staring at an empty inbox needs
               to be able to check it without leaving the step. */
            t('auth.code.sentTo', { email: email.trim() })}
      </p>

      {step === 'email' ? (
        <form onSubmit={send} className="flex flex-col gap-4">
          <Input
            label={t('auth.email')}
            type="email"
            required
            autoComplete="email"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" className="w-full" loading={busy}>
            {t('auth.code.send')}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <Input
            ref={codeRef}
            label={t('auth.code.label')}
            /**
             * `inputMode="numeric"` brings up the digit pad on a phone without
             * `type="number"`, which would add spinners, strip a leading zero
             * and let the value be scrolled. `autoComplete="one-time-code"` is
             * what lets iOS and Android offer the code straight from the
             * notification — the single biggest thing that makes a code flow
             * feel faster than a link.
             */
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="000000"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            code
          />

          {isReset && (
            <Input
              label={t('auth.code.newPassword')}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button type="submit" className="w-full" loading={busy}>
            {t(isReset ? 'auth.code.resetSubmit' : 'auth.code.signInSubmit')}
          </Button>

          <button
            type="button"
            onClick={send}
            disabled={cooldown > 0 || busy}
            className="cursor-pointer text-center text-xs text-text-muted underline underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-60"
          >
            {cooldown > 0 ? t('auth.code.resendIn', { seconds: cooldown }) : t('auth.code.resend')}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={step === 'code' ? () => setStep('email') : onCancel}
        className="mt-4 w-full cursor-pointer text-center text-xs text-text-muted hover:text-void"
      >
        {step === 'code' ? t('auth.code.changeEmail') : t('auth.code.back')}
      </button>
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <div className="rounded-md border border-cool-grey bg-red-tint px-3 py-2 text-xs text-loss">
      {children}
    </div>
  );
}
