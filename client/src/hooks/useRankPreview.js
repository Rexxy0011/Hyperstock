import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * Where a typed figure would land on the board, before it is saved.
 *
 * ANSWERED BY THE SERVER, AND THE CLIENT-SIDE VERSION WAS WRONG ON BOTH
 * SCREENS. Counting rows above the value in a leaderboard the admin already
 * holds looks correct and is not — `/leaderboard` caps `limit` at 100, and the
 * two editors were asking for **5** and **100** rows respectively. The featured
 * form therefore reported rank 6 for every figure below fifth place, and the
 * user editor reported 101 for every account below the cut. Both were plausible
 * numbers, which is why neither was noticed.
 *
 * Raising the cap to fix a preview would mean widening a public endpoint for
 * the admin's convenience. The server already holds the whole board memoised.
 *
 * THE ROW BEING EDITED IS EXCLUDED, and not only by user id: saving replaces
 * that row rather than adding one, and an already-overridden trader sits on the
 * board as a curated row whose id is the FeaturedTrader document's — so
 * matching the user id alone misses it and reports a rank one too low for
 * exactly the rows most likely to be edited again.
 *
 * @param {string|number} dollars the value as typed, in dollars
 * @param {object} [opts]
 * @param {string=} opts.userId the account this row stands for, if any
 * @param {boolean=} opts.enabled false while the dialog is closed
 */
export function useRankPreview(dollars, { userId = undefined, enabled = true } = {}) {
  const cents = useMemo(() => {
    const n = Math.round(Number(dollars) * 100);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [dollars]);

  // Debounced: this fires per keystroke on a numeric field, where every
  // intermediate value is a different query.
  const debounced = useDebouncedValue(cents, 350);

  const { data } = useQuery({
    queryKey: ['admin', 'rank-preview', debounced, userId ?? ''],
    queryFn: () =>
      get(
        `/admin/rank-preview?valueCents=${debounced}${userId ? `&userId=${userId}` : ''}`,
      ),
    enabled: enabled && debounced != null,
    staleTime: 15_000,
    meta: { silent: true },
  });

  return {
    rank: data?.rank ?? null,
    totalTraders: data?.totalTraders ?? null,
    /** Whether this figure would lead the board. */
    leads: data?.rank === 1,
  };
}

export default useRankPreview;
