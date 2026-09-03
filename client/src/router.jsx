import { useLayoutEffect } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom';
import { ADMIN_BASE, ADMIN_HOME } from './components/nav/navItems';
import { AuthProvider } from './auth/AuthProvider';
import ProtectedRoute from './auth/ProtectedRoute';
import Toasts from './components/ui/Toasts';
import MarketNotices from './components/market/MarketNotices';
import WelcomeNotice from './components/auth/WelcomeNotice';
import LiveChat from './components/support/LiveChat';
import Fund from './pages/Fund';
import Withdraw from './pages/Withdraw';

import PublicLayout from './layouts/PublicLayout';
import DashboardLayout from './layouts/DashboardLayout';
import AdaptiveLayout from './layouts/AdaptiveLayout';

import Landing from './pages/Landing';
import About from './pages/About';
import Faqs from './pages/Faqs';
import Contact from './pages/Contact';
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
import Messages from './pages/Messages';
import Users from './pages/Users';
import Unsubscribe from './pages/Unsubscribe';
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
      {/* Global, not per-route: sign-in can land anywhere `?next=` pointed. */}
      <WelcomeNotice />
      {/* Also renders nothing. It loads the support widget for a signed-in
          user and takes it away on sign-out. Here rather than in a layout for
          the same reason as the rest: an open conversation must survive a
          route change, and remounting would drop it. */}
      <LiveChat />
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
          /* PUBLIC, AND IT WAS BEHIND THE SESSION UNTIL NOW. `/faqs` is public
             and carries two buttons pointing here, so an anonymous reader
             following "Contact support" was bounced to `/auth` — which inverts
             what a contact page is for, since the people most likely to need
             one have not signed up yet. */
          { path: '/contact', element: <Contact /> },
          /* Linked from every newsletter, so it is public and must never sit
             behind a session — somebody unsubscribing is by definition not
             signing in to do it. */
          { path: '/unsubscribe', element: <Unsubscribe /> },
          // Legal documents are marketing-shell regardless of session: a
          // signed-in reader wants the same page as a visitor, plus the footer
          // that carries the rest of the legal links.
          { path: '/privacy', element: <LegalDocument id="privacy" /> },
          { path: '/financial-privacy', element: <LegalDocument id="financial-privacy" /> },
          { path: '/terms', element: <LegalDocument id="terms" /> },
          { path: '/risk-disclosure', element: <LegalDocument id="risk-disclosure" /> },
          { path: '/disclosures', element: <LegalDocument id="disclosures" /> },
          { path: '*', element: <ComingSoon title="Not found" /> },
        ],
      },

      /* THE SAME MARKETING SHELL WITHOUT ITS FURNITURE. `/auth` keeps the nav —
         it carries the language switcher, which somebody who cannot read the
         current interface needs before they can sign in — but drops the footer
         and the activity toasts. A five-column footer of legal and support
         links sits a wall of exits directly under the one action the page
         exists for, and a toast arriving on its own while a password is being
         typed is an interruption at the worst moment. */
      {
        element: <PublicLayout chrome={false} />,
        children: [{ path: '/auth', element: <Auth /> }],
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
           * THE ADMIN SECTION, MOUNTED UNDER `ADMIN_BASE` RATHER THAN `/admin`.
           * The prefix is deliberately unguessable and `navItems.js` owns the
           * string — see the note there for what that does and does not buy.
           * Every path below is BUILT from it, so the section cannot be renamed
           * into a set of dead links.
           *
           * Its own ProtectedRoute rather than a check inside the page: an
           * admin-only screen guarded by an early return still MOUNTS for a
           * signed-in user, so its queries fire and 403 before the redirect.
           * `adminOnly` decides before the element exists.
           */
          {
            /* The bare prefix is a real route, because it is where sign-in
               sends an operator and what a person types from memory. Without
               it, `/soap` falls through to the catch-all and the section
               appears not to exist to the one user who is allowed in. */
            path: ADMIN_BASE,
            element: <Navigate to={ADMIN_HOME} replace />,
          },
          {
            path: `${ADMIN_BASE}/featured-traders`,
            element: (
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            ),
          },
          {
            path: `${ADMIN_BASE}/approvals`,
            element: (
              <ProtectedRoute adminOnly>
                <Approvals />
              </ProtectedRoute>
            ),
          },
          {
            path: `${ADMIN_BASE}/users`,
            element: (
              <ProtectedRoute adminOnly>
                <Users />
              </ProtectedRoute>
            ),
          },
          {
            path: `${ADMIN_BASE}/subscribers`,
            element: (
              <ProtectedRoute adminOnly>
                <Subscribers />
              </ProtectedRoute>
            ),
          },
          /* Where the contact form's messages are read. Without this the
             endpoint is write-only and `/contact` makes a promise nothing
             keeps — the same objection this repo raised against posting the
             newsletter capture to a third-party form backend. */
          {
            path: `${ADMIN_BASE}/messages`,
            element: (
              <ProtectedRoute adminOnly>
                <Messages />
              </ProtectedRoute>
            ),
          },
        ],
      },
    ],
  },
]);
