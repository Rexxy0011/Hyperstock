import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FcGoogle } from 'react-icons/fc';
import { FiLock, FiMail, FiUser } from 'react-icons/fi';
import { get } from '../lib/api';
import CodeForm from '../components/auth/CodeForm';
import { Navigate, useSearchParams } from 'react-router-dom';
import Link from '../components/ui/Link';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import SegmentedControl from '../components/ui/SegmentedControl';
import Logo from '../components/ui/Logo';
import { useAuth } from '../auth/AuthProvider';
import { WELCOME, withWelcome } from '../components/auth/WelcomeNotice';
import { ADMIN_HOME } from '../components/nav/navItems';

/**
 * THE VALUE IS STABLE, THE LABEL IS TRANSLATED, and separating them was a fix
 * rather than tidying. This used to be `['Sign in', 'Create account']`, doing
 * double duty as both the button text and the state, so `mode === MODES[1]`
 * compared a stored English string against whatever the control displayed.
 * Translating the labels in place would have made that comparison fail the
 * moment somebody changed language with the form open: `mode` still held the
 * old language's string, nothing matched, and the page silently dropped back
 * to Sign in with the typed details gone.
 *
 * Same reasoning as `navItems.js` carrying `key` apart from `label` — a value
 * derived from English copy breaks when the copy is reworded or translated.
 */
const SIGNIN = 'signin';
const SIGNUP = 'signup';

