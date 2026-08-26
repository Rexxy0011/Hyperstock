import { useTranslation } from 'react-i18next';
import { NavLink } from '../ui/Link';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { money, pct } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import Icon from '../ui/Icon';
import Button from '../ui/Button';
import Logo from '../ui/Logo';
import LanguageSwitcher from './LanguageSwitcher';
import { NAV, SECONDARY, ADMIN } from './navItems';

const itemClass = ({ isActive }) =>
  [
    'flex items-center gap-3 rounded-lg px-3 py-2.5 font-display text-sm font-medium no-underline transition-colors',
    isActive ? 'bg-hover text-void' : 'text-text-muted hover:bg-hover hover:text-void',
  ].join(' ');

/**
 * The sidebar layout from the reference design, preserved for phone and tablet
 * where a vertical nav genuinely belongs. Icons stay here — only the web nav
 * drops them.
 */
export default function MobileDrawer({ onClose }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => get('/portfolio'),
    enabled: Boolean(user),
  });
  const s = data?.summary;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />

      <aside className="absolute inset-y-0 left-0 flex w-62 flex-col overflow-y-auto bg-panel px-4 py-5 shadow-panel">
        <div className="mb-5 flex items-center justify-between">
          <span onClick={onClose}>
            <Logo size={28} />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.close')}
            className="cursor-pointer rounded-lg p-1.5 text-text-muted hover:bg-hover"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {s && (
          <div className="relative overflow-hidden rounded-xl bg-ink px-4 py-3.5">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.18]"
              style={{
                background:
                  'radial-gradient(120% 90% at 85% 0%, rgba(255,255,255,.55), transparent 60%)',
              }}
            />
            <div className="relative">
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xs text-text-on-deep-muted">{t('nav.totalInvestment')}</span>
                <span
                  className={`font-numeric text-2xs font-semibold tabular-nums ${
                    s.allTimeReturnPct >= 0 ? 'text-gain' : 'text-loss'
                  }`}
                >
                  {pct(s.allTimeReturnPct)}
                </span>
              </div>
              <div className="mt-1 font-numeric text-[17px] font-bold tabular-nums text-white">
                {money(s.portfolioValueCents)}
              </div>
            </div>
          </div>
        )}

        {!user && (
          <div className="flex flex-col gap-2">
            <Button to="/auth?mode=signup" onClick={onClose} className="w-full">
              {t('nav.getStarted')}
            </Button>
            <Button to="/auth" onClick={onClose} variant="secondary" className="w-full">
              {t('nav.login')}
            </Button>
          </div>
        )}

        <nav className="mt-5 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={onClose} className={itemClass}>
              <Icon name={item.icon} />
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}

        </nav>

        {/* THE ONLY LANGUAGE CONTROL BELOW 768px. TopNav's is `hidden md:block`,
            so before this the switcher simply did not exist on a phone: the
            product shipped four languages and no way to reach three of them on
            the device most likely to want one. It sits above the secondary
            links rather than among them because it is a control, not a
            destination, and it is full width here where the nav slot is not,
            so it shows the language's own name instead of a two-letter code. */}
        <div className="mt-auto border-t border-cool-grey/70 pt-4">
          <LanguageSwitcher />
        </div>

        <div className="mt-4 flex flex-col gap-1 border-t border-cool-grey/70 pt-4">
          {[...SECONDARY, ...(user?.role === 'admin' ? ADMIN : [])].map((item) => (
            <NavLink key={item.to} to={item.to} onClick={onClose} className={itemClass}>
              <Icon name={item.icon} />
              <span className="flex-1">{t(`nav.${item.key}`)}</span>
              {item.badge && (
                <span className="inline-flex size-4 items-center justify-center rounded-md bg-loss text-2xs font-semibold text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </aside>
    </div>
  );
}
