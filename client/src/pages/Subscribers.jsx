import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import Badge from '../components/ui/Badge';

/**
 * Addresses captured by the marketing calls to action.
 *
 * The reason the CTA posts to this product's own API rather than to EmailJS or
 * a form backend is this screen: a third-party service keeps the addresses
 * somewhere the app cannot read them, so there is nowhere to show them and no
 * way to answer the only interesting question about the list — which call to
 * action converts.
 *
 * `converted` is computed against `User.email` on every read rather than stored,
 * because a stored flag needs a writer on the registration path and nothing
 * would have remembered to add one.
 */
export default function Subscribers() {
  const { t } = useTranslation();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'subscribers'],
    queryFn: () => get('/admin/subscribers'),
  });

  const rows = data?.items ?? [];

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-6">
        <h1 className="m-0 text-xl font-bold">{t('admin.subscribers.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">{t('admin.subscribers.intro')}</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        {/* `subscribed` leads, because it is the only one of the three that is
            the size of a send. `total` counts rows including people who left. */}
        <Stat label={t('admin.subscribers.subscribed')} value={data?.subscribed ?? 0} />
        <Stat label={t('admin.subscribers.total')} value={data?.total ?? 0} />
        <Stat label={t('admin.subscribers.converted')} value={data?.converted ?? 0} />
      </div>

      <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['email', 'source', 'status', 'captured'].map((k) => (
                <th key={k} className={th}>
                  {t(`admin.subscribers.col.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className={td} colSpan={4}>
                  <span className="block h-4 w-48 animate-pulse rounded-sm bg-mist" />
                </td>
              </tr>
            )}
            {/**
             * A FAILED LOAD IS NOT AN EMPTY LIST, and conflating them is how a
             * server being down renders as an account with nothing in it —
             * measured on this very page by blocking the request: the table
             * said "No addresses captured yet" over a request that never
             * returned. The toast says what happened; this says it where the
             * rows would have been, and offers the retry a toast cannot.
             */}
            {isError && (
              <tr>
                <td className={`${td} py-10 text-center`} colSpan={4}>
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
                <td className={`${td} py-10 text-center text-text-muted`} colSpan={4}>
                  {t('admin.subscribers.empty')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-medium`}>{r.email}</td>
                <td className={`${td} text-text-muted`}>
                  {t(`admin.subscribers.source.${r.source}`, { defaultValue: r.source })}
                </td>
                <td className={td}>
                  {/* Two independent facts, so two badges. Someone can be on
                      the list without an account, and can hold an account
                      having left the list — one combined label would have to
                      pick which of those to hide. */}
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={r.subscribed ? 'approved' : 'declined'}>
                      {t(r.subscribed ? 'admin.subscribers.on' : 'admin.subscribers.off')}
                    </Badge>
                    {r.converted && (
                      <Badge variant="neutral">{t('admin.subscribers.signedUp')}</Badge>
                    )}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap text-xs text-text-muted`}>
                  {new Date(r.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
