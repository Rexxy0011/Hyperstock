import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import Link from '../components/ui/Link';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { keys, QUOTE_POLL_MS } from '../lib/queryClient';
import { decodeTrade } from '../lib/tradeIntent';
import { money, pct, qty as fmtQty } from '../lib/format';
import AssetMark from '../components/market/AssetMark';
import { useWatchlist } from '../hooks/useWatchlist';
import Icon from '../components/ui/Icon';
import StatCard from '../components/market/StatCard';
import Sparkline from '../components/charts/Sparkline';
import TvChart from '../components/charts/TvChart';
import DonutChart from '../components/charts/DonutChart';
import Button from '../components/ui/Button';
import Tabs from '../components/ui/Tabs';
import TradeModal from '../components/market/TradeModal';
import { useAuth } from '../auth/AuthProvider';
import { livePrice, useLivePrices } from '../hooks/useLivePrices';
import { useLiveCandles } from '../hooks/useLiveCandles';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
const RANGE_LABEL = { '1D': '1 Day', '1W': '1 Week', '1M': '1 Month', '3M': '3 Month', '1Y': '1 Year', ALL: 'All' };

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'area', label: 'Line' },
];

/** `${assetClass}:${symbol}` — a symbol alone no longer identifies a position. */
const idOf = (h) => `${h.assetClass ?? 'stocks'}:${h.symbol}`;

