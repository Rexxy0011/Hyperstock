import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import Link from '../components/ui/Link';
import { FiFacebook, FiInstagram, FiYoutube } from 'react-icons/fi';
import TopNav from '../components/nav/TopNav';
import MobileDrawer from '../components/nav/MobileDrawer';
import Logo from '../components/ui/Logo';

/**
 * The marketing shell. It shares the app's navbar rather than carrying a
 * reduced one, so navigation is identical everywhere; TopNav swaps the account
 * cluster for Login / Get Started when signed out.
 */
export default function PublicLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <>
      <TopNav onOpenNav={() => setDrawerOpen(true)} />

      <main>
        <Outlet />
      </main>

      <SiteFooter />

      {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
    </>
  );
}

/**
 * The footer, as KEYS. Labels are translated at render; the routes and the
 * grouping are structure. Keys rather than English strings so a reworded
 * label cannot silently orphan every other language's translation of it.
 *
 * LEGAL COMES FIRST AND IS THE ONLY COLUMN WHERE EVERY LINK RESOLVES. All six
 * documents are real pages. The Product and Resources columns this replaced
 * were twelve links to routes that do not exist — on a site that now publishes
 * risk disclosures, a dead link sitting beside a real one teaches the reader
 * that these are decoration.
 *
 * `external: true` marks a `mailto:`, which is NOT a route: Security and
 * Support are mostly places to reach a person, and an address is a working
 * destination today where a "Security Center" page is not.
 *
 * OBJECTS RATHER THAN TUPLES, for the reason `SOCIALS` below already records: a
 * mixed `[string, string, object]` tuple widens to a union under `checkJs` and
 * then fails on every element at the call site.
 */
const FOOTER_COLUMNS = [
  {
    key: 'legal',
    links: [
      { label: 'privacy', to: '/privacy' },
      { label: 'financialPrivacy', to: '/financial-privacy' },
      { label: 'terms', to: '/terms' },
      { label: 'cookies', to: '/cookies' },
      { label: 'riskDisclosure', to: '/risk-disclosure' },
      { label: 'disclosures', to: '/disclosures' },
    ],
  },
  {
    key: 'security',
    links: [
      // "Account Security" is the Disclosures section that covers it, not a
      // page that does not exist — an anchor to real text beats a 404.
      { label: 'accountSecurity', to: '/disclosures' },
      // A security report is an ADDRESS, not a screen. Shipping this one as a
      // dead link is the worst of the set: somebody with a vulnerability to
      // report is exactly who must not hit "Not found".
      { label: 'reportIssue', to: 'mailto:security@hyperstocks.app', external: true },
    ],
  },
  {
    key: 'support',
    links: [
      { label: 'faq', to: '/faqs' },
      { label: 'contactSupport', to: 'mailto:support@hyperstocks.app', external: true },
      { label: 'about', to: '/about' },
    ],
  },
];

/**
 * The bottom bar keeps the three documents people look for by reflex. The full
 * set lives in the Legal column above; this is a shortcut, not the index — and
 * `DashboardLayout` renders the same row, where there is no column to fall back
 * on.
 */
export const BOTTOM_LINKS = [
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['disclosures', '/disclosures'],
];

/**
 * The real profiles. These were four `href="#"` placeholders — X, Instagram,
 * LinkedIn and GitHub — and were the last dead links in the footer.
 *
 * ONLY THE THREE THAT EXIST ARE LISTED. X, LinkedIn and GitHub had no URL
 * supplied, and a social icon that goes nowhere is worse than a missing one: it
 * looks like a channel somebody could follow and silently is not. Add them back
 * here the moment there is somewhere for them to point.
 *
 * The Facebook URL arrived with a trailing `#`, which is an empty fragment on
 * an external page — dropped, since it navigates to exactly the same place and
 * only survives copy-paste.
 *
 * Objects rather than tuples: a mixed [string, IconType, string] tuple widens
 * to `string | IconType` under checkJs, which then fails on both `key` and
 * `href`.
 */
const SOCIALS = [
  { label: 'Facebook', Icon: FiFacebook, href: 'https://www.facebook.com/hyperstocks' },
  { label: 'Instagram', Icon: FiInstagram, href: 'https://www.instagram.com/hyperstocks/' },
  {
    label: 'YouTube',
    Icon: FiYoutube,
    href: 'https://www.youtube.com/channel/UCFGgrokJj_MkRwKDwbywGGg',
  },
];

export function SiteFooter() {
  const { t } = useTranslation();
  return (
    // bg-ink, full bleed. This is the fourth use of the same deep surface —
    // nav balance pill, ticker tape, Markets table, footer — so it reads as
    // one surface returning rather than a new colour. No top border: the
    // colour change is the separation, and a cool-grey rule on near-black
    // reads as an artefact.
    <footer className="bg-ink text-text-on-deep">
      <div className="mx-auto max-w-300 px-8 pt-16 pb-10">
        {/* Brand block and link grid are two siblings pushed apart, not four
            equal columns — that is what stops the three short lists sitting on
            top of a block of dead space. */}
        <div className="flex flex-col gap-14 lg:flex-row lg:justify-between lg:gap-16">
          <div className="lg:max-w-110">
            <Logo size={28} />

            {/* Written for this product rather than transcribed: the reference
                describes a data-visualisation tool, which would be false here.
                Same shape — one sentence, two lines, em-dash turn. */}
            <p className="mt-6 mb-0 font-display text-base leading-relaxed font-normal text-text-on-deep-muted">
              {t('footer.blurb')}
            </p>

            {/* Bare glyphs, no chrome — as in the reference. Boxed icons read
                as more buttons competing with the links beside them. */}
            <div className="mt-8 flex gap-5">
              {SOCIALS.map(({ label, Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  // They leave the site, so they open in a new tab — and
                  // `noopener` is not optional with `target="_blank"`: without
                  // it the opened page gets a `window.opener` handle back into
                  // this one. Browsers imply it now; stating it is what makes
                  // that independent of the browser.
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="text-text-on-deep-muted transition-colors hover:text-text-on-deep"
                >
                  <Icon size={19} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-3 lg:gap-x-14">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.key} className="flex flex-col gap-3.5">
                <span className="mb-0.5 font-display text-base font-bold text-text-on-deep">
                  {t(`footer.${col.key}`)}
                </span>
                {col.links.map(({ label, to, external }) => {
                  const className =
                    'font-display text-base text-text-on-deep-muted no-underline transition-colors hover:text-text-on-deep';
                  // A mailto is not a route, so it must not go through Link —
                  // the router would try to navigate to it and fail.
                  return external ? (
                    <a key={label} href={to} className={className}>
                      {t(`footer.${label}`)}
                    </a>
                  ) : (
                    <Link key={label} to={to} className={className}>
                      {t(`footer.${label}`)}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Copyright left, legal links right and underlined — the reference's
            bottom bar, which carries no disclaimer block above it. */}
        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-8 font-display text-xs text-text-on-deep-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">{t('footer.rights', { year: 2026 })}</p>

          <div className="flex flex-wrap gap-x-7 gap-y-2">
            {BOTTOM_LINKS.map(([label, to]) => (
              <Link
                key={label}
                to={to}
                className="text-text-on-deep-muted underline underline-offset-2 transition-colors hover:text-text-on-deep"
              >
                {t(`footer.${label}`)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
