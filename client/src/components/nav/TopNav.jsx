import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Link, { NavLink } from '../ui/Link';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { money, pct } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import Icon from '../ui/Icon';
import Button from '../ui/Button';
import Logo from '../ui/Logo';
import { NAV, SECONDARY, ADMIN } from './navItems';
import LanguageSwitcher from './LanguageSwitcher';

/**
 * The single navbar, used by the marketing shell and the signed-in dashboard
 * alike. It adapts to auth state rather than being duplicated:
 *   signed out -> Login / Get Started
 *   signed in  -> balance pill, notifications, account menu
 *
 * Web links are text-only by request; the icons live in the mobile drawer.
 */
export default function TopNav({ onOpenNav, bordered = true }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, authReady } = useAuth();

  return (
    // Pinned here rather than in the layouts, so both shells get it from one
    // place. z-30 sits above page content but deliberately below MobileDrawer's
    // z-40 — at equal levels the nav would paint over the drawer's own scrim.
    // bg-white is not optional: a sticky bar with no background lets the page
    // scroll through it.
    <header
      className={`sticky top-0 z-30 flex items-center gap-3 bg-white px-4 py-3 sm:gap-4 sm:px-5 lg:px-7 ${
        bordered ? 'border-b border-cool-grey/70' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={t('nav.menu')}
        className="-ml-1 shrink-0 cursor-pointer rounded-lg p-2 text-text-muted transition-colors hover:bg-hover hover:text-void lg:hidden"
      >
        <Icon name="menu" size={20} />
      </button>

      <Logo size={28} />

      <nav className="ml-2 hidden items-center gap-0.5 lg:flex">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
            {t(`nav.${item.key}`)}
          </NavLink>
        ))}
      </nav>

      {/* HIDDEN BELOW `sm`, because it is the only flexible item in this bar
          and every sibling is `shrink-0` — so it absorbs the whole squeeze and
          collapses instead of wrapping. Measured on the rendered nav: the input
          is 132px at 480, 66px at 414 (placeholder already clipped), **12px at
          360** and **0px at 320**, where the label itself is 26px — narrower
          than the magnifier inside it. A bordered box containing a clipped icon
          and nothing else reads as a rendering fault, not as a control.

          Nothing is lost by removing it there: this input does not search. Its
          only behaviour is `onFocus` → `/markets`, and the mobile drawer
          already carries a Market link, which is the same destination one tap
          away. `/markets` has its own real search on arrival.

          A min-width instead would only move the failure — at 320 there is no
          room for it to be honoured, so it would force the page to scroll
          sideways, which is worse than an absent shortcut.

          HIDDEN AGAIN FROM `lg` TO `xl`, which is not a typo. `lg` is where the
          desktop nav links appear, and measured signed in they take **353px** —
          so the search is squeezed a second time in exactly that band: 45px at
          1024, 121px at 1100, and only back to a usable 221px by 1200. The two
          gaps have the same cause (this is the sole flexible item in a row of
          `shrink-0` siblings) and therefore the same answer. `xl:flex` restores
          it at 1280, measured at 234px. */}
      <label className="ml-auto hidden min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-cool-grey/80 px-3 py-2 sm:flex lg:hidden lg:max-w-70 xl:flex xl:max-w-80">
        <Icon name="search" size={16} className="text-text-muted" />
        <input
          type="search"
          placeholder={t('nav.search')}
          onFocus={() => navigate('/markets')}
          className="min-w-0 flex-1 bg-transparent text-sm text-text-body outline-none placeholder:text-text-muted"
        />
      </label>

      {/* Beside the account cluster in both states: a visitor reading the
          marketing pages needs this at least as much as a signed-in user, and
          hiding it behind the account menu would put it behind a sign-in. */}
      {/* w-32, and the two step-ups behind that number are worth recording.
          It was w-24 (96px) before the flags; the flag takes 20px plus a 12px
          gap, so the code beside it truncated and it went to w-28. That was
          still one pixel short: measured, "УКР" needs 27px of label and w-28
          leaves 26, which is enough to trip `text-overflow: ellipsis` and
          render "У…" — a control naming nothing, in exactly the language whose
          reader depends on it. Do not trust `scrollWidth > clientWidth` to
          catch this; with ellipsis applied the two are equal, which is why the
          first check missed it. Measure the string against the box instead. */}
      <div className="hidden w-32 shrink-0 md:block">
        <LanguageSwitcher compact />
      </div>

      {/* THE ACCOUNT CLUSTER CARRIES THE AUTO MARGIN BELOW `sm`, because the
          search — which is what pushed everything here to the right — is not in
          the flow at that width. Without it the cluster packs against the logo
          and the freed space trails behind it, which reads as the nav having
          lost its right-hand side.

          The breakpoints MIRROR THE SEARCH'S VISIBILITY EXACTLY — auto where it
          is hidden, zero where it is shown — because the two must never both
          carry it: two auto margins in one row SPLIT the free space between
          them, leaving a gap in the middle rather than a bar that fills. So
          `sm:ml-0` hands the job to the search at 640, `lg:ml-auto` takes it
          back where the nav links crowd the search out, and `xl:ml-0` returns
          it once the search is restored. Measured before this mirrored the
          search: the `lg`–`xl` band left the cluster packed against the nav
          links with 204–380px of dead space trailing it.

          The gaps repeat the header's own `gap-3 sm:gap-4` so wrapping these
          two changes nothing visually — the signed-in pill and avatar sit
          exactly where they did. */}
      <div className="ml-auto flex shrink-0 items-center gap-3 sm:ml-0 sm:gap-4 lg:ml-auto xl:ml-0">
        {authReady && !user ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button to="/auth" variant="ghost" size="sm">
              {t('nav.login')}
            </Button>
            <Button to="/auth?mode=signup" size="sm">
              {t('nav.getStarted')}
            </Button>
          </div>
        ) : (
          <>
            <InvestmentPill />
            <AccountMenu />
          </>
        )}
      </div>
    </header>
  );
}

// `font-display` is opt-in here: the base rule in theme.css only puts Poppins
// on h1/h2/h3, so navigation would otherwise stay on the system stack while
// the rest of the marketing shell moved to Poppins.
const linkClass = ({ isActive }) =>
  [
    'rounded-lg px-3 py-2 font-display text-sm font-medium no-underline transition-colors',
    isActive ? 'bg-hover text-void' : 'text-text-muted hover:bg-hover hover:text-void',
  ].join(' ');

function InvestmentPill() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => get('/portfolio'),
    enabled: Boolean(user),
  });

  const s = data?.summary;
  if (!s) return null;

  return (
    <Link
      to="/portfolio"
      className="flex shrink-0 items-center gap-2 rounded-lg bg-ink px-2.5 py-2 no-underline sm:gap-2.5 sm:px-3"
    >
      <span className="hidden text-2xs text-text-on-deep-muted sm:inline">{t('nav.total')}</span>
      <span className="font-numeric text-sm font-bold tabular-nums text-white">
        {money(s.portfolioValueCents)}
      </span>
      <span
        className={`hidden font-numeric text-2xs font-semibold tabular-nums sm:inline ${
          s.allTimeReturnPct >= 0 ? 'text-gain' : 'text-loss'
        }`}
      >
        {pct(s.allTimeReturnPct)}
      </span>
    </Link>
  );
}

function AccountMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="relative ml-1 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 transition-colors hover:bg-hover"
      >
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-mist text-sm font-semibold text-void">
          {user?.avatarLetter ?? '?'}
        </span>
        <span className="hidden text-sm font-semibold text-void xl:block">{user?.username}</span>
        <Icon name="chevronDown" size={14} className="text-text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-cool-grey bg-white py-1 shadow-panel">
            <div className="border-b border-cool-grey px-3 py-2">
              <div className="truncate text-sm font-semibold">{user?.username}</div>
              <div className="truncate text-xs text-text-muted">{user?.email}</div>
            </div>

            {[...SECONDARY, ...(user?.role === 'admin' ? ADMIN : [])].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-body no-underline transition-colors hover:bg-hover"
              >
                <Icon name={item.icon} size={16} className="text-text-muted" />
                <span className="flex-1">{t(`nav.${item.key}`)}</span>
                {item.badge && (
                  <span className="inline-flex size-4 items-center justify-center rounded-md bg-loss text-2xs font-semibold text-white">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}

            <button
              type="button"
              onClick={() => logout().then(() => navigate('/'))}
              className="flex w-full cursor-pointer items-center gap-2.5 border-t border-cool-grey px-3 py-2 text-sm text-text-body transition-colors hover:bg-hover"
            >
              <Icon name="logout" size={16} className="text-text-muted" />
              {t('nav.logout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
