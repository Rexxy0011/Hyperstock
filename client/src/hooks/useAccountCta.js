import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';

/**
 * The marketing pages' call to action, aware of whether anyone is signed in.
 *
 * ASKING A SIGNED-IN USER TO CREATE AN ACCOUNT MAKES THE PRODUCT LOOK LIKE IT
 * DOES NOT KNOW WHO THEY ARE, and both marketing pages are reachable from the
 * nav while logged in — `/about` from the footer, `/faqs` from a top-level nav
 * link. So the button becomes a way back into the product instead.
 *
 * IT LIVES HERE BECAUSE TWO PAGES NEED IT. It began as a local function inside
 * `About.jsx`, and `/faqs` — which has THREE of these buttons — simply did not
 * have it, so every one of them read "Open an account" to somebody already
 * holding a portfolio. Copying the function across would have been two places
 * deciding what a signed-in visitor is offered, which is the duplication this
 * codebase keeps collapsing (`PriceChange` owns the signed percentage,
 * `toast.js` owns durations, `lib/contact.js` owns the address).
 *
 * The labels come with it. `about.openAccount` and `faq.openAccount` were two
 * near-identical strings for one action, translated separately in four
 * languages and free to drift; the hook owns `common.*` instead.
 *
 * IT WAITS ON `authReady`. `AuthProvider` calls the session endpoint on mount,
 * so before that resolves `user` is null and is indistinguishable from a
 * genuine anonymous visit — acting on it early would show every returning user
 * "Open an account" and then swap it a moment later, which is a visible flicker
 * on the page's primary button. Holding the signed-out copy until the answer
 * arrives is the safe default: most traffic to a marketing page is signed out,
 * so it is right almost always and briefly stale otherwise.
 *
 * @returns {{ to: string, label: string, signedIn: boolean }}
 */
export function useAccountCta() {
  const { t } = useTranslation();
  const { user, authReady } = useAuth();
  const signedIn = authReady && Boolean(user);

  return signedIn
    ? { to: '/dashboard', label: t('common.goToDashboard'), signedIn: true }
    : { to: '/auth?mode=signup', label: t('common.openAccount'), signedIn: false };
}

export default useAccountCta;
