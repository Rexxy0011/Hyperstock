import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import Badge, { statusVariant } from '../components/ui/Badge';
import Money from '../components/market/Money';
import notify from '../lib/toast';

/**
 * Every account on the platform.
 *
 * THE COLUMN THIS SCREEN EXISTS FOR IS "SIGN-IN". Since Better Auth took over,
 * a credential is a row in `accounts` rather than a field on the user — so 209
 * user documents look identical and two of them hold a password. Which rows are
 * real accounts and which are leaderboard fixtures was not visible anywhere in
 * the product, including here, because here did not exist.
 *
 * The counts above the table say it in one line: 209 accounts, 2 that can sign
 * in, 207 that cannot.
 */
export default function Users() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();

  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  // 300ms, the same debounce the market search uses — a keystroke per request
  // against a 209-row collection is the kind of thing that is free until it is
  // not.
  const search = useDebouncedValue(term, 300);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'users', search, page],
    queryFn: () => get(`/admin/users?q=${encodeURIComponent(search)}&page=${page}`),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash the whole table back to skeletons.
    placeholderData: (previous) => previous,
  });

  const setStatus = useMutation({
    /** @param {{ id: string, status: string }} vars */
    mutationFn: ({ id, status }) => patch(`/admin/users/${id}/status`, { status }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      // The revoked count is the part an operator cannot see anywhere else —
      // suspending somebody who is signed in right now is a different event
      // from suspending a dormant account.
      notify.success(
        result.sessionsRevoked
          ? t('admin.users.suspendedWithSessions', { count: result.sessionsRevoked })
          : t('admin.users.statusChanged'),
      );
    },
  });

  const rows = data?.items ?? [];
  const counts = data?.counts;
  const pages = data?.pages ?? 1;

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-6">
        <h1 className="m-0 text-xl font-bold">{t('admin.users.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">{t('admin.users.intro')}</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <Stat label={t('admin.users.total')} value={counts?.total ?? 0} />
        {/* Leads on the two that answer "who is real": the platform has 209
            rows and two people who can actually get in. */}
        <Stat label={t('admin.users.canSignIn')} value={counts?.withCredentials ?? 0} />
        <Stat label={t('admin.users.fixtures')} value={counts?.fixtures ?? 0} />
        <Stat label={t('admin.users.admins')} value={counts?.admins ?? 0} />
        <Stat label={t('admin.users.suspended')} value={counts?.suspended ?? 0} />
      </div>

      <input
        type="search"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          // A new search must land on page one, or a term matching three rows
          // shows an empty table because the reader was on page nine.
          setPage(1);
        }}
        placeholder={t('admin.users.searchPlaceholder')}
        className="mb-4 w-full max-w-80 rounded-md border border-cool-grey bg-white px-3 py-2 text-sm outline-none focus:border-slate"
      />

      <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['account', 'signIn', 'role', 'status', 'cash', 'trades', 'joined'].map((k) => (
                <th key={k} className={th}>
                  {t(`admin.users.col.${k}`)}
                </th>
              ))}
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className={td} colSpan={8}>
                  <span className="block h-4 w-48 animate-pulse rounded-sm bg-mist" />
                </td>
              </tr>
            )}

            {/* A failed load is not an empty list — the same distinction the
                subscribers table makes, and for the same measured reason. */}
            {isError && (
              <tr>
                <td className={`${td} py-10 text-center`} colSpan={8}>
                  <p className="m-0 text-text-muted">{t('common.loadFailed')}</p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-2 text-sm font-medium text-gain underline underline-offset-2"
                  >
                    {t('common.retry')}
                  </button>
                </td>
              </tr>
            )}

            {!isLoading && !isError && !rows.length && (
              <tr>
                <td className={`${td} py-10 text-center text-text-muted`} colSpan={8}>
                  {t('admin.users.empty')}
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isMe = r.id === me?.id;
              return (
                <tr key={r.id}>
                  <td className={td}>
                    <span className="block font-medium">
                      {r.displayName || r.username}
                      {isMe && (
                        <span className="ml-2 text-2xs text-text-muted">
                          {t('admin.users.you')}
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-xs text-text-muted">{r.email}</span>
                  </td>

                  <td className={td}>
                    {/* The whole point of the screen. `neutral` rather than a
                        loss red for a fixture: having no credential is the
                        correct state for 207 of these rows, not a fault. */}
                    <Badge variant={r.canSignIn ? 'approved' : 'neutral'}>
                      {t(r.canSignIn ? 'admin.users.hasCredential' : 'admin.users.noCredential')}
                    </Badge>
                  </td>

                  <td className={td}>
                    {r.role === 'admin' ? (
                      <Badge variant="amber">{t('admin.users.role.admin')}</Badge>
                    ) : (
                      <span className="text-text-muted">{t('admin.users.role.user')}</span>
                    )}
                  </td>

                  <td className={td}>
                    {/* `statusVariant` is the single owner of status -> colour and
                        already maps Active / Flagged / Suspended. A local map
                        here would be the second owner CLAUDE.md warns about. */}
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </td>

                  <td className={`${td} text-right`}>
                    <Money value={r.cashBalanceCents} size={13} />
                  </td>

                  <td className={`${td} text-right font-numeric tabular-nums text-text-muted`}>
                    {r.tradeCount.toLocaleString('en-US')}
                  </td>

                  <td className={`${td} whitespace-nowrap text-xs text-text-muted`}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>

                  <td className={`${td} text-right whitespace-nowrap`}>
                    {/* Hidden entirely on your own row rather than disabled: the
                        server refuses it (SELF_STATUS_CHANGE), and a control
                        that exists only to reject you is worse than no control.
                        Suspending the only administrator locks the product to
                        everyone, recoverable only by editing the database. */}
                    {!isMe && (
                      <button
                        type="button"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate({
                            id: r.id,
                            status: r.status === 'Suspended' ? 'Active' : 'Suspended',
                          })
                        }
                        className="cursor-pointer text-sm font-medium text-gain underline underline-offset-2 disabled:opacity-45"
                      >
                        {t(
                          r.status === 'Suspended'
                            ? 'admin.users.reactivate'
                            : 'admin.users.suspend',
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="cursor-pointer text-sm font-medium underline underline-offset-2 disabled:cursor-default disabled:opacity-40"
          >
            {t('common.previous')}
          </button>
          <span className="font-numeric text-sm tabular-nums text-text-muted">
            {t('admin.users.pageOf', { page, pages })}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="cursor-pointer text-sm font-medium underline underline-offset-2 disabled:cursor-default disabled:opacity-40"
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-cool-grey bg-white px-4 py-3 shadow-card">
      <div className="text-2xs text-text-muted">{label}</div>
      <div className="font-numeric text-lg font-semibold tabular-nums">
        {value.toLocaleString('en-US')}
      </div>
    </div>
  );
}

const th =
  'border-b border-cool-grey px-4 py-2.5 text-left text-xs font-medium text-text-muted whitespace-nowrap';
const td = 'border-b border-cool-grey px-4 py-3 text-sm';
