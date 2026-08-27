import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { get } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { ADMIN_BASE } from '../nav/navItems';
import { boot, bootedFor, endSession, hide, isBooted, show } from '../../lib/liveChat';

/**
 * Loads the live chat for whoever is signed in.
 *
 * IT RENDERS NOTHING, like `MarketNotices` and `LiveGains` — the widget draws
 * itself, so this is only the thing that decides when it exists and who it says
 * you are.
 *
 * SIGNED-IN ONLY, and the rule is enforced on the server rather than here:
 * `/api/support/chat` is behind `requireAuth`, so an anonymous visitor gets a
 * 401 and there is no property id to load a widget with, whatever this
 * component does. What that buys is an operator who always knows which account
 * is on the other end, which is the entire reason support chat is useful on a
 * product that holds balances. Visitors still have the footer's address.
 *
 * IT LOADS EAGERLY RATHER THAN ON A CLICK, and the alternative was tried on
 * paper first. A custom launcher that injects the script on first press would
 * keep a ~100KB vendor bundle and a WebSocket off the trade terminal for the
 * majority who never open chat — but the widget is also what receives the
 * REPLY. Deferred, an operator answering ten minutes later reaches a page with
 * no socket, no unread badge and no sound, and the user learns nothing until
 * they happen to click again. Send-and-forget is a contact form, not a chat, so
 * the load cost is accepted and the script stays `async` so it never blocks a
 * render.
 */
export default function LiveChat() {
  const { user, authReady } = useAuth();
  const { i18n } = useTranslation();
  const { pathname } = useLocation();

  const signedIn = Boolean(authReady && user);
  const userId = user?.id ?? null;

  /**
   * NOT ON THE ADMIN SCREENS. The operator is the person ANSWERING these
   * chats — a customer support launcher on their own console is an invitation
   * to open a conversation with themselves, and it sits in the corner of every
   * approvals queue doing nothing but obscuring a row.
   *
   * BY ROUTE, NOT BY ROLE. An administrator reading `/portfolio` or `/markets`
   * is using the product like anybody else and may well want support there;
   * what does not belong is a support widget on the operator tooling. Hiding it
   * for the whole account would also mean the one person most likely to be
   * testing the widget could never see it.
   */
  const onAdmin = pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);

  const { data } = useQuery({
    queryKey: keys.supportChat(userId),
    // The language rides along so the operator knows what to answer in. It is
    // a browser preference and the server has never been told it.
    queryFn: () => get(`/support/chat?lang=${encodeURIComponent(i18n.resolvedLanguage ?? '')}`),
    enabled: signedIn,
    // Neither the property id nor the visitor's own name is going to change
    // under a session, so this is fetched once and left alone.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // It has its own fallback — no widget — and a toast saying live chat is
    // unavailable is a notification about a thing the user was not doing.
    meta: { silent: true },
    retry: false,
  });

  useEffect(() => {
    if (!signedIn) {
      // Only if there is something to end. Calling into the API before the
      // script has loaded is how a hook ends up defined on a global that Tawk
      // then overwrites.
      if (isBooted()) endSession();
      return;
    }

    if (!data?.enabled) return;

    /**
     * A DIFFERENT ACCOUNT ON A WIDGET THAT IS ALREADY OPEN CANNOT BE FIXED IN
     * PLACE, so this reloads instead of trying.
     *
     * Tawk's visitor is the browser. Re-pointing `setAttributes` at somebody
     * else renames the conversation already on screen rather than starting a
     * new one, so the incoming user's messages would land in the outgoing
     * user's thread, under their history. A reload is the only thing that
     * genuinely resets it.
     *
     * It cannot fire on the ordinary path: the widget is booted for exactly one
     * id per page lifetime, and signing in for the first time after a page load
     * finds nothing booted at all. Reaching here means two accounts signed in
     * with no navigation between them, which is a shared machine.
     */
    if (isBooted() && bootedFor() !== userId) {
      window.location.reload();
      return;
    }

    /**
     * On an admin screen: never boot, and hide it if it is already loaded.
     *
     * HIDE RATHER THAN UNLOAD, because a third-party embed cannot be taken
     * back out — once the script has run it owns its own iframes and sockets.
     * So the launcher is put away and restored on the way out, which is also
     * why this returns BEFORE the boot below: an operator who signs in
     * straight onto the queues never loads the widget at all.
     */
    if (onAdmin) {
      if (isBooted()) hide();
      return;
    }

    if (isBooted()) {
      // Already loaded: either coming back off an admin screen, or a sign-out
      // and sign-in on the same account within one page lifetime. The
      // attributes are still the ones `boot` set, so only the launcher needs
      // bringing back.
      show();
      return;
    }

    boot({
      propertyId: data.propertyId,
      widgetId: data.widgetId,
      visitor: data.visitor,
      userId,
    });
  }, [signedIn, userId, data, onAdmin]);

  return null;
}
