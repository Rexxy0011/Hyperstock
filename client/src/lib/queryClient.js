import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import notify from './toast';

/**
 * Quote-dependent views poll every 15s. That is cheap because the server
 * answers from a warm in-process cache rather than calling the market vendor,
 * so polling costs ~1ms per request no matter how many clients are connected.
 */
export const QUOTE_POLL_MS = 15_000;

/**
 * Whether a failure is worth interrupting somebody for.
 *
 * THE CACHES, NOT THE AXIOS INTERCEPTOR. The interceptor sees every 401 that the
 * single-flight refresh is in the middle of handling — the dashboard fires
 * several queries on mount and each one 401s before the token rotates — so a
 * toast there fires a handful of times on a perfectly ordinary page load.
 * The caches see the settled outcome instead.
 *
 * 401 is excluded for the same reason at the other end: an anonymous visitor
 * loading `/` gets one from the boot-time refresh, which is the expected answer
 * to "am I signed in", not an error anyone should be shown.
 */
function shouldReport(error, meta) {
  if (meta?.silent) return false;

  const status = /** @type {import('./api').ApiError} */ (error)?.status;
  if (status === 401) return false;
  // A cancelled request is not a failure — a route change mid-flight is normal.
  if (/** @type {any} */ (error)?.name === 'CanceledError') return false;
  return true;
}

export const queryClient = new QueryClient({
  /**
   * Queries used to fail SILENTLY. A table that cannot load renders its empty
   * state, which is indistinguishable from having no rows — so a server that is
   * down looks like an account with nothing in it.
   */
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (shouldReport(error, query.meta)) notify.apiError(error);
    },
  }),

  /**
   * Mutations toast too, but a component that renders its own inline message
   * opts out with `meta: { silent: true }` — inside a form the error belongs
   * beside the field, and both at once is the same sentence twice.
   */
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (shouldReport(error, mutation.meta)) notify.apiError(error);
    },
  }),

  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a client error — a 404 or 422 will not fix itself.
        // TanStack types the callback's error as Error; ours is an ApiError.
        const status = /** @type {import('./api').ApiError} */ (error)?.status;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export const keys = {
  ticker: ['ticker'],
  exchanges: ['exchanges'],
  stocks: (filters) => ['stocks', filters],
  instruments: (assetClass, q) => ['instruments', assetClass, q ?? ''],
  instrument: (assetClass, symbol, range) => ['instrument', assetClass, symbol, range],
  stock: (symbol) => ['stock', symbol],
  candles: (symbol, range) => ['candles', symbol, range],
  portfolio: ['portfolio'],
  watchlist: ['watchlist'],
  performance: (range) => ['performance', range],
  wallet: ['wallet'],
  transactions: (page) => ['transactions', page],
  leaderboard: (period) => ['leaderboard', period],
  news: (symbol) => ['news', symbol ?? ''],
  announcements: ['announcements'],
  orders: (filters) => ['orders', filters],
};
