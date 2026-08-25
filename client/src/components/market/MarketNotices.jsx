import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import notify from '../../lib/toast';

/**
 * Renders nothing. Watches `/api/market/status` and raises a toast when
 * something an active trader would want to know actually CHANGES.
 *
 * ON THE TRANSITION, NEVER THE STATE. This is the whole design of the file. A
 * component that toasts because the market is closed fires on every poll and on
 * every route change, and within a minute the screen is a column of identical
 * notices — the same defect the deposit polling had, fixed the same way, with a
 * ref holding the last value and a comparison against it.
 *
 * THE FIRST READING IS NOT A TRANSITION. Loading a page during a closed market
 * is not news; it is the situation. So the first poll only seeds the refs, and
 * nothing is raised until a subsequent one differs. Without that, every hard
 * refresh greets the visitor with a toast telling them something they did not
 * ask about and cannot act on.
 *
 * A dropped feed is worth interrupting for because it silently invalidates
 * every price on screen: nothing else on the page distinguishes "this price has
 * not moved" from "this price can no longer move", which is precisely the
 * failure mode that had the socket dark for 83 minutes while every screen
 * rendered plausible numbers.
 */
export default function MarketNotices() {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ['market', 'status'],
    queryFn: () => get('/market/status'),
    // The two events this watches move on the scale of minutes, not seconds,
    // and a market open is not worth a request every fifteen.
    refetchInterval: 60_000,
    // A failed status poll must not itself raise the global error toast: the
    // component exists to report a degraded feed, so it has to survive one.
    meta: { silent: true },
  });

  const seen = useRef(/** @type {{ open: boolean | null, connected: boolean | null }} */ ({
    open: null,
    connected: null,
  }));

  useEffect(() => {
    if (!data) return;

    const open = data.session?.open ?? null;
    const connected = data.stream?.connected ?? null;
    const prev = seen.current;

    // Seed only. See the note above on why the first reading is silent.
    if (prev.open === null && prev.connected === null) {
      seen.current = { open, connected };
      return;
    }

    if (open !== null && prev.open !== null && open !== prev.open) {
      if (open) notify.success(t('notices.marketOpen'), { id: 'market-session' });
      else notify.info(t('notices.marketClosed'), { id: 'market-session' });
    }

    if (connected !== null && prev.connected !== null && connected !== prev.connected) {
      // One shared id, so a socket that flaps replaces its own notice in place
      // rather than stacking a column of them.
      if (connected) notify.success(t('notices.feedBack'), { id: 'market-feed' });
      else notify.error(t('notices.feedLost'), { id: 'market-feed', duration: 8_000 });
    }

    seen.current = { open, connected };
  }, [data, t]);

  return null;
}
