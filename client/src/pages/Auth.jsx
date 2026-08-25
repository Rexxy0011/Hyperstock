import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { user, authReady, login, register } = useAuth();

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

  // Already signed in? Don't show the form at all.
  if (authReady && user) return <Navigate to={next} replace />;

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
            <p className="mt-4 text-center text-xs">
              <span className="cursor-pointer text-text-muted hover:text-gain">
                {t('auth.forgot')}
              </span>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          {t('auth.disclaimer')}
        </p>
      </div>
    </div>
  );
}
