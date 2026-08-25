import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { keys } from '../lib/queryClient';
import Tabs from '../components/ui/Tabs';
import Badge from '../components/ui/Badge';
import Money from '../components/market/Money';
import PriceChange from '../components/market/PriceChange';

const PERIODS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'alltime', label: 'All-time' },
];

/** Adjectival, to match the design's "Ranked by all-time portfolio value…". */
const PERIOD_COPY = {
  weekly: 'weekly',
  monthly: 'monthly',
  alltime: 'all-time',
};

export default function Leaderboard() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('monthly');

  const { data, isLoading } = useQuery({
    queryKey: keys.leaderboard(period),
    queryFn: () => get(`/leaderboard?period=${period}&limit=50`),
  });

  const rows = data?.top ?? [];
  const you = data?.you ?? null;
  const podium = rows.slice(0, 3);

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-bold">{t('leaderboard.title')}</h1>
          <p className="mt-2 text-sm text-text-muted">
            Ranked by {PERIOD_COPY[period]} portfolio value across{' '}
            <span className="font-numeric tabular-nums">
              {(data?.totalTraders ?? 0).toLocaleString('en-US')}
            </span>{' '}
            traders.
          </p>
        </div>
        <Tabs tabs={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <SkeletonBoard />
      ) : (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            {podium.map((r) => (
              <div
                // Keyed on userId, not username: a curated row carries a
                // free-typed name that may match a real trader's, and two rows
                // with one key silently drop one of them.
                key={r.userId}
                className="flex items-center gap-4 rounded-md border border-cool-grey bg-white p-5 shadow-card"
              >
                <span className="w-5 font-numeric text-lg font-semibold tabular-nums text-void">
                  {r.rank}
                </span>
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-cool-grey bg-mist text-sm font-semibold">
                  {r.avatarLetter}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium">{r.username}</div>
                  <Money value={r.portfolioValueCents} size={13} className="text-text-muted" />
                </div>
                <PriceChange value={r.returnPct} size={12} pill />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Rank', 'Trader', 'Trades', 'Best position'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>{t('leaderboard.portfolioValue')}</th>
                  <th className={`${th} text-right`}>{t('leaderboard.return')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.userId} row={r} />
                ))}
                {/* The design pins the signed-in trader beneath the top N when
                    they don't place in it — rank 128 in the mockup. */}
                {you && !rows.some((r) => r.userId === you.userId) && (
                  <Row row={you} pinned />
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const th =
  'border-b border-cool-grey px-4 py-2.5 text-left text-xs font-medium text-text-muted whitespace-nowrap';
const td = 'border-b border-cool-grey px-4 py-3 text-sm';

function Row({ row, pinned = false }) {
  const { t } = useTranslation();
  return (
    <tr className={row.you ? 'bg-mist' : ''}>
      <td className={`${td} font-numeric tabular-nums ${row.rank <= 3 ? 'text-void' : 'text-text-muted'}`}>
        {pinned ? <span className="text-text-muted">…</span> : null}
        {row.rank}
      </td>
      <td className={td}>
        <div className="flex items-center gap-3">
          <span className="inline-flex size-7 items-center justify-center rounded-md border border-cool-grey bg-mist text-2xs font-semibold">
            {row.avatarLetter}
          </span>
          <span className="font-medium">{row.username}</span>
          {row.you && <Badge variant="neutral">{t('leaderboard.you')}</Badge>}
        </div>
      </td>
      <td className={`${td} font-numeric tabular-nums text-text-muted`}>
        {row.trades.toLocaleString('en-US')}
      </td>
      <td className={`${td} whitespace-nowrap`}>
        {row.best?.symbol ? (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{row.best.symbol}</span>
            <PriceChange value={row.best.returnPct} size={12} />
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className={`${td} text-right`}>
        <Money value={row.portfolioValueCents} size={14} />
      </td>
      <td className={`${td} text-right`}>
        <PriceChange value={row.returnPct} size={12} pill className="justify-end" />
      </td>
    </tr>
  );
}

function SkeletonBoard() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-mist" />
      ))}
    </div>
  );
}
