import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FiArrowLeft } from 'react-icons/fi';
import Link from '../components/ui/Link';
import { get } from '../lib/api';
import { keys, QUOTE_POLL_MS } from '../lib/queryClient';
import { decodeTrade } from '../lib/tradeIntent';
import { money, pct, untilLabel } from '../lib/format';
import AssetMark from '../components/market/AssetMark';
import { livePrice, useLivePrices } from '../hooks/useLivePrices';
import { useLiveCandles } from '../hooks/useLiveCandles';
import Badge, { statusVariant } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Tabs from '../components/ui/Tabs';
import PriceChange from '../components/market/PriceChange';
import TvChart from '../components/charts/TvChart';
import WatchButton from '../components/market/WatchButton';
import TradeModal from '../components/market/TradeModal';
import InstrumentSidebar from '../components/market/InstrumentSidebar';
import { useAuth } from '../auth/AuthProvider';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

/**
 * Forex has no 1D. The ECB publishes one reference rate per business day, so an
 * intraday series does not exist to draw — the tab is dropped rather than
 * offered and then answered with a single bar.
 */
const rangesFor = (assetClass) =>
  assetClass === 'forex' ? RANGES.filter((r) => r !== '1D') : RANGES;

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'area', label: 'Line' },
];

/**
 * THE TERMINAL — one screen for all three asset classes.
 *
 * /stocks/AAPL, /crypto/BTC and /forex/EURUSD all land here. The class is in
 * the path rather than a query string because these are three different kinds
 * of thing and a pasted URL should still say which.
 *
 * The layout is a TradingView chart page, and the reason is that the chart is
 * the product on this screen — not an illustration inside a card. So it gets
 * the height: symbol bar, price strip, chart filling everything left over, and
 * a status bar underneath, with a rail down the right that carries the numbers
 * behind the chart and a way out to the next instrument.
 *
 *   ┌──────────────────────────────────────────────┬────────────┐
 *   │ ← AAPL Apple Inc · NASDAQ │ 1D 1W 1M │ Candles│ Details    │
 *   ├──────────────────────────────────────────────┤ Watchlist  │
 *   │ $309.35  +3.72 (+1.22%) today      Live      │ Position   │
 *   │                                              │            │
 *   │                  CHART                       │  Open …    │
 *   │                                              │  High …    │
 *   ├──────────────────────────────────────────────┴────────────┤
 *   │ NASDAQ · Open  ·  4h bars  ·  Real OHLC from Twelve Data  │
 *   └───────────────────────────────────────────────────────────┘
 *
 * The whole thing is ONE DARK PANEL. Candle greens and reds carry more
 * separation against ink than against white — which is why every trading screen
 * in the world is dark — and a single surface means the eye never crosses a
 * boundary between a number and the chart explaining it. The surface is
 * `--color-ink` / `--color-text-on-deep`, already used by Landing's dark
 * sections; nothing new was invented for it.
 */
