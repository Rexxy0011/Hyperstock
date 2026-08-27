import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import notify from '../../lib/toast';

/**
 * The "you are signed in" confirmation.
 *
 * IT IS DRIVEN BY A QUERY PARAM RATHER THAN BY THE LOGIN CALL, and that is
 * because of Google. A password or code sign-in could raise the toast where it
 * happens, but the OAuth leg LEAVES THE APP: the browser goes to Google, comes
 * back to a cold boot, and nothing in memory remembers that anybody just signed
 * in. Firing at the call site would have covered two of the three ways in and
 * silently missed the third.
 *
 * So every path appends the same marker to wherever it was going, and one place
 * consumes it. Same technique `lib/tradeIntent.js` uses for the same reason: the
 * URL is the only thing that survives a round trip through another origin.
 *
 * THE PARAM IS CONSUMED, not just read. Left in place, a refresh — or a Back
 * that lands on the same entry — would re-announce a sign-in that happened
 * minutes ago. `replace: true` so stripping it does not add a history entry the
 * user has to press Back through twice.
 *
 * `fired` guards React 18's double-invoked effects in development, which would
 * otherwise raise the toast twice. The toast id makes that harmless anyway;
 * the ref makes it correct.
 */

/** Marker values, kept short because they are visible in the address bar. */
export const WELCOME = { signIn: 'in', signUp: 'new' };

/** Appends the marker to a path that may already carry a query string. */
export function withWelcome(path, kind) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}welcome=${kind}`;
}

export default function WelcomeNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const fired = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const kind = params.get('welcome');
    if (!kind) return;

    if (!fired.current) {
      fired.current = true;
      notify.welcome(kind === WELCOME.signUp ? 'toast.signupSuccess' : 'toast.loginSuccess');
    }

    params.delete('welcome');
    const rest = params.toString();
    navigate(`${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate]);

  return null;
}
