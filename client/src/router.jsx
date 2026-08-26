import { useLayoutEffect } from 'react';
import {
  createBrowserRouter,
  Outlet,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import ProtectedRoute from './auth/ProtectedRoute';
import Toasts from './components/ui/Toasts';
import MarketNotices from './components/market/MarketNotices';
import Fund from './pages/Fund';
import Withdraw from './pages/Withdraw';

import PublicLayout from './layouts/PublicLayout';
import DashboardLayout from './layouts/DashboardLayout';
import AdaptiveLayout from './layouts/AdaptiveLayout';

import Landing from './pages/Landing';
import About from './pages/About';
import Faqs from './pages/Faqs';
import LegalDocument from './pages/legal/LegalDocument';
import Auth from './pages/Auth';
import Markets from './pages/Markets';
import Leaderboard from './pages/Leaderboard';
import News from './pages/News';
import Instrument from './pages/Instrument';
import Portfolio from './pages/Portfolio';
import Admin from './pages/Admin';
import Approvals from './pages/Approvals';
import Subscribers from './pages/Subscribers';
import Users from './pages/Users';
import ComingSoon from './pages/ComingSoon';

/**
 * Suppresses smooth scrolling for the duration of a route change.
 *
 * `html` carries `scroll-behavior: smooth` so that anchors and any future
 * scroll-into-view animate. ScrollRestoration's jump to the top must not: it
 * uses `window.scrollTo(0, 0)`, which obeys that property, so without this the
 * visitor watches the new page scroll up from wherever the old one had been —
 * a full page-length animation of content they never asked to see.
 *
 * ORDER IS THE WHOLE MECHANISM. This must render BEFORE <ScrollRestoration/>
 * so that its layout effect runs first and the attribute is already on the
 * element when the router scrolls. Both are layout effects, and React runs
 * them in tree order — move this below and the guard silently stops working.
 *
 * requestAnimationFrame, not a timeout: the attribute has to survive the
 * router's scroll in the same frame and be gone before the next user gesture.
 */
function ScrollBehaviour() {
  const { key } = useLocation();

  useLayoutEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-navigating', '');
    const raf = requestAnimationFrame(() => el.removeAttribute('data-navigating'));
    return () => cancelAnimationFrame(raf);
  }, [key]);

  return null;
}

/**
 * Wraps the whole tree so useAuth() is available to every route element.
 *
 * `ScrollRestoration` is not a nicety here — without it React Router does
 * nothing about scroll at all, and where you land is decided by whether the
 * incoming page happens to have rendered tall enough yet. Measured before it
 * was added: /about at 4410px → /markets landed at 0 (the document collapsed
 * mid-swap and the browser clamped), while /markets at 1200px → /news landed
 * at 1200, halfway down a page the visitor had never seen.
 */
function Root() {
  return (
    <AuthProvider>
      <ScrollBehaviour />
      <ScrollRestoration />
      <Outlet />
      {/* Both render nothing. `MarketNotices` watches the feed and the session
          clock; `Toasts` is the surface they and every mutation write to. They
          live here rather than in a layout because a toast raised on one route
          must survive navigating to another — remounting the container would
          dismiss it mid-read. */}
      <MarketNotices />
      <Toasts />
    </AuthProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // Marketing only — the landing page sells the product, so it keeps the
      // public shell regardless of session.
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: <Landing /> },
          // Marketing regardless of session, like '/' — signing in does not
          // make the company page part of the app.
          { path: '/about', element: <About /> },
          // Marketing too, and public regardless of session — a signed-in user
          // asking how withdrawals work wants the same page as a visitor, and
          // the footer that carries support and legal links with it.
          { path: '/faqs', element: <Faqs /> },
          { path: '/auth', element: <Auth /> },
          // Legal documents are marketing-shell regardless of session: a
          // signed-in reader wants the same page as a visitor, plus the footer
          // that carries the rest of the legal links.
          { path: '/privacy', element: <LegalDocument id="privacy" /> },
          { path: '/financial-privacy', element: <LegalDocument id="financial-privacy" /> },
          { path: '/terms', element: <LegalDocument id="terms" /> },
          { path: '/cookies', element: <LegalDocument id="cookies" /> },
          { path: '/risk-disclosure', element: <LegalDocument id="risk-disclosure" /> },
          { path: '/disclosures', element: <LegalDocument id="disclosures" /> },
          { path: '*', element: <ComingSoon title="Not found" /> },
        ],
      },

      // Public content that becomes app content once you sign in.
      {
        element: <AdaptiveLayout />,
        children: [
          { path: '/markets', element: <Markets /> },
          { path: '/leaderboard', element: <Leaderboard /> },
          // Readable signed out, like /markets — announcements and headlines
          // are not account data.
          { path: '/news', element: <News /> },
          // Market data is public, so the detail screens are too — the class
          // lives in the path rather than a query string so a pasted URL still
          // says which kind of thing it is.
          { path: '/stocks/:symbol', element: <Instrument assetClass="stocks" /> },
          { path: '/crypto/:symbol', element: <Instrument assetClass="crypto" /> },
          { path: '/forex/:symbol', element: <Instrument assetClass="forex" /> },
        ],
      },

      // Signed-in only.
      {
        element: (
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        ),
        children: [
          { path: '/portfolio', element: <Portfolio /> },
          // A deposit's REFERENCE is in the URL, so the page is shareable,
          // bookmarkable and survives everything a browser can do to it — the
          // row in Mongo is the state, this is only a view of it.
          { path: '/fund', element: <Fund /> },
          { path: '/fund/:reference', element: <Fund /> },
          { path: '/withdraw', element: <Withdraw /> },
          { path: '/withdraw/:reference', element: <Withdraw /> },
          { path: '/dashboard', element: <Portfolio /> },
          { path: '/wallet', element: <ComingSoon title="Wallet" /> },
          /**
           * Its own ProtectedRoute rather than a check inside the page: an
           * admin-only screen guarded by an early return still MOUNTS for a
           * signed-in user, so its queries fire and 403 before the redirect.
           * `adminOnly` decides before the element exists.
           */
          {
            path: '/admin/featured-traders',
            element: (
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/approvals',
            element: (
              <ProtectedRoute adminOnly>
                <Approvals />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/users',
            element: (
              <ProtectedRoute adminOnly>
                <Users />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/subscribers',
            element: (
              <ProtectedRoute adminOnly>
                <Subscribers />
              </ProtectedRoute>
            ),
          },
          { path: '/settings', element: <ComingSoon title="Settings" /> },
          { path: '/contact', element: <ComingSoon title="Contact us" /> },
        ],
      },
    ],
  },
]);