export default function Instrument({ assetClass }) {
  const { symbol } = useParams();
  const [range, setRange] = useState('1M');
  // Annotated because TvChart's `chartType` is a union and `useState('candles')`
  // would widen it to `string`.
  const [chartType, setChartType] = useState(/** @type {'candles' | 'area'} */ ('candles'));
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeSide, setTradeSide] = useState(/** @type {'BUY'|'SELL'} */ ('BUY'));
  /** Non-null only on the return leg of a funding trip. */
  const [resumeQty, setResumeQty] = useState(/** @type {string|null} */ (null));

  /**
   * COMING BACK FROM FUNDING. The terminal is the other screen a trade can be
   * started from, so it reads the same `?trade=` the ticket writes before it
   * leaves for `/fund` — otherwise funding from here dropped the user back on a
   * chart with no memory of the order they went to pay for.
   *
   * Consumed on arrival: left in the URL, a refresh would reopen a ticket that
   * has already been dealt with.
   */
  const [params, setParams] = useSearchParams();
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    const intent = decodeTrade(params.get('trade'));
    if (!intent) return;
    resumed.current = true;

    setTradeSide(intent.side);
    setResumeQty(intent.quantity);
    setTradeOpen(true);
    params.delete('trade');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const { live, connected } = useLivePrices();
  const { user, authReady } = useAuth();
  const signedIn = authReady && Boolean(user);

  // The position in this symbol, for the rail's Position tab and the ticket's
  // sell side. All three classes can be held now, so this is no longer gated.
  const { data: portfolio } = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => get('/portfolio'),
    enabled: signedIn,
    staleTime: 30_000,
  });

  const { data, isPending, error } = useQuery({
    queryKey: keys.instrument(assetClass, symbol, range),
    queryFn: () => get(`/market/instruments/${assetClass}/${symbol}?range=${range}`),
    // Forex publishes once a business day; polling it on the quote interval
    // would be hundreds of identical requests between publications.
    refetchInterval: assetClass === 'forex' ? false : QUOTE_POLL_MS,
    placeholderData: (prev) => prev,
  });

  const tick = livePrice(live, assetClass, symbol);

  // Above the early returns: hooks may not run conditionally, and there are two
  // bail-outs below this line.
  const candles = useLiveCandles(data, assetClass, tick, connected);

  if (error) {
    return (
      <Shell>
        <Panel>
          <div className="p-8">
            <h1 className="m-0 text-xl font-bold">Not found</h1>
            <p className="mt-2 text-sm text-text-on-deep-muted">
              No {assetClass} listing for <span className="font-mono">{symbol}</span>.
            </p>
            <Button to="/markets" variant="secondary" onDark className="mt-6">
              Back to markets
            </Button>
          </div>
        </Panel>
      </Shell>
    );
  }

  if (isPending || !data) return <Loading />;

  const isForex = assetClass === 'forex';
  // Patched in place from the socket. `data` is still the source for everything
  // else on the page — only the headline price is newer than the last poll.
  const priceCents = tick?.priceCents ?? data.priceCents;
  const rate = tick?.price ?? data.rate;
  // MATCHED ON THE PAIR, never the symbol alone — the same rule the holding
  // itself is keyed by. `ETH` is a coin here and a plausible ticker elsewhere.
  const holding =
    portfolio?.holdings?.find(
      (h) => h.symbol === data.symbol && (h.assetClass ?? 'stocks') === assetClass,
    ) ?? null;
  const tradable = data.status === 'Listed';

  return (
    <Shell>
      <Panel>
        {/* ---------------------------------------------------- symbol bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-white/10 px-3 py-3 sm:px-4">
          {/* The way back lives in the bar rather than above the panel: a
              terminal that gives the chart the viewport cannot spend a row on
              a breadcrumb. */}
          <Link
            to="/markets"
            aria-label="Back to markets"
            title="Back to markets"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-on-deep-muted no-underline transition-colors hover:bg-white/8 hover:text-text-on-deep"
          >
            <FiArrowLeft size={16} aria-hidden="true" />
          </Link>

          <div className="flex min-w-0 items-center gap-2.5">
            <Mark row={data} />
            <div className="min-w-0">
              {/* TICKER FIRST, name beneath. On a market screen the symbol is
                  the identifier people scan for; the company name is context.
                  text-md/500 — this is a toolbar label, not a page title, and
                  at text-lg it was competing with the price two inches to its
                  right for the same job. */}
              <h1 className="m-0 truncate font-mono text-md font-medium tracking-tight">
                {data.symbol}
              </h1>
              <p className="m-0 truncate text-2xs text-text-on-deep-muted">
                {data.name}
                {!isForex && ` · ${data.exchange}`}
              </p>
            </div>
          </div>

          <span className="hidden h-6 w-px shrink-0 bg-white/10 lg:block" aria-hidden="true" />

          {/* Ordered last below `lg` so a phone reads [← AAPL … Trade ＋] on
              one line and drops the range/type controls to a full-width row
              beneath, rather than stranding the two buttons on a line of their
              own. At lg the bar is one row and the source order is the visual
              order again. */}
          <div className="order-last flex w-full flex-wrap items-center gap-2 lg:order-0 lg:w-auto">
            <Tabs tabs={rangesFor(assetClass)} value={range} onChange={setRange} numeric onDark />
            <span className="hidden h-4 w-px bg-white/15 sm:block" aria-hidden="true" />
            <Tabs tabs={CHART_TYPES} value={chartType} onChange={setChartType} onDark />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <TradeAction
              signedIn={signedIn}
              onOpen={() => setTradeOpen(true)}
              tradable={tradable}
            />
            <WatchButton row={data} assetClass={assetClass} size={38} onDark />
          </div>
        </div>

        {/* -------------------------------------------- chart column + rail */}
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* PRICE STRIP. The two percentages on this screen answer different
                questions and used to sit unlabelled beside each other — the
                headline is the 24h/session move, the one on the right is the
                return over the range the chart is drawing. Both now say so. */}
            <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {/*
                  text-xl (24px), NOT text-2xl.

                  32px is the page-title size — the same one "Markets" and "My
                  Portfolio" render their h1 at — and a price set at it reads as
                  a heading rather than a figure. Geist Mono makes that worse
                  than a proportional face would: its digits are wide and
                  geometric by design, so the scale that flatters a 13px table
                  column looks like code blown up at display size. At 24px it is
                  still comfortably the largest number on the screen, with
                  nothing else above 16px.
                */}
                <span className="font-numeric text-xl font-medium tabular-nums">
                  {isForex ? rate?.toFixed(rate >= 50 ? 2 : 4) : money(priceCents, data.currency)}
                </span>
                <span className="flex items-baseline gap-2">
                  <AbsoluteChange
                    isForex={isForex}
                    rate={rate}
                    priceCents={priceCents}
                    changePct={data.changePct}
                    currency={data.currency}
                  />
                  <span className="text-2xs text-text-on-deep-muted">
                    {assetClass === 'stocks' ? 'today' : '24h'}
                  </span>
                </span>
                <Freshness row={data} assetClass={assetClass} />
              </div>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xs text-text-on-deep-muted">
                <span className="font-numeric tabular-nums">{candles.spanLabel}</span>
                {candles.periodPct != null && (
                  <span className="flex items-baseline gap-1.5">
                    <PriceChange value={candles.periodPct} size={12} onDark />
                    <span>over {candles.range}</span>
                  </span>
                )}
                {candles.isLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-gain/15 px-2 py-0.5 font-medium text-gain">
                    <span
                      className="size-1.5 animate-pulse rounded-full bg-gain"
                      aria-hidden="true"
                    />
                    Live
                  </span>
                )}
              </div>
            </div>

            {/* THE CHART TAKES WHAT IS LEFT. `min-h-0` is load-bearing: a flex
                child defaults to min-height:auto, so without it the canvas
                refuses to shrink and pushes the status bar off the panel.
                Below xl the panel is not viewport-height, so a fixed height is
                given instead of a share of nothing. */}
            <div className="min-h-0 flex-1 px-1 pb-1">
              <div className="h-90 lg:h-120 xl:h-full">
                <TvChart
                  points={candles.points}
                  divisor={candles.divisor}
                  decimals={candles.decimals}
                  chartType={chartType}
                  hasVolume={candles.hasVolume}
                  height="fill"
                  dark
                  // Identifies the SERIES, not the data. A change here means a
                  // full setData (which resets zoom); anything else is a live
                  // tick and goes through `update`, so panning survives a
                  // moving market.
                  seriesKey={`${assetClass}:${symbol}:${range}:${chartType}`}
                />
              </div>
            </div>
          </div>

          <InstrumentSidebar
            data={data}
            candles={candles}
            assetClass={assetClass}
            holding={holding}
            buyingPowerCents={portfolio?.summary?.buyingPowerCents ?? 0}
            signedIn={signedIn}
            tradable={tradable}
            onTrade={() => setTradeOpen(true)}
          />
        </div>

        <StatusBar data={data} candles={candles} assetClass={assetClass} />
      </Panel>

      <TradeModal
        open={tradeOpen}
        onClose={() => {
          setTradeOpen(false);
          setResumeQty(null);
        }}
        initialSide={tradeSide}
        initialQuantity={resumeQty}
        instrument={data}
        assetClass={assetClass}
        /* NANOS is the one the ticket prices and the guard compares on. The
           cents figure is passed only as a fallback, and for forex it is not
           even cents — it is the rate scaled by 10,000. */
        priceUsdNanos={data.priceUsdNanos}
        priceUsdCents={data.priceUsdCents ?? priceCents}
        holding={holding}
      />
    </Shell>
  );
}

