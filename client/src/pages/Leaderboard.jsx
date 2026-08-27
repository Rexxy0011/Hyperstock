import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { keys } from '../lib/queryClient';
import Tabs from '../components/ui/Tabs';
import Badge from '../components/ui/Badge';
import Money from '../components/market/Money';
import PriceChange from '../components/market/PriceChange';
import Avatar from '../components/ui/Avatar';

const PERIODS = [
  { value: 'weekly', labelKey: 'leaderboard.tabWeekly' },
  { value: 'monthly', labelKey: 'leaderboard.tabMonthly' },
  { value: 'alltime', labelKey: 'leaderboard.tabAlltime' },
];

/** Adjectival, to match the design's "Ranked by all-time portfolio value…". */
const PERIOD_COPY = {
  weekly: 'leaderboard.periodWeekly',
  monthly: 'leaderboard.periodMonthly',
  alltime: 'leaderboard.periodAlltime',
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
            {t('leaderboard.rankedBy', {
              period: t(PERIOD_COPY[period]),
              count: data?.totalTraders ?? 0,
            })}
          </p>
        </div>
        <Tabs
          tabs={PERIODS.map((p) => ({ value: p.value, label: t(p.labelKey) }))}
          value={period}
          onChange={setPeriod}
        />
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
                {/* An uploaded portrait wins; the letter chip is the fallback.
                    `Avatar` degrades to its generated mark on the image's own
                    error event, so a deleted photo cannot leave a broken frame. */}
                {r.avatarUrl ? (
                  <Avatar name={r.username} src={r.avatarUrl} size={36} />
                ) : (
                  <span className="inline-flex size-9 items-center justify-center rounded-md border border-cool-grey bg-mist text-sm font-semibold">
                    {r.avatarLetter}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium">{r.username}</div>
                  <Money value={r.portfolioValueCents} size={13} className="text-text-muted" />
                </div>
                <PriceChange value={r.returnPct} size={12} pill />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
            {/*
              `table-fixed` WITH PERCENTAGES, NOT AUTO LAYOUT.

              Auto layout sizes each column to its content and then dumps the
              LEFTOVER between two of them — measured at 1600px, ~350px of
              nothing sat between "Best position" and "Portfolio value" while
              the trader names stopped short, so a full-width table still read
              as unfinished. Giving one column `w-full` only moves the problem:
              at 1920 that left 1188px of empty space after the name.

              Six short columns cannot fill 1846px however the slack is
              assigned, so it is SPREAD rather than pooled. Every column gets a
              proportional share, which keeps a row reading as one unit instead
              of two clusters either side of a canyon.

              `min-w-200` hands narrow screens to the wrapper's existing
              `overflow-x-auto`, because fixed layout would otherwise crush the
              columns rather than let the table scroll.
            */}
            <table className="w-full min-w-200 table-fixed border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-[7%]`}>{t('leaderboard.rank')}</th>
                  <th className={`${th} w-[30%]`}>{t('leaderboard.trader')}</th>
                  <th className={`${th} w-[9%]`}>{t('leaderboard.trades')}</th>
                  <th className={`${th} w-[19%]`}>{t('leaderboard.bestPosition')}</th>
                  <th className={`${th} w-[19%] text-right`}>{t('leaderboard.portfolioValue')}</th>
                  <th className={`${th} w-[16%] text-right`}>{t('leaderboard.return')}</th>
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
          {row.avatarUrl ? (
            <Avatar name={row.username} src={row.avatarUrl} size={28} />
          ) : (
            <span className="inline-flex size-7 items-center justify-center rounded-md border border-cool-grey bg-mist text-2xs font-semibold">
              {row.avatarLetter}
            </span>
          )}
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
          <span className="text-text-muted">-</span>
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
