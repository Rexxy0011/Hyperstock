import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '../lib/api';
import { keys } from '../lib/queryClient';
import { useAuth } from '../auth/AuthProvider';

/**
 * The watchlist, as one shared query plus two mutations.
 *
 * `/markets` is a PUBLIC page — it renders in the marketing shell signed out —
 * so this must not fire an authed request for an anonymous visitor. `enabled`
 * gates on the resolved session rather than on `user` alone: before
 * `AuthProvider`'s boot refresh settles, `user` is null and indistinguishable
 * from signed out, and firing then would 401 every returning user once per page
 * load. The trade is one render with an empty list, which is what an anonymous
 * visitor sees anyway.
 */

/** `${assetClass}:${symbol}` — the same composite key the server stores. */
const idOf = (assetClass, symbol) => `${assetClass}:${String(symbol).toUpperCase()}`;

export function useWatchlist() {
  const { user, authReady } = useAuth();
  const signedIn = authReady && Boolean(user);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: keys.watchlist,
    queryFn: () => get('/watchlist'),
    enabled: signedIn,
    // Prices in the list come from the same market cache the tables poll, so
    // the list itself only changes when the user changes it.
    staleTime: 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  /** Membership as a Set — the Markets table asks this once per row. */
  const watched = useMemo(
    () => new Set(items.map((i) => idOf(i.assetClass, i.symbol))),
    [items],
  );

  /**
   * Optimistic on both sides. The button is the only feedback a user gets that
   * a tap registered, and a round trip on a table row reads as a dead control;
   * the rollback in `onError` is what keeps that honest when the write fails.
   */
  const mutationOptions = (apply) => ({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: keys.watchlist });
      const previous = queryClient.getQueryData(keys.watchlist);
      queryClient.setQueryData(keys.watchlist, (old) => ({
        // TanStack types a cache entry as `unknown` — it cannot know what this
        // key holds — so the shape written by `queryFn` is asserted here.
        items: apply(/** @type {{items?: any[]} | undefined} */ (old)?.items ?? [], variables),
      }));
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(keys.watchlist, context.previous);
    },
    // Refetch either way: an add returns a fully enriched row from the server,
    // and the optimistic placeholder below carries no price.
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.watchlist }),
  });

  const addMutation = useMutation({
    mutationFn: ({ assetClass, symbol, ...rest }) =>
      post('/watchlist', { assetClass, symbol, ...rest }),
    ...mutationOptions((items, { assetClass, symbol, name }) => [
      // Newest first, matching the server's sort.
      { assetClass, symbol, name: name ?? symbol, resolved: true, pending: true },
      ...items,
    ]),
  });

  const removeMutation = useMutation({
    mutationFn: ({ assetClass, symbol }) => del(`/watchlist/${assetClass}/${symbol}`),
    ...mutationOptions((items, { assetClass, symbol }) =>
      items.filter((i) => idOf(i.assetClass, i.symbol) !== idOf(assetClass, symbol)),
    ),
  });

  const isWatched = useCallback(
    (assetClass, symbol) => watched.has(idOf(assetClass, symbol)),
    [watched],
  );

  const add = useCallback((row) => addMutation.mutate(row), [addMutation]);
  const remove = useCallback((row) => removeMutation.mutate(row), [removeMutation]);

  return {
    items,
    isLoading: signedIn && isPending,
    signedIn,
    isWatched,
    add,
    remove,
    /** Surfaced so a full list can explain itself rather than failing silently. */
    error: addMutation.error,
  };
}