/* ----------------------------------------------------------------- shell */

function Shell({ children }) {
  // py-4, not the py-10 the other pages use: the panel IS the page here, and
  // every pixel spent above it comes off the chart.
  return <div className="w-full px-4 py-4 sm:px-5 lg:px-7 2xl:px-9">{children}</div>;
}

/**
 * THE PANEL IS VIEWPORT-HEIGHT ON DESKTOP, and the subtraction is measured
 * rather than guessed: the sticky nav renders at 65px and the dashboard footer
 * at 67px, plus this page's own 16px of padding top and bottom — 164px, so
 * 10.25rem. Landing exactly on the fold is what lets the terminal fill the
 * screen AND keep the footer visible, which is the complaint that produced the
 * flex-column shell in the first place.
 *
 * Below `xl` it is not height-constrained at all. A phone has no room to give a
 * chart 60% of a short viewport and still show a rail, so the panel grows to
 * its content and the page scrolls normally.
 */
function Panel({ children }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-ink text-text-on-deep xl:h-[calc(100dvh-10.25rem)] xl:min-h-160">
      {children}
    </div>
  );
}

/**
 * The skeleton takes the SHAPE OF THE TERMINAL, not a couple of bars at the
 * top of it.
 *
 * That matters more here than on an ordinary page: the panel is viewport-height
 * from the first paint, so a small placeholder in the corner leaves 800px of
 * flat ink underneath and reads as a page that has failed rather than one that
 * is loading. A cold candle fetch can take a few seconds — the vendor cache is
 * empty after every server restart — so this is a state people will see.
 */
