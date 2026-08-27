import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNav from '../components/nav/TopNav';
import MobileDrawer from '../components/nav/MobileDrawer';
import Link from '../components/ui/Link';
import { BOTTOM_LINKS } from './PublicLayout';

/**
 * The signed-in shell.
 *
 * Structurally identical to PublicLayout — full-bleed white page, nav across the
 * top, content filling the viewport — so navigating between marketing and app
 * pages doesn't change the frame. The earlier grey-canvas floating panel came
 * from the reference mockup, but it inset the app by ~32px on every side and
 * made the dashboard read as narrower than the home page.
 */
export default function DashboardLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close on navigation, or the drawer hangs over the new page.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    /**
     * A FULL-HEIGHT FLEX COLUMN, and the footer depends on it.
     *
     * Without `min-h-screen flex-col` here the footer's `mt-auto` has no flex
     * parent to push against, so on a page barely taller than the viewport it
     * lands just below the fold and reads as missing — measured on the
     * instrument page: footer top 978px against a 900px viewport, in a document
     * only 1045px tall. Present, correct, and invisible without a scroll nobody
     * knows to make.
     */
    <div className="flex min-h-screen flex-col">
      <TopNav onOpenNav={() => setDrawerOpen(true)} />

      {/* Padding belongs to the pages: they also render inside PublicLayout
          when signed out, which has none. No `pb-10` here — that existed to
          stop content ending flush against the viewport when this shell had no
          footer. It now doubles up with the pages' own `py-10` and pushes the
          footer 40px further below the fold for nothing. */}
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>

      <AppFooter />

      {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

/**
 * A slim footer for the signed-in shell — NOT `SiteFooter`.
 *
 * Signed out these pages render inside PublicLayout and get the full marketing
 * footer: brand block, socials, a three-column sitemap. Dropping that into the
 * app would put "Pricing" and "Careers" under a live price chart and make the
 * product read as a landing page again, which is the exact split AdaptiveLayout
 * exists to maintain.
 *
 * What was genuinely missing is the part that belongs everywhere: who owns the
 * page, the legal links, and the fact that none of this is real money. The
 * disclaimer is the reason this is worth having at all — a simulated trading
 * product should say so on every screen where someone can press Buy, not only
 * on the ones a signed-out visitor sees.
 */
function AppFooter() {
  return (
    <footer className="mt-auto border-t border-cool-grey px-4 py-6 sm:px-5 lg:px-7 2xl:px-9">
      <div className="flex flex-col gap-3 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0">
          &copy; 2026 HyperStocks.
        </p>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {BOTTOM_LINKS.map(([label, to]) => (
            <Link
              key={label}
              to={to}
              className="text-text-muted underline underline-offset-2 transition-colors hover:text-text-body"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
