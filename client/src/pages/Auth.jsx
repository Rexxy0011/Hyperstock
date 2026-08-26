import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FcGoogle } from 'react-icons/fc';
import { get } from '../lib/api';
import CodeForm from '../components/auth/CodeForm';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import SegmentedControl from '../components/ui/SegmentedControl';
import Logo from '../components/ui/Logo';
import { useAuth } from '../auth/AuthProvider';

const MODES = ['Sign in', 'Create account'];

export default function Auth() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, authReady, login, register, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? MODES[1] : MODES[0]);
  // `email` is carried over from Landing's CTA, which collects it before
  // sending the visitor here — without this the field arrives empty and they
  // type it twice.
  const [form, setForm] = useState({
    username: '',
    email: params.get('email') ?? '',
    password: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === MODES[1];
  const next = params.get('next') || '/portfolio';

  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  /**
   * Whether the button can actually work. Rendering "Continue with Google" on a
   * deployment with no Google credentials configured produces a press that ends
   * on a Google error page — so the server is asked, and the button simply does
   * not exist when it would fail. `staleTime: Infinity` because this changes
   * when the server restarts, not while somebody is looking at a login form.
   */
  /** null, 'sign-in' or 'reset' — which code flow has replaced the form. */
  const [codeFlow, setCodeFlow] = useState(/** @type {null|'sign-in'|'reset'} */ (null));

  const { data: providers } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => get('/auth-providers'),
    staleTime: Infinity,
  });

  // Already signed in? Don't show the form at all.
  if (authReady && user) return <Navigate to={next} replace />;

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      // Does not return — it navigates to Google. `busy` stays true so the
      // button cannot be pressed twice while the redirect is in flight.
      await signInWithGoogle(next);
    } catch (err) {
      setError(err.message ?? 'Could not start Google sign-in.');
      setBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) {
        await register({ username: form.username, email: form.email, password: form.password });
      } else {
        await login({ email: form.email, password: form.password });
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center bg-mist px-4 py-16">
      <div className="w-full max-w-95">
        {/* Large enough for the disc's own wordmark to read, so no label. */}
        <div className="mb-6 flex justify-center">
          <Logo size={72} withWordmark={false} />
        </div>

        <div className="rounded-md border border-cool-grey bg-white p-6 shadow-card">
          {codeFlow ? (
            <CodeForm
              purpose={codeFlow}
              /* The address already typed is carried across. Asking for it a
                 second time on the next screen is the kind of small friction
                 that makes a recovery flow feel like a punishment. */
              initialEmail={form.email}
              onCancel={() => setCodeFlow(null)}
              onSuccess={() => navigate(next, { replace: true })}
            />
          ) : (
          <>
          <SegmentedControl
            options={MODES}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            size="sm"
            className="mb-6 w-full [&>button]:flex-1"
          />

          <h1 className="m-0 text-2xl font-medium">
            {isSignup ? t('auth.createAccount') : t('auth.welcomeBack')}
          </h1>
          <p className="mt-2 mb-6 text-sm text-text-muted">
            {isSignup
              ? 'Start trading eight exchanges in under a minute.'
              : 'Sign in to your portfolio.'}
          </p>

          {providers?.google && (
            <>
              <button
                type="button"
                onClick={onGoogle}
                disabled={busy}
                className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-cool-grey bg-white py-2.5 font-display text-sm font-medium transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-45"
              >
                {/* The real mark from react-icons, already in the bundle — the
                    same rule CoinIcon follows: never approximate a trademark by
                    hand, and never hotlink one either. */}
                <FcGoogle size={18} aria-hidden="true" />
                {t('auth.continueWithGoogle')}
              </button>

              {/* A rule with the word in it, not a bare line: two stacked
                  buttons with nothing between them read as one control group
                  rather than as two independent ways in. */}
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-cool-grey" />
                <span className="text-2xs text-text-muted uppercase">{t('auth.or')}</span>
                <span className="h-px flex-1 bg-cool-grey" />
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {isSignup && (
              <Input
                label={t('auth.username')}
                placeholder={t('auth.usernamePlaceholder')}
                autoComplete="username"
                required
                {...field('username')}
              />
            )}

            <Input
              label={t('auth.email')}
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              required
              {...field('email')}
            />

            <Input
              label={t('auth.password')}
              type="password"
              placeholder="••••••••"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              {...field('password')}
            />

            {error && (
              <div className="rounded-md border border-cool-grey bg-red-tint px-3 py-2 text-xs text-loss">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={busy}>
              {isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          {!isSignup && (
            <button
              type="button"
              onClick={() => {
                setForm({ username: '', email: 'jd@hyperstocks.app', password: 'password123' });
                setError(null);
              }}
              className="mt-3 w-full cursor-pointer rounded-lg border border-cool-grey py-2 text-xs text-text-muted transition-colors hover:text-void"
            >
              {t('auth.fillDemo')}
            </button>
          )}

          {isSignup ? (
            <p className="mt-4 text-center text-xs text-text-muted">
              {/* Interpolated, not concatenated: Ukrainian puts the amount in a
                  different place in the sentence than English does. */}
              {t('auth.grant', { amount: '$10,000' })}
            </p>
          ) : (
            /* BOTH OF THESE USED TO BE DEAD. "Forgot password" was a styled
               <span> that did nothing, because there was no mailer behind it;
               it opens the reset flow now. The code option sits beside it
               because the same machinery serves both. */
            <div className="mt-4 flex justify-center gap-5 text-xs">
              <button
                type="button"
                onClick={() => setCodeFlow('sign-in')}
                className="cursor-pointer text-text-muted underline underline-offset-2 hover:text-gain"
              >
                {t('auth.code.useCode')}
              </button>
              <button
                type="button"
                onClick={() => setCodeFlow('reset')}
                className="cursor-pointer text-text-muted underline underline-offset-2 hover:text-gain"
              >
                {t('auth.forgot')}
              </button>
            </div>
          )}
          </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          {t('auth.disclaimer')}
        </p>
      </div>
    </div>
  );
}