export default function Portfolio() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState('1W');
  // Annotated because TvChart's `chartType` is a union that useState would
  // otherwise widen to `string`.
  const [chartType, setChartType] = useState(/** @type {'candles' | 'area'} */ ('candles'));
  /**
   * The ticket's open state AND which side it opens on, in one value: null is
   * closed. Two booleans would allow "open on no side", which is not a state
   * the ticket has.
   */
  const [tradeSide, setTradeSide] = useState(/** @type {'BUY'|'SELL'|null} */ (null));
  /** Non-null only on the return leg of a funding trip — see the effect below. */
  const [resumeQty, setResumeQty] = useState(/** @type {string|null} */ (null));

  const { user, authReady } = useAuth();
  const signedIn = authReady && Boolean(user);

  /**
   * COMING BACK FROM FUNDING, with the order still to place.
   *
   * `?trade=stocks:AAPL:BUY:100` is written by the ticket before it leaves for
   * `/fund`, so the trip is a round trip: the position is reselected, the
   * ticket reopens on the same side, and the quantity is the one that could not
   * be afforded — now, hopefully, affordable. Without this, funding dropped the
   * user back on a portfolio page with no memory of why they went.
   *
   * The param is CONSUMED on arrival: left in the URL, a refresh or a Back
   * would reopen a ticket the user has already dealt with.
   */
  const [params, setParams] = useSearchParams();
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    const intent = decodeTrade(params.get('trade'));
    if (!intent) return;
    resumed.current = true;

    setSelected(`${intent.assetClass}:${intent.symbol}`);
    setResumeQty(intent.quantity);
    setTradeSide(intent.side);
    params.delete('trade');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const { data: portfolio, isLoading } = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => get('/portfolio'),
    refetchInterval: QUOTE_POLL_MS,
  });

  // Through the shared hook rather than its own query, so removing something
  // here and removing it from /markets hit the same cache entry.
  const { items: watchlist, remove } = useWatchlist();

  const holdings = portfolio?.holdings ?? [];
  /**
   * Defaults to the largest position until one is picked. Derived rather than
   * synced into state by an effect — `holdings` is a new array every render, so
   * an effect keyed on it would re-run continuously.
   *
   * Keyed by CLASS AND SYMBOL, not symbol alone: a position is now a pair, and
   * the same ticker can legitimately exist in two of them.
   */
  const active = holdings.find((h) => idOf(h) === selected) ?? holdings[0] ?? null;

  const s = portfolio?.summary;

  return (
    <div className="flex w-full flex-col gap-5 px-4 pt-1 sm:px-5 lg:px-7 2xl:px-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-xl font-bold text-void">{t('portfolio.title')}</h1>
        {/*
          MONEY IN, MONEY OUT — the two directions, named for what they do.

          Practice funds used to sit here and does not any more. It is still
          reachable, and from the one place it is actually wanted: the trade
          ticket offers it by name when an order is short of buying power,
          prefilled with the exact shortfall. A header button for it competed
          with the two real cash paths and put simulated capital on the same
          footing as a payment, which is the confusion the two names exist to
          prevent.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" to="/withdraw">
            {t('portfolio.withdraw')}
          </Button>
          <Button size="sm" to="/fund">
            {t('portfolio.deposit')}
          </Button>
        </div>
      </div>

      {/* Headline figures. On a 1920 viewport the reference composition left
          ~200px of dead space; this is real content rather than stretched air. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          loading={isLoading}
          label={t('portfolio.portfolioValue')}
          value={money(s?.portfolioValueCents ?? 0)}
          changePct={s?.todayChangePct}
          sub={t('portfolio.today')}
        />
        <StatCard
          loading={isLoading}
          label={t('portfolio.allTimeReturn')}
          value={money(s?.allTimeReturnCents ?? 0, 'USD', { signed: true })}
          changePct={s?.allTimeReturnPct}
        />
        <StatCard loading={isLoading} label={t('portfolio.buyingPower')} value={money(s?.buyingPowerCents ?? 0)} />
        <StatCard
          loading={isLoading}
          label={t('portfolio.positions')}
          value={String(s?.positionsCount ?? 0)}
          sub={t('portfolio.exchanges', { count: s?.exchangeCount ?? 0 })}
        />
      </div>

      <HoldingsRail
        holdings={holdings}
        loading={isLoading}
        activeId={active ? idOf(active) : null}
        onSelect={setSelected}
      />

      {/* Two rows of chart+aside rather than one tall aside. Pairing cards of
          similar height stops either column ending in a block of dead space. */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ChartCard
          holding={active}
          range={range}
          onRange={setRange}
          chartType={chartType}
          onChartType={setChartType}
          signedIn={signedIn}
          onTrade={setTradeSide}
        />
        <Watchlist items={watchlist} onRemove={remove} />
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <HoldingsTable holdings={holdings} onSelect={setSelected} />
        {portfolio?.allocation?.length > 0 && (
          <section className="min-w-0 rounded-xl border border-cool-grey p-4 sm:p-5 overflow-hidden">
            <h2 className="mb-4 text-md font-bold text-void">{t('portfolio.allocation')}</h2>
            <DonutChart slices={portfolio.allocation} />
          </section>
        )}
      </div>

      {/* Keyed by pair, so switching the selected position while the ticket is
          shut cannot leave a stale instrument behind it. The ticket carries its
          own top-up path when an order is short of funds. */}
      {active && (
        <TradeModal
          key={idOf(active)}
          open={tradeSide !== null}
          onClose={() => {
            setTradeSide(null);
            setResumeQty(null);
          }}
          initialSide={tradeSide ?? 'BUY'}
          initialQuantity={resumeQty}
          instrument={active}
          assetClass={active.assetClass ?? 'stocks'}
          priceUsdCents={active.priceUsdCents}
          priceUsdNanos={active.priceUsdNanos}
          holding={active}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------- holdings table */

function HoldingsTable({ holdings, onSelect }) {
  const { t } = useTranslation();
  if (!holdings.length) return null;

  const th =
    'border-b border-cool-grey px-4 py-2.5 text-left text-2xs font-medium text-text-muted whitespace-nowrap';
  const td = 'border-b border-cool-grey/70 px-4 py-3 text-sm whitespace-nowrap';

  return (
    <section className="min-w-0 rounded-xl border border-cool-grey overflow-hidden">
      <h2 className="px-5 py-4 text-md font-bold text-void">{t('portfolio.holdings')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('portfolio.ticker')}</th>
              <th className={th}>{t('portfolio.exchange')}</th>
              <th className={`${th} text-right`}>{t('portfolio.quantity')}</th>
              <th className={`${th} text-right`}>{t('portfolio.avgCost')}</th>
              <th className={`${th} text-right`}>{t('portfolio.price')}</th>
              <th className={`${th} text-right`}>{t('portfolio.marketValue')}</th>
              <th className={`${th} text-right`}>{t('portfolio.totalReturn')}</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr
                key={idOf(h)}
                onClick={() => onSelect(idOf(h))}
                className="cursor-pointer transition-colors last:[&>td]:border-b-0 hover:bg-hover/50"
              >
                <td className={td}>
                  <div className="flex items-center gap-2.5">
                    <AssetMark symbol={h.symbol} name={h.name} logoUrl={h.logoUrl} size={28} />
                    <span>
                      <span className="block font-mono text-xs font-bold text-void">
                        {h.symbol}
                      </span>
                      <span className="block text-2xs text-text-muted">{h.name}</span>
                    </span>
                  </div>
                </td>
                <td className={`${td} text-text-muted`}>{h.exchange}</td>
                {/* fmtQty, never the raw value: a crypto position genuinely
                    stores 0.30000000000000004, and printing it as-is is how a
                    float artefact reaches the user. */}
                <td className={`${td} text-right font-numeric tabular-nums`}>
                  {fmtQty(h.shares, h.assetClass)}
                </td>
                <td className={`${td} text-right font-numeric tabular-nums text-text-muted`}>
                  {money(h.avgCostCents)}
                </td>
                <td className={`${td} text-right font-numeric tabular-nums`}>
                  {/* A position whose instrument the vendor no longer lists is
                      valued at its last known price, or at cost if there is
                      not one — it is still counted, so it has to say that the
                      number is not a live quote. */}
                  {h.resolved === false ? (
                    <span title={t('portfolio.staleQuote')}>
                      {money(h.priceCents, h.currency)}
                      <span className="ml-1.5 text-2xs text-text-muted">stale</span>
                    </span>
                  ) : (
                    money(h.priceCents, h.currency)
                  )}
                </td>
                <td className={`${td} text-right font-numeric font-semibold tabular-nums`}>
                  {money(h.marketValueCents)}
                </td>
                <td className={`${td} text-right`}>
                  <span
                    className={`font-numeric text-xs font-semibold tabular-nums ${
                      h.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
                    }`}
                  >
                    {pct(h.totalReturnPct)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- holdings rail */

function HoldingsRail({ holdings, loading, activeId, onSelect }) {
  const { t } = useTranslation();
  const railRef = useRef(null);

  const scrollNext = () => {
    railRef.current?.scrollBy({ left: 240, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-26 animate-pulse rounded-xl bg-hover" />
        ))}
      </div>
    );
  }

  if (!holdings.length) {
    return (
      <div className="rounded-xl border border-cool-grey px-6 py-10 text-center">
        <div className="text-sm font-semibold text-void">{t('portfolio.noPositions')}</div>
        <p className="mx-auto mt-1 max-w-80 text-xs text-text-muted">
          Your first $10,000 is already in your account. Pick a stock to place your first order.
        </p>
        <Link
          to="/markets"
          className="mt-4 inline-flex rounded-lg bg-gain px-4 py-2 text-sm font-semibold text-white no-underline"
        >
          {t('portfolio.browseMarkets')}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={railRef}
        className="flex snap-x gap-4 overflow-x-auto pb-1 scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        {holdings.map((h) => (
          <HoldingCard
            key={idOf(h)}
            holding={h}
            active={idOf(h) === activeId}
            onSelect={() => onSelect(idOf(h))}
          />
        ))}
      </div>

      {holdings.length > 3 && (
        <button
          type="button"
          onClick={scrollNext}
          aria-label={t('portfolio.scrollPositions')}
          className="absolute top-1/2 -right-2 hidden size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border border-cool-grey bg-white text-text-muted shadow-card transition-colors hover:text-void lg:flex"
        >
          <Icon name="chevronRight" size={16} />
        </button>
      )}
    </div>
  );
}

function HoldingCard({ holding: h, active, onSelect }) {
  const { t } = useTranslation();
  /**
   * A cheap, deterministic shape for the card sparkline: the position's own
   * return arc, from average cost to current value per unit.
   *
   * Derived from `marketValueCents / shares` rather than from `priceUsdCents`,
   * which is not comparable to a cost basis for two of the three classes — a
   * forex row's is the rate scaled by 10,000, so the arc ran from ~117 to
   * ~11,664 and drew a vertical line on every FX position.
   */
  const nowPerUnit = h.shares ? h.marketValueCents / h.shares : h.avgCostCents;
  const spark = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    return (
      h.avgCostCents +
      (nowPerUnit - h.avgCostCents) * t * (0.75 + 0.5 * Math.abs(Math.sin(i * 1.7)))
    );
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-57 shrink-0 snap-start cursor-pointer rounded-xl border p-4 text-left transition-colors',
        active ? 'border-void/25 bg-hover/50' : 'border-cool-grey hover:bg-hover/40',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AssetMark symbol={h.symbol} name={h.name} logoUrl={h.logoUrl} size={24} />
          <span className="truncate text-sm font-bold text-void">{h.name}</span>
        </div>
        <Sparkline data={spark} width={54} height={22} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-2xs text-text-muted">{t('portfolio.marketValue')}</span>
        <span className="font-numeric text-sm font-bold tabular-nums text-void">
          {money(h.marketValueCents)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-2xs text-text-muted">{t('portfolio.totalReturn')}</span>
        <span
          className={`font-numeric text-xs font-semibold tabular-nums ${
            h.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
          }`}
        >
          {pct(h.totalReturnPct)}
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------- chart card */

/**
 * The position chart — TradingView candles, on whatever class the position is.
 *
 * It used to call `/market/stocks/:symbol` and `/market/stocks/:symbol/candles`,
 * which are the EQUITY routes. Now that a holding can be a coin or a currency
 * pair those 404, so this goes through the one class-aware endpoint the
 * instrument terminal uses — which returns the quote and the candles together,
 * so it is also one request instead of two.
 *
 * `useLiveCandles` is the terminal's hook, reused wholesale: it patches the
 * forming bar from the tick stream and it carries the per-class divisor, so an
 * FX pair does not get drawn on a cents axis. The chart is therefore live here
 * too, which it was not before.
 */
function ChartCard({ holding, range, onRange, chartType, onChartType, onTrade, signedIn }) {
  const { t } = useTranslation();
  const assetClass = holding?.assetClass ?? 'stocks';
  const symbol = holding?.symbol;

  const { live, connected } = useLivePrices();
  const tick = livePrice(live, assetClass, symbol);

  const { data } = useQuery({
    queryKey: keys.instrument(assetClass, symbol, range),
    queryFn: () => get(`/market/instruments/${assetClass}/${symbol}?range=${range}`),
    enabled: Boolean(symbol),
    // Forex publishes once a business day; polling it on the quote interval
    // would be hundreds of identical requests between publications.
    refetchInterval: assetClass === 'forex' ? false : QUOTE_POLL_MS,
    placeholderData: (prev) => prev,
  });

  // Above the early return — hooks may not run conditionally.
  const candles = useLiveCandles(data, assetClass, tick, connected);

  if (!symbol) {
    return <div className="min-h-105 rounded-xl border border-cool-grey" />;
  }

  const isForex = assetClass === 'forex';
  const rate = tick?.price ?? data?.rate;
  const priceCents = tick?.priceCents ?? data?.priceCents;
  // The card is driven by a HOLDING, so there is always a position — but a dust
  // row can round to nothing, and offering to sell that is offering to fail.
  const held = (holding?.shares ?? 0) > 0;
  const tradable = !data || data.status === 'Listed';

  return (
    <section className="rounded-xl border border-cool-grey p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AssetMark
            symbol={symbol}
            name={data?.name ?? holding.name}
            logoUrl={data?.logoUrl ?? holding.logoUrl}
            size={36}
          />
          <div>
            <div className="text-md font-bold text-void">{data?.name ?? holding.name}</div>
            {/* A link out to the full terminal — this card is a summary, and
                the trade ticket lives over there. */}
            <Link
              to={`/${assetClass}/${symbol}`}
              className="font-mono text-2xs text-text-muted no-underline hover:text-void"
            >
              {symbol} ↗
            </Link>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            {data && (
              <span
                className={`rounded-md px-1.5 py-0.5 font-numeric text-2xs font-semibold tabular-nums ${
                  data.changePct >= 0 ? 'bg-green-tint text-gain' : 'bg-red-tint text-loss'
                }`}
              >
                {pct(data.changePct)}
              </span>
            )}
            <span className="font-numeric text-lg font-bold tabular-nums text-void">
              {!data
                ? '-'
                : isForex
                  ? rate?.toFixed(rate >= 50 ? 2 : 4)
                  : money(priceCents, data.currency)}
            </span>
          </div>
          <div className="mt-0.5 text-2xs text-text-muted">
            {candles.isLive ? 'Live' : `Updated ${new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}`}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-cool-grey p-0.5">
          {RANGES.filter((r) => !(isForex && r === '1D')).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              className={[
                'cursor-pointer rounded-md px-2.5 py-1.5 text-2xs font-medium transition-colors',
                r === range ? 'bg-ink text-white' : 'text-text-muted hover:text-void',
              ].join(' ')}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        <Tabs tabs={CHART_TYPES} value={chartType} onChange={onChartType} />
      </div>

      <div className="mt-4">
        <TvChart
          points={candles.points}
          divisor={candles.divisor}
          decimals={candles.decimals}
          chartType={chartType}
          hasVolume={candles.hasVolume}
          height={320}
          seriesKey={`${assetClass}:${symbol}:${range}:${chartType}`}
        />
      </div>

      {/*
        TRADE WHERE THE CHART IS.

        This card used to be a summary with a link out to the terminal, which
        made acting on what it shows a two-screen job: read the chart here, open
        /stocks/AAPL, find Trade. The ticket is the same component the terminal
        opens and it is keyed to whatever is selected, so the shorter path costs
        nothing and removes the one reason to leave the page.

        Two buttons rather than one, because Buy and Sell are different
        intentions and a ticket that opens on the wrong side reads as a missed
        click. Sell is `outline-red` and only appears for something actually
        held — a Sell button over a position of zero is an offer to fail.
      */}
      <div className="mt-4 flex items-center gap-2 border-t border-cool-grey pt-4">
        {signedIn ? (
          <>
            <Button size="sm" onClick={() => onTrade('BUY')} disabled={!tradable} className="flex-1">
              {t('trade.buy')}
            </Button>
            {held && (
              <Button
                size="sm"
                variant="outline-red"
                onClick={() => onTrade('SELL')}
                disabled={!tradable}
                className="flex-1"
              >
                {t('trade.sell')}
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" to="/auth" className="flex-1">
            {t('portfolio.signInToTrade')}
          </Button>
        )}
      </div>

      {/* Same attribution the terminal carries, and for the same reason: a
          seeded walk that terminates at the real price is indistinguishable
          from real history once drawn. */}
      <p className="mt-3 mb-0 text-2xs text-text-muted">
        {candles.caption}
        {candles.interval ? ` ${candles.interval} bars.` : ''}
        {!tradable && data ? ` ${symbol} is ${String(data.status).toLowerCase()} - not tradable.` : ''}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- watchlist */

function Watchlist({ items, onRemove }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-cool-grey p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-md font-bold text-void">{t('portfolio.watchlist')}</h2>
        <Link
          to="/markets"
          aria-label={t('portfolio.addToWatchlist')}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-lg border border-cool-grey text-text-muted no-underline transition-colors hover:border-gain hover:text-gain"
        >
          <Icon name="plus" size={14} />
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-xs text-text-muted">
          {t('portfolio.watchlistEmpty')}
        </p>
      ) : (
        <div className="flex flex-col">
          {items.map((s, i) => (
            // The row is a flex container holding a link and a button, NOT a
            // link wrapping both — a <button> inside an <a> is invalid HTML and
            // swallows the click on whichever the browser decides wins.
            <div
              key={`${s.assetClass}:${s.symbol}`}
              className={`group flex items-center gap-3 py-3 ${
                i < items.length - 1 ? 'border-b border-cool-grey/70' : ''
              }`}
            >
              <Link
                to={`/${s.assetClass}/${s.symbol}`}
                className="flex min-w-0 flex-1 items-center gap-3 no-underline"
              >
                <AssetMark
                  symbol={s.symbol}
                  name={s.name}
                  logoUrl={s.logoUrl}
                  size={32}
                  tone="mist"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-bold text-void">{s.symbol}</div>
                  <div className="truncate text-2xs text-text-muted">{s.name}</div>
                </div>
                <div className="text-right">
                  {/* An entry whose instrument no longer resolves — a coin that
                      has left the top 50 — keeps its row so it can be removed,
                      rather than rendering a confident $0.00. */}
                  {s.resolved ? (
                    <>
                      <div className="font-numeric text-xs font-bold tabular-nums text-void">
                        {s.assetClass === 'forex'
                          ? s.rate?.toFixed(s.rate >= 50 ? 2 : 4)
                          : money(s.priceCents, s.currency)}
                      </div>
                      <div
                        className={`font-numeric text-2xs font-medium tabular-nums ${
                          s.changePct >= 0 ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {pct(s.changePct)}
                      </div>
                    </>
                  ) : (
                    <div className="text-2xs text-text-muted">Unavailable</div>
                  )}
                </div>
              </Link>

              {/* Hidden until the row is hovered or the button is tabbed to, so
                  six remove buttons do not compete with six prices for
                  attention on a card this narrow. */}
              <button
                type="button"
                onClick={() => onRemove({ assetClass: s.assetClass, symbol: s.symbol })}
                aria-label={`Remove ${s.symbol} from watchlist`}
                title={t('common.removeFromWatchlist')}
                className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-text-muted opacity-0 transition-all hover:border-loss hover:text-loss focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon name="minus" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
