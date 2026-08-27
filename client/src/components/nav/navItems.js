/**
 * One navigation definition, rendered by both shells: the top nav (web) and the
 * slide-in drawer (mobile/tablet). Icons are carried here but only the drawer
 * renders them — the web nav is text-only.
 *
 * `key` is the translation key and `label` the English fallback. They are
 * separate on purpose: a key derived from the label would change the moment
 * anyone reworded the English, silently orphaning every other language's
 * translation of that item with nothing to report it.
 */
export const NAV = [
  { to: '/', key: 'home', icon: 'home', label: 'Home', end: true },
  { to: '/portfolio', key: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/news', key: 'news', icon: 'news', label: 'News' },
  { to: '/markets', key: 'market', icon: 'market', label: 'Market' },
  /**
   * FAQs replaced a "Stock & fund" dropdown, which was four links to the same
   * `/markets` table pre-filtered by sector — two of those sectors (Mutual Fund,
   * Gold) match nothing this product actually lists, so half the menu led to an
   * empty table. A flat link costs one nav slot instead of a menu, and there is
   * no submenu to keep in sync with a sector taxonomy that no longer holds.
   */
  { to: '/faqs', key: 'faqs', icon: 'help', label: 'FAQs' },
];

export const SECONDARY = [
  { to: '/leaderboard', key: 'community', icon: 'community', label: 'Our community' },
  { to: '/settings', key: 'settings', icon: 'settings', label: 'Settings', badge: '6' },
  { to: '/contact', key: 'contact', icon: 'phone', label: 'Contact us' },
];

/**
 * THE ADMIN URL PREFIX, AND IT IS DELIBERATELY NOT `/admin`.
 *
 * `/admin` is the first path anybody scanning a site tries, and a route that
 * merely redirects on the wrong role still CONFIRMS the screen exists. Under an
 * unguessable prefix, a prober gets the ordinary Not-found page and learns
 * nothing. That is worth having and it is worth being honest about what it is:
 * obscurity, not a control. The actual protection is unchanged and lives in two
 * places that do not care what this string says — `ProtectedRoute adminOnly` on
 * the client and `requireAdmin` on the server.
 *
 * ONE OWNER, so renaming it is one edit. `router.jsx` builds its paths from
 * this and the nav derives every `to` below, which is what stops the rename
 * from leaving a stale link that 404s for the one person who needs it.
 *
 * NOTE WHAT THIS DOES *NOT* HIDE: the API is still mounted at `/api/admin/*`,
 * and those endpoints answer 401 rather than 404 to an anonymous request — so
 * they confirm an admin API exists to anybody who asks. Renaming the client
 * route is the half a visitor can see; matching the server is a separate change
 * and has not been made.
 */
export const ADMIN_BASE = '/soap';

/**
 * Admin-only entries, filtered on `user.role` by whichever shell renders them.
 *
 * Kept OUT of `SECONDARY` rather than flagged inside it: the two shells iterate
 * that list without knowing what is in it, so an item that must not render for
 * everyone cannot live in the list everyone renders.
 */
export const ADMIN = [
  // Approvals first: it is the one with work waiting on it, and it is where a
  // signed-in operator lands, so it doubles as the section's index.
  { to: `${ADMIN_BASE}/approvals`, key: 'approvals', icon: 'wallet', label: 'Approvals' },
  {
    to: `${ADMIN_BASE}/featured-traders`,
    key: 'featuredTraders',
    icon: 'community',
    label: 'Featured traders',
  },
  // Users before subscribers: an account is the more consequential record, and
  // it is the only screen that says which of them can actually sign in.
  { to: `${ADMIN_BASE}/users`, key: 'users', icon: 'community', label: 'Users' },
  { to: `${ADMIN_BASE}/subscribers`, key: 'subscribers', icon: 'news', label: 'Subscribers' },
];

/** Where an operator is sent on sign-in, and the target of the bare prefix. */
export const ADMIN_HOME = ADMIN[0].to;
