import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import Link from '../components/ui/Link';
import TopNav from '../components/nav/TopNav';
import MobileDrawer from '../components/nav/MobileDrawer';
import Logo from '../components/ui/Logo';
import { assets } from '../assets/assets';

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
 * EVERY LINK IN THESE COLUMNS RESOLVES. The Product and Resources columns this
 * replaced were twelve links to routes that do not exist — on a site that now
 * publishes risk disclosures, a dead link sitting beside a real one teaches the
 * reader that these are decoration.
 *
 * THE LEGAL COLUMN AND THE BOTTOM BAR NO LONGER REPEAT EACH OTHER. Terms, Cookie
 * Policy and Disclosures live in the bar; the column carries the other two plus
 * the Risk Disclosure. A link in both places reads as two different
 * destinations, which is what the split avoids.
 *
 * The one deliberate exception is the PRIVACY POLICY, which appears in both —
 * it is the document people go looking for, and it is the only one worth the
 * cost of being in two places. "Account Security" in the Security column also
 * resolves to `/disclosures`, but under its own label and pointing at the
 * section that covers it, so it does not read as a repeat.
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
      { label: 'riskDisclosure', to: '/risk-disclosure' },
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
 * The bottom bar. No longer a shortcut duplicating the column above it — these
 * four are the only place Terms, the Cookie Policy and Disclosures appear in
 * this shell.
 *
 * COOKIE POLICY IS HERE RATHER THAN NOWHERE. It came out of the Legal column
 * with Terms and Disclosures, but unlike those two it was not already in this
 * row — dropping it would have left the document reachable only through an
 * inline cross-reference inside the Privacy Policy, which is not a place anyone
 * looks for a cookie policy.
 *
 * `DashboardLayout` renders this same row, and there is no Legal column there
 * at all, so anything missing from this list is missing entirely for a
 * signed-in user.
 */
export const BOTTOM_LINKS = [
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['cookies', '/cookies'],
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
 * THE MARKS ARE IMAGES NOW, NOT FEATHER GLYPHS. They are the platforms' own
 * logos, so they are recognised rather than read — which is the entire job of a
 * social row. It does mean the row is three colour chips instead of three
 * monochrome outlines, so the note below about boxed icons competing with the
 * links no longer applies: they carry their own colour and sit apart from the
 * text by that alone.
 *
 * `src` rather than `Icon`: a component and a URL are not interchangeable, and
 * the old prop name would have quietly rendered `<Icon>` as an unknown element.
 */
const SOCIALS = [
  { label: 'Facebook', src: assets.icons.facebook, href: 'https://www.facebook.com/hyperstocks' },
  {
    label: 'Instagram',
    src: assets.icons.instagram,
    href: 'https://www.instagram.com/hyperstocks/',
  },
  {
    label: 'YouTube',
    src: assets.icons.youtube,
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

            {/* 22px rather than the glyphs' 19: these are filled marks inside
                their own rounded shape, so the artwork sits further from the
                edge of the box than an outline does and the same nominal size
                reads smaller. Gap tightened to match. */}
            <div className="mt-8 flex gap-4">
              {SOCIALS.map(({ label, src, href }) => (
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
                  // Full colour at rest — muting a brand mark to grey defeats
                  // the reason for using the real one. The hover is a small
                  // opacity lift rather than a colour change, which an image
                  // cannot do.
                  className="opacity-90 transition-opacity hover:opacity-100"
                >
                  <img
                    src={src}
                    alt=""
                    aria-hidden="true"
                    width={22}
                    height={22}
                    loading="lazy"
                    className="size-5.5 object-contain"
                  />
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