function Loading() {
  const bar = 'animate-pulse rounded-md bg-white/8';

  return (
    <Shell>
      <Panel>
        <div
          className="flex shrink-0 items-center gap-4 border-b border-white/10 px-4 py-3"
          aria-hidden="true"
        >
          <div className={`size-8 ${bar}`} />
          <div className={`h-6 w-28 ${bar}`} />
          <div className={`h-7 w-72 ${bar}`} />
          <div className={`ml-auto h-8 w-28 ${bar}`} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col xl:flex-row" aria-hidden="true">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 px-4 py-3 sm:px-5">
              <div className={`h-8 w-56 ${bar}`} />
            </div>
            <div className="min-h-0 flex-1 px-1 pb-1">
              <div className={`h-90 rounded-md bg-white/5 lg:h-120 xl:h-full ${bar}`} />
            </div>
          </div>

          <div className="hidden shrink-0 space-y-4 border-l border-white/10 p-4 xl:block xl:w-80 2xl:w-88">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={`h-4 ${bar}`} style={{ width: `${90 - i * 6}%` }} />
            ))}
          </div>
        </div>

        <div className="h-9 shrink-0 border-t border-white/10" aria-hidden="true" />
      </Panel>
      {/* The only text in the state, and it is for a screen reader rather than
          the eye — the pulse says the same thing visually. */}
      <span className="sr-only" role="status">
        Loading market data
      </span>
    </Shell>
  );
}

/* --------------------------------------------------------------- toolbar */

/**
 * The primary action, and it is not the same action for all three classes.
 *
 * Equities are tradable; crypto and forex are not, because this product has no
 * position model for them — there is no crypto Holding, no FX pair in the
 * ledger. The button is still RENDERED for those classes rather than hidden, so
 * the three pages share one layout, but it is disabled and says why on hover.
 * Hiding it would leave an unexplained gap where the primary action sits.
 */
function TradeAction({ signedIn, onOpen, tradable }) {
  if (!signedIn) {
    // A link, not a disabled button: signing in is the actual next step, and
    // /stocks/:symbol is reachable signed out.
    return (
      <Button to="/auth?mode=signup" size="sm">
        Trade
      </Button>
    );
  }

  if (!tradable) {
    return (
      <span title="This listing is halted and cannot be traded">
        <Button variant="secondary" size="sm" disabled onDark>
          Trade
        </Button>
      </span>
    );
  }

  return (
    <Button size="sm" onClick={onOpen}>
      Trade
    </Button>
  );
}

/**
 * Says where the number came from. Every class has a different answer and none
 * of them is "live tick", so leaving it off would let all three read as one.
 */
function Freshness({ row, assetClass }) {
  if (assetClass === 'forex') {
    return (
      <span title="Streaming OANDA rate; the daily change is against the ECB publication">
        <Badge variant="approved">Live FX</Badge>
      </span>
    );
  }
  if (assetClass === 'stocks' && !row.live) {
    return (
      <span title="Reference price — this venue needs a paid data plan">
        <Badge variant="neutral">Delayed</Badge>
      </span>
    );
  }
  return <Badge variant={statusVariant(row.status)}>{row.status}</Badge>;
}

