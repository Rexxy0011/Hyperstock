import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Link from '../components/ui/Link';
import { get } from '../lib/api';
import { keys, QUOTE_POLL_MS } from '../lib/queryClient';
import { compact, money, pct, untilLabel } from '../lib/format';
import AssetMark from '../components/market/AssetMark';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { livePrice, useLivePrices } from '../hooks/useLivePrices';
import { useWatchlist } from '../hooks/useWatchlist';
import Icon from '../components/ui/Icon';
import Input from '../components/ui/Input';
import Tabs from '../components/ui/Tabs';
import Badge, { statusVariant } from '../components/ui/Badge';
import PriceChange from '../components/market/PriceChange';
import WatchButton from '../components/market/WatchButton';

const ASSET_TABS = [
  { value: 'stocks', label: 'Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
];

/**
 * The three classes are backed by three unrelated providers with three
 * different honesty problems, so each gets its own subtitle rather than one
 * line that would have to be vague enough to cover all of them.
 */
const BLURB = {
  stocks: 'markets.blurbStocks',
  crypto: 'markets.blurbCrypto',
  forex: 'markets.blurbForex',
};

/** Only equities have a listing venue and a sector; the other tabs would show blanks. */
const showsExchange = (assetClass) => assetClass === 'stocks';

export default function Markets() {
  const { t } = useTranslation();
  const [assetClass, setAssetClass] = useState('stocks');
  const [q, setQ] = useState('');
  const [onlyWatched, setOnlyWatched] = useState(false);
  /**
   * `null` means the server's own order, and that is the default rather than a
   * column, because the server's order is not reproducible here: equities are
   * ranked on market cap CONVERTED to USD, and re-deriving that client-side is
   * how Toyota's ¥4.8e13 outranked Apple twice already.
   */
  const [sort, setSort] = useState({ key: null, dir: 'desc' });

  // Query on the debounced value, not the raw input — typing "microsoft"
  // otherwise fires nine requests.
  const debouncedQ = useDebouncedValue(q, 300);

  const { data, isLoading } = useQuery({
    queryKey: keys.instruments(assetClass, debouncedQ),
    queryFn: () =>
      get('/market/instruments', {
        params: { assetClass, q: debouncedQ || undefined, limit: 100 },
      }),
    // Forex moves once a day, so polling it on the quote interval would be
    // 240 pointless requests between publications.
    refetchInterval: assetClass === 'forex' ? false : QUOTE_POLL_MS,
    placeholderData: (prev) => prev,
  });

  // Streamed ticks arrive over SSE and patch the polled rows in place, so the
  // table shows a price within milliseconds of the trade printing rather than
  // waiting for the next refetch.
  const { live, connected } = useLivePrices();
  const { isWatched, signedIn } = useWatchlist();

  const served = useMemo(() => data?.items ?? [], [data]);

  const watchedCount = useMemo(
    () => served.filter((r) => isWatched(assetClass, r.symbol)).length,
    [served, isWatched, assetClass],
  );

  const rows = useMemo(() => {
    const visible = onlyWatched
      ? served.filter((r) => isWatched(assetClass, r.symbol))
      : served;
    return sort.key ? sortRows(visible, sort, assetClass) : visible;
  }, [served, onlyWatched, isWatched, assetClass, sort]);

  const onSort = (key) =>
    setSort((s) =>
      // Third click on the same column returns to the server's order rather
      // than cycling back to descending — otherwise the default becomes
      // unreachable once you have sorted anything.
      s.key !== key
        ? { key, dir: 'desc' }
        : s.dir === 'desc'
          ? { key, dir: 'asc' }
          : { key: null, dir: 'desc' },
    );

  return (
    // Fills whatever shell it lands in: the app panel signed in, the marketing
    // page signed out. A fixed 1200px column left desktop gutters either side.
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-xl font-bold">{t('markets.title')}</h1>
            <LivePill connected={connected} sessions={data?.sessions} />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">{t(BLURB[assetClass])}</p>
        </div>

        <Input
          placeholder={t('markets.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('markets.searchInstruments')}
          className="w-full max-w-full sm:max-w-72"
        />
      </header>

      <Summary rows={served} assetClass={assetClass} searching={Boolean(debouncedQ)} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <Tabs
            tabs={ASSET_TABS}
            value={assetClass}
            onChange={(next) => {
              setAssetClass(next);
              // The sort keys are not shared across classes — forex has no
              // market cap — so a carried-over sort would silently do nothing.
              setSort({ key: null, dir: 'desc' });
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => setOnlyWatched((v) => !v)}
          aria-pressed={onlyWatched}
          className={[
            'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5',
            'text-sm font-medium transition-colors',
            onlyWatched
              ? 'border-transparent bg-green-tint text-gain'
              : 'border-cool-grey text-text-muted hover:text-text-body',
          ].join(' ')}
        >
          <Icon name="star" size={14} />
          Watchlist
          {/* Per class, because that is what this button filters. A user
              following only coins would otherwise read "6" on the stocks tab
              and then find it empty. */}
          <span className="font-numeric text-xs tabular-nums">{signedIn ? watchedCount : 0}</span>
        </button>
      </div>

      {/* ------------------------------------------------------- desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-mist/60">
              <th className={`${th} w-10 text-right`}>#</th>
              <th className={th}>{t('markets.instrument')}</th>
              {showsExchange(assetClass) && (
                <>
                  <th className={th}>{t('markets.exchange')}</th>
                  <th className={`${th} hidden 2xl:table-cell`}>{t('markets.sector')}</th>
                </>
              )}
              <SortHeader label={t('markets.price')} sortKey="price" sort={sort} onSort={onSort} />
              <SortHeader label={t('markets.change24h')} sortKey="changePct" sort={sort} onSort={onSort} />
              {/* Market cap and volume are blank for forex — an FX pair has
                  neither — so those two columns are dropped rather than
                  rendered as a column of dashes. */}
              {assetClass !== 'forex' && (
                <>
                  <SortHeader
                    label={t('markets.marketCap')}
                    sortKey="marketCap"
                    sort={sort}
                    onSort={onSort}
                    className="hidden lg:table-cell"
                  />
                  <SortHeader
                    label={t('markets.volume')}
                    sortKey="volume"
                    sort={sort}
                    onSort={onSort}
                    className="hidden xl:table-cell"
                  />
                </>
              )}
              <th className={`${th} text-right`}>{t('markets.status')}</th>
              <th className={`${th} w-14 text-right`}>
                <span className="sr-only">{t('markets.watchlist')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row
                key={`${r.assetClass}:${r.symbol}`}
                row={r}
                index={i}
                assetClass={assetClass}
                tick={livePrice(live, assetClass, r.symbol)}
              />
            ))}
          </tbody>
        </table>

        {!isLoading && rows.length === 0 && (
          <Empty onlyWatched={onlyWatched} signedIn={signedIn} assetClass={assetClass} />
        )}
      </div>

      {/* --------------------------------------------------------- mobile cards
          A seven-column table inside a horizontal scroller means the price —
          the one thing anyone came for — starts off screen. Below md the same
          rows render as cards instead, with price and change on the first line. */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <MobileRow
            key={`${r.assetClass}:${r.symbol}`}
            row={r}
            assetClass={assetClass}
            tick={livePrice(live, assetClass, r.symbol)}
          />
        ))}
        {!isLoading && rows.length === 0 && (
          <div className="rounded-xl border border-cool-grey bg-white shadow-card">
            <Empty onlyWatched={onlyWatched} signedIn={signedIn} assetClass={assetClass} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- sorting */

/**
 * PRICE SORTS ON THE USD FIGURE, never the native one. `priceCents` is the
 * listing's own currency — sorting on it ranks ¥2,940 above $214 and calls
 * Toyota the more expensive share. Same trap as market cap, one column over.
 */
const sortValue = (row, key, assetClass) => {
  if (key === 'price') {
    return assetClass === 'forex' ? (row.rate ?? 0) : (row.priceUsdCents ?? row.priceCents ?? 0);
  }
  return Number(row[key]) || 0;
};

function sortRows(rows, { key, dir }, assetClass) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      sign * (sortValue(a, key, assetClass) - sortValue(b, key, assetClass)) ||
      a.symbol.localeCompare(b.symbol),
  );
}

function SortHeader({ label, sortKey, sort, onSort, className = '' }) {
  const active = sort.key === sortKey;

  return (
    <th
      className={`${th} text-right ${className}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-text-body ${
          active ? 'text-text-body' : ''
        }`}
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-gain' : 'text-cool-grey'}>
          {active && sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

/* ------------------------------------------------------------------- summary */

/**
 * A market overview computed from the rows already on the page — no second
 * request, and nothing here that the table below does not also show.
 *
 * When a search is running these describe the MATCHES, not the market, so the
 * first card renames itself. Leaving it reading "Listings 3" would quietly
 * restate a filtered count as a market size.
 */
function Summary({ rows, assetClass, searching }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const up = rows.filter((r) => r.changePct > 0).length;
    const down = rows.filter((r) => r.changePct < 0).length;
    const ranked = [...rows].sort((a, b) => b.changePct - a.changePct);
    return { up, down, best: ranked[0], worst: ranked[ranked.length - 1] };
  }, [rows]);

  if (!stats) return null;

  // The first card renames itself while searching — "Listings 3" would quietly
  // misreport the universe as three instruments. Forex counts pairs, not listings.
  const noun = searching
    ? t('markets.matches')
    : t(assetClass === 'forex' ? 'markets.pairs' : 'markets.listings');

  return (
    <div className="mt-6 mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryCard label={noun}>
        <span className="font-numeric text-lg font-semibold tabular-nums">{rows.length}</span>
      </SummaryCard>

      <SummaryCard label={t('markets.advancing')}>
        <span className="flex items-baseline gap-2">
          <span className="font-numeric text-lg font-semibold tabular-nums text-gain">{stats.up}</span>
          <span className="font-numeric text-sm tabular-nums text-text-muted">
            / {t('markets.down', { count: stats.down })}
          </span>
        </span>
      </SummaryCard>

      <SummaryCard label={t('markets.topGainer')}>
        <Mover row={stats.best} assetClass={assetClass} />
      </SummaryCard>

      <SummaryCard label={t('markets.topLoser')}>
        <Mover row={stats.worst} assetClass={assetClass} />
      </SummaryCard>
    </div>
  );
}

function SummaryCard({ label, children }) {
  return (
    <div className="rounded-xl border border-cool-grey bg-white p-4 shadow-card">
      <div className="mb-1.5 text-xs text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Mover({ row, assetClass }) {
  return (
    <Link
      to={`/${assetClass}/${row.symbol}`}
      className="flex items-baseline gap-2 no-underline"
      title={row.name}
    >
      <span className="truncate font-mono text-md font-semibold text-text-body">{row.symbol}</span>
      <span
        className={`font-numeric text-sm font-medium tabular-nums ${
          row.changePct >= 0 ? 'text-gain' : 'text-loss'
        }`}
      >
        {pct(row.changePct)}
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------- live status */

/**
 * Three states, not two, and the third is the one that matters.
 *
 * A connected socket over an equity table that has not moved in hours reads as
 * a broken feed. It is not: measured, 1 stock tick against 113 crypto ticks in
 * the same 15 seconds, over the same connection. Crypto trades all day and the
 * NYSE does not, so a closed session has to say so rather than claim "Live".
 */
function LivePill({ connected, sessions }) {
  const { t } = useTranslation();
  const closed = sessions?.length && sessions.every((s) => !s.open);

  if (!connected) {
    return (
      <Pill tone="muted" dot="bg-slate" title={t('markets.reconnectingHint')}>
        {t('markets.reconnecting')}
      </Pill>
    );
  }

  if (closed) {
    const soonest = Math.min(...sessions.map((s) => s.minutesUntilOpen ?? Infinity));
    return (
      <Pill tone="muted" dot="bg-slate" title={sessions.map((s) => `${s.code} ${s.hours}`).join(' · ')}>
        Market closed
        {Number.isFinite(soonest) && ` · opens in ${untilLabel(soonest)}`}
      </Pill>
    );
  }

  return (
    <Pill tone="gain" dot="animate-pulse bg-gain" title={t('markets.liveHint')}>
      {t('common.live')}
    </Pill>
  );
}

function Pill({ tone, dot, title, children }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        tone === 'gain' ? 'bg-green-tint text-gain' : 'bg-mist text-text-muted'
      }`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- the rows */

/** Both layouts read the streamed tick the same way, so it is resolved once. */
function usePatched(row, tick) {
  // The streamed price wins when it exists: it is newer than the polled row by
  // definition. The change percentage stays as polled — a trade print carries
  // no reference to the previous close, so recomputing it here would be
  // inventing a number.
  return {
    ...row,
    priceCents: tick?.priceCents ?? row.priceCents,
    // FX moves in the fourth decimal, which cents cannot hold, so the pair
    // reads the raw streamed price instead.
    rate: tick?.price ?? row.rate,
  };
}

function Row({ row, index, assetClass, tick }) {
  const patched = usePatched(row, tick);

  return (
    <tr className="border-t border-cool-grey transition-colors first:border-t-0 hover:bg-mist">
      <td className={`${td} text-right font-numeric text-xs tabular-nums text-text-muted`}>
        {index + 1}
      </td>

      <td className={td}>
        {/* Every class has a detail screen now — the path carries the class,
            so /crypto/BTC and /forex/EURUSD resolve as readily as /stocks/AAPL. */}
        <Link to={`/${assetClass}/${row.symbol}`} className="no-underline">
          <Instrument row={row} />
        </Link>
      </td>

      {showsExchange(assetClass) && (
        <>
          <td className={`${td} text-text-muted`}>{row.exchange}</td>
          <td className={`${td} hidden text-text-muted 2xl:table-cell`}>{row.sector}</td>
        </>
      )}

      <td className={`${td} text-right font-numeric font-medium tabular-nums`}>
        <Price row={patched} assetClass={assetClass} />
      </td>

      <td className={`${td} text-right`}>
        <PriceChange value={row.changePct} size={12} pill className="justify-end" />
      </td>

      {assetClass !== 'forex' && (
        <>
          <td className={`${td} hidden text-right font-numeric text-text-muted tabular-nums lg:table-cell`}>
            {row.marketCap ? compact(row.marketCap, { prefix: '$' }) : '-'}
          </td>
          <td className={`${td} hidden text-right font-numeric text-text-muted tabular-nums xl:table-cell`}>
            {row.volume ? compact(row.volume) : '-'}
          </td>
        </>
      )}

      <td className={`${td} text-right`}>
        <Status row={row} assetClass={assetClass} />
      </td>

      <td className={`${td} text-right`}>
        <WatchButton row={row} assetClass={assetClass} size={30} />
      </td>
    </tr>
  );
}

function MobileRow({ row, assetClass, tick }) {
  const patched = usePatched(row, tick);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-cool-grey bg-white p-3 shadow-card">
      <Link to={`/${assetClass}/${row.symbol}`} className="min-w-0 flex-1 no-underline">
        <Instrument row={row} />
      </Link>

      <div className="shrink-0 text-right">
        <div className="font-numeric text-sm font-semibold tabular-nums">
          <Price row={patched} assetClass={assetClass} />
        </div>
        <PriceChange value={row.changePct} size={12} className="justify-end" />
      </div>

      <WatchButton row={row} assetClass={assetClass} size={32} />
    </div>
  );
}

function Instrument({ row }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Mark row={row} />
      <span className="min-w-0">
        <span className="block font-mono text-sm font-semibold text-text-body">{row.symbol}</span>
        <span className="block truncate text-xs text-text-muted">{row.name}</span>
      </span>
    </span>
  );
}

function Status({ row, assetClass }) {
  const { t } = useTranslation();
  // A seeded equity price is not a quote, and saying so in the column that
  // already carries Listed/Halted is cheaper than a whole extra column for the
  // eight rows it applies to.
  if (assetClass === 'stocks' && !row.live) {
    // The title sits on a wrapper because Badge takes no arbitrary attributes —
    // widening its props for one tooltip would put every DOM attribute on a
    // component whose whole job is a fixed skin.
    return (
      <span title={t('markets.delayedHint')}>
        <Badge variant="neutral">{t('common.delayed')}</Badge>
      </span>
    );
  }
  return <Badge variant={statusVariant(row.status)}>{row.status}</Badge>;
}

/** CoinGecko ships a logo per coin; equities and FX pairs fall back to a monogram. */
function Mark({ row }) {
  return (
    <AssetMark
      symbol={row.symbol}
      name={row.name}
      logoUrl={row.logoUrl}
      size={28}
      radius="rounded-md"
    />
  );
}

/**
 * FX is quoted to four or five decimals and is not money in the cents sense —
 * USDJPY at 158.70 is a rate, not a price — so it bypasses `money()` entirely
 * rather than rendering as "$1,587.00".
 */
function Price({ row, assetClass }) {
  if (assetClass === 'forex') {
    const dp = row.rate >= 50 ? 2 : 4;
    return <>{row.rate?.toFixed(dp)}</>;
  }
  return <>{money(row.priceCents, row.currency)}</>;
}

/** Three reasons a table can be empty, and they need three different sentences. */
function Empty({ onlyWatched, signedIn, assetClass }) {
  const { t } = useTranslation();
  const noun = assetClass === 'forex' ? 'currency' : 'ticker or name';

  if (onlyWatched && !signedIn) {
    return (
      <div className="px-6 py-16 text-center">
        <div className="text-base font-medium">{t('markets.signInWatchlist')}</div>
        <div className="mt-2 text-sm text-text-muted">
          Follow instruments across stocks, crypto and forex.{' '}
          <Link to="/auth?mode=signup" className="text-gain">
            {t('markets.openAccount')}
          </Link>
        </div>
      </div>
    );
  }

  if (onlyWatched) {
    return (
      <div className="px-6 py-16 text-center">
        <div className="text-base font-medium">{t('markets.watchlistEmpty')}</div>
        <div className="mt-2 text-sm text-text-muted">
          {t('markets.addHintPre')} <Icon name="plus" size={12} className="inline align-middle" />{' '}
          {t('markets.addHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-16 text-center">
      <div className="text-base font-medium">{t('markets.noMatch')}</div>
      <div className="mt-2 text-sm text-text-muted">Try a different {noun}.</div>
    </div>
  );
}

const th =
  'px-4 py-3 text-left text-xs font-medium text-text-muted whitespace-nowrap';
const td = 'px-4 py-3 text-sm';