export default function Auth() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { user, authReady, login, register, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? SIGNUP : SIGNIN);
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
  /** Which confirmation to raise once the session lands, or null. */
  const [welcomeKind, setWelcomeKind] = useState(/** @type {string | null} */ (null));

  const isSignup = mode === SIGNUP;
  /**
   * WHERE SIGNING IN LANDS YOU. The default is the landing page, not the
   * portfolio.
   *
   * `?next=` STILL WINS, and that is the half that matters. `ProtectedRoute`
   * sends somebody here with the page they were trying to reach attached, so a
   * user who clicked through to `/withdraw` and got bounced to sign in still
   * arrives at `/withdraw` afterwards — changing the fallback must not break
   * the case where the destination was actually known.
   */
  const explicitNext = params.get('next');
  const next = explicitNext || '/';

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

  /**
   * ALREADY SIGNED IN? DON'T SHOW THE FORM AT ALL — and this redirect is also
   * what carries a fresh sign-in to its destination.
   *
   * It has to be, because it WINS THE RACE. `login()` resolving sets `user` in
   * the provider, which re-renders this component and fires this `<Navigate>`
   * before the `navigate()` after the await ever runs — so a marker appended
   * there was silently dropped and the toast never fired. `welcomeKind` is set
   * BEFORE the await, so by the time `user` lands it is already here.
   *
   * Null when somebody merely arrives on /auth with a live session: that is not
   * a sign-in and must not announce one.
   */
  if (authReady && user) {
    /**
     * AN OPERATOR LANDS IN THE ADMIN SECTION, everybody else on the landing
     * page. The role is only knowable HERE — `next` is computed before anyone
     * has signed in, while this branch runs with `user` already resolved.
     *
     * `?next=` still outranks both. `ProtectedRoute` attaches the page somebody
     * was bounced from, and an admin who clicked `/withdraw` meant `/withdraw`;
     * a convenience default must never override a destination that was actually
     * known.
     *
     * THE GOOGLE LEG CANNOT DO THIS and deliberately does not try. Its
     * `callbackURL` is fixed before the round trip, when there is no session to
     * read a role from — so an admin signing in with Google lands on `/` and
     * reaches the section from the nav, which renders for them either way.
     */
    const destination = explicitNext || (user.role === 'admin' ? ADMIN_HOME : '/');
    return (
      <Navigate
        to={welcomeKind ? withWelcome(destination, welcomeKind) : destination}
        replace
      />
    );
  }

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      // Does not return — it navigates to Google. `busy` stays true so the
      // button cannot be pressed twice while the redirect is in flight.
      await signInWithGoogle(withWelcome(next, WELCOME.signIn));
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
      // Set before the await: the redirect above fires the instant `user`
      // lands, which is sooner than anything after this line.
      setWelcomeKind(isSignup ? WELCOME.signUp : WELCOME.signIn);
      if (isSignup) {
        await register({ username: form.username, email: form.email, password: form.password });
      } else {
        await login({ email: form.email, password: form.password });
      }
    } catch (err) {
      setWelcomeKind(null);
      setError(err.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center bg-mist px-4 py-10 sm:py-16">
      <div className="w-full max-w-105">
        {/* The mark sits ABOVE the card rather than inside it. Inside, it
            competed with the heading for the top of the card and pushed the
            form down; outside, it identifies the page and lets the card open
            on the thing the visitor came to do. */}
        <div className="mb-7 flex justify-center">
          <Logo size={44} withWordmark={false} to={null} />
        </div>

        {/*
          `rounded-xl` and `shadow-panel`, not the `rounded-md`/`shadow-card`
          this used to carry. Those are the table-and-tile pair used across the
          dashboard, where a card is one of twenty on screen; this is a single
          object on an empty field and the softer, larger pairing is what stops
          it reading as a widget that lost its page. The padding went from 24 to
          32/40 for the same reason.
        */}
        <div className="animate-rise rounded-xl border border-cool-grey bg-white p-8 shadow-panel sm:p-10">

          {codeFlow ? (
            <CodeForm
              purpose={codeFlow}
              /* The address already typed is carried across. Asking for it a
                 second time on the next screen is the kind of small friction
                 that makes a recovery flow feel like a punishment. */
              initialEmail={form.email}
              onCancel={() => setCodeFlow(null)}
              onSuccess={() => setWelcomeKind(WELCOME.signIn)}
            />
          ) : (
          <>
          <SegmentedControl
            options={[
              { value: SIGNIN, label: t('auth.signIn') },
              { value: SIGNUP, label: t('auth.signUp') },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            size="sm"
            className="mb-7 w-full [&>button]:flex-1"
          />

          {/* KEYED ON THE MODE so the fade actually replays. React would
              otherwise reuse these nodes and just swap their text, and a CSS
              animation on an element that never remounts runs exactly once —
              the first switch would animate and every one after it would snap. */}
          <div key={mode} className="animate-swap">
            <h1 className="m-0 text-2xl font-medium">
              {isSignup ? t('auth.createAccount') : t('auth.welcomeBack')}
            </h1>
            <p className="mt-2 mb-7 text-sm text-text-muted">
              {isSignup ? t('auth.signupLead') : t('auth.signinLead')}
            </p>
          </div>

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
            {/*
              `grid-template-rows: 0fr -> 1fr`, the same technique the FAQ
              accordion uses, because `height: auto` is not animatable and the
              usual `max-height` workaround makes the field open at the speed of
              whatever arbitrary maximum was guessed.
              `invisible` rather than unmounting: the input must leave the tab
              order and the form's required-field set while collapsed, and
              `visibility` does both without costing the animation its element.
            */}
            <div
              data-auth-collapse
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isSignup ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className={`overflow-hidden ${isSignup ? '' : 'invisible'}`}>
                <Input
                  label={t('auth.username')}
                  placeholder={t('auth.usernamePlaceholder')}
                  autoComplete="username"
                  icon={<FiUser size={16} />}
                  required={isSignup}
                  disabled={!isSignup}
                  {...field('username')}
                />
              </div>
            </div>

            <Input
              label={t('auth.email')}
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              icon={<FiMail size={16} />}
              required
              {...field('email')}
            />

            {/* `revealable` matters most on signup, where a typo creates the
                account with the wrong password and there is no second chance to
                notice — but it is on both, since a blind retype is the commonest
                reason a correct credential gets rejected on a phone. */}
            <Input
              label={t('auth.password')}
              type="password"
              placeholder="••••••••"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              icon={<FiLock size={16} />}
              revealable
              required
              {...field('password')}
            />

            {error && (
              <div className="rounded-md border border-cool-grey bg-red-tint px-3 py-2 text-xs text-loss">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={busy}>
              {isSignup ? t('auth.signUp') : t('auth.signIn')}
            </Button>
          </form>

          {/* A TINTED STRIP, NOT A BORDERED BUTTON. With a border it carried the
              same weight as Continue with Google and sat directly beneath the
              primary action, so the card ended in three controls that all looked
              equally like the thing to press. It is a convenience for looking
              around the product, so it recedes. */}
          {!isSignup && (
            <button
              type="button"
              onClick={() => {
                setForm({ username: '', email: 'jd@hyperstocks.app', password: 'password123' });
                setError(null);
              }}
              className="mt-3 w-full cursor-pointer rounded-lg bg-mist py-2.5 text-xs text-text-muted transition-colors hover:bg-hover hover:text-void"
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

          {/*
            `<Trans>` RATHER THAN THREE KEYS SPLICED TOGETHER, and this sentence
            is the case that justifies it. It carries TWO links, so a
            pre/mid/post split would need three fragments whose order is fixed
            by the JSX — and that order is not fixed across languages. German is
            the proof: "Mit dem Fortfahren stimmen Sie unseren <terms>…</terms>
            und unserer <privacy>…</privacy> ZU", where the verb's particle
            lands after both links. No concatenation can express that.

            The components are NAMED, not indexed. `<0>`/`<1>` keys break
            silently the moment anybody reorders the JSX, and the failure there
            is a link pointing at the wrong document — on a consent line.

            Shown on BOTH modes by request. On sign-in "by continuing" is the
            weaker claim, but the terms govern using the account either way.
          */}
          <p className="mt-6 text-center text-xs leading-relaxed text-text-muted">
            <Trans
              i18nKey="auth.termsNotice"
              components={{
                terms: (
                  <Link
                    to="/terms"
                    className="text-text-body underline underline-offset-2 hover:text-gain"
                  />
                ),
                privacy: (
                  <Link
                    to="/privacy"
                    className="text-text-body underline underline-offset-2 hover:text-gain"
                  />
                ),
              }}
            />
          </p>
        </div>

        {/* Outside the card, not in it: it qualifies the whole screen rather
            than the form, and inside it would be the last thing read before the
            submit button. */}
        <p className="mt-6 text-center text-xs text-text-muted">
          {t('auth.disclaimer')}
        </p>
      </div>
    </div>
  );
}