/**
 * "+3.72" beside the percentage, the way a terminal quotes a move.
 *
 * DERIVED, not fetched: the API sends a percentage and a price, and the
 * previous close is `price / (1 + pct/100)`. That is exact rather than an
 * approximation, and it means the two figures cannot disagree — a separate
 * `changeCents` field could go stale against a socket-patched price.
 */
function AbsoluteChange({ isForex, rate, priceCents, changePct, currency }) {
  const now = isForex ? rate : priceCents;
  const pctValue = Number(changePct) || 0;
  if (!Number.isFinite(now) || pctValue === -100) {
    return <PriceChange value={pctValue} size={13} onDark />;
  }

  const previous = now / (1 + pctValue / 100);
  const delta = now - previous;
  const up = pctValue >= 0;
  const abs = isForex
    ? Math.abs(delta).toFixed(rate >= 50 ? 2 : 4)
    : money(Math.round(Math.abs(delta)), currency);

  return (
    <span
      className={`inline-flex items-baseline gap-1.5 font-numeric text-sm font-medium tabular-nums ${
        up ? 'text-gain' : 'text-loss-deep'
      }`}
    >
      {/* U+2212, not a hyphen — the same convention PriceChange owns for the
          percentage, and the two sit side by side. */}
      <span>
        {up ? '+' : '−'}
        {abs}
      </span>
      <span>({pct(pctValue)})</span>
    </span>
  );
}

/* ------------------------------------------------------------ status bar */

/**
 * The bottom rule, and every field on it is a claim the page would otherwise be
 * making silently.
 *
 * A closed venue is the important one: an equity price that has not moved in
 * four hours is not a broken feed, but nothing on the screen says so unless
 * this does. Crypto and forex answer the same question differently, so they get
 * their own sentence rather than a shared vague one.
 *
 * The attribution belongs here for the same reason it used to sit under the
 * chart: two of the three classes draw real history and one does not, and a
 * seeded walk that terminates at the real price is indistinguishable from the
 * real thing once drawn.
 */
function StatusBar({ data, candles, assetClass }) {
  const session = data.session;

  let venue;
  if (assetClass === 'crypto') {
    venue = 'Crypto · trades 24/7';
  } else if (assetClass === 'forex') {
    venue = 'ECB reference · one publication per business day';
  } else if (session) {
    venue = session.open
      ? `${session.code} · Open`
      : `${session.code} · Closed${
          Number.isFinite(session.minutesUntilOpen)
            ? ` · opens in ${untilLabel(session.minutesUntilOpen)}`
            : ''
        }`;
  } else {
    venue = data.exchange;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 px-4 py-2 text-2xs text-text-on-deep-muted sm:px-5">
      <span
        className="inline-flex items-center gap-1.5"
        title={session?.hours ? `Trading hours ${session.hours}` : undefined}
      >
        <span
          className={`size-1.5 rounded-full ${
            assetClass === 'stocks' && session && !session.open ? 'bg-slate' : 'bg-gain'
          }`}
          aria-hidden="true"
        />
        {venue}
      </span>
      {candles.interval && (
        <>
          <Dot />
          <span className="font-mono">{candles.interval} bars</span>
        </>
      )}
      <Dot />
      <span className="min-w-0">{candles.caption}</span>
    </div>
  );
}

const Dot = () => (
  <span className="text-text-on-deep-muted/50" aria-hidden="true">
    ·
  </span>
);

/**
 * CoinGecko ships a logo per coin; equities and FX pairs get a monogram.
 *
 * 24px, sized to the two lines of text beside it rather than to the bar. At
 * 32px it was taller than the ticker and the company name stacked together,
 * which made a vendor's logo the first thing the eye landed on — on a screen
 * whose subject is a price.
 */
function Mark({ row }) {
  return (
    <AssetMark
      symbol={row.symbol}
      name={row.name}
      logoUrl={row.logoUrl}
      size={24}
      radius="rounded-sm"
      // The panel is ink, so a solid ink chip would vanish into it.
      tone="deep"
    />
  );
}
