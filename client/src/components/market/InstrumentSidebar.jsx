import { useState } from 'react';
import Link from '../ui/Link';
import Button from '../ui/Button';
import Tabs from '../ui/Tabs';
import PriceChange from './PriceChange';
import { compact, money, qty } from '../../lib/format';
import AssetMark from './AssetMark';
import { useWatchlist } from '../../hooks/useWatchlist';
import { livePrice, useLivePrices } from '../../hooks/useLivePrices';

/**
 * The terminal's right rail.
 *
 * A TradingView chart page is a chart plus a rail, and the rail is what stops
 * the page being a dead end: every tab on it is either the numbers behind the
 * chart or a way to leave for another instrument without going back to the
 * table first.
 *
 * Everything here is real. There is no "Ideas" tab, no depth-of-market, no
 * drawing toolbar — this product has no order book and no annotation store, and
 * chrome that looks like a feature and does nothing is worse than a narrower
 * rail.
 *
 * It renders at every width. Below `xl` the terminal stacks it under the chart
 * rather than dropping it, because Details is where the key stats live now and
 * a phone that hid them would be missing the figures, not just the layout.
 */
export default function InstrumentSidebar({
  data,
  candles,
  assetClass,
  holding,
  buyingPowerCents = 0,
  signedIn,
  tradable,
  onTrade,
}) {
  // All three classes are tradable now, so all three get a Position tab. It
  // used to be equities-only because they were the only class with a holding.
  const tabs = [
    { value: 'details', label: 'Details' },
    { value: 'position', label: 'Position' },
  ];
  const [tab, setTab] = useState('details');

  return (
    <aside className="flex min-h-0 shrink-0 flex-col border-t border-white/10 xl:w-80 xl:border-t-0 xl:border-l 2xl:w-88">
      {/*
        TWO STACKED SECTIONS, not three tabs — and the watchlist is the one that
        is always on screen.

        Tabbing all three looked tidier and was wrong. This instrument's own
        figures are a short list: eleven rows for an equity, seven for a coin.
        Behind a tab on a 1080px screen that left roughly 500px of empty rail
        under them, which reads as unfinished. Meanwhile the watchlist — the one
        thing here that is unbounded, and the only reason this page is not a
        dead end — was hidden behind a click.

        So the instrument's numbers take the height they need at the top, and
        the watchlist takes everything left over. It is also what TradingView
        itself does: the watchlist is a permanent rail, not a tab.
      */}
      <div className="relative flex shrink-0 flex-col xl:max-h-[55%]">
        <div className="shrink-0 border-b border-white/10 px-3 py-2">
          <Tabs tabs={tabs} value={tab} onChange={setTab} onDark />
        </div>
        <div className="min-h-0 overflow-y-auto">
          {tab === 'details' && <Details data={data} candles={candles} assetClass={assetClass} />}
          {tab === 'position' && (
            <Position
              data={data}
              assetClass={assetClass}
              holding={holding}
              buyingPowerCents={buyingPowerCents}
              signedIn={signedIn}
              tradable={tradable}
              onTrade={onTrade}
            />
          )}
        </div>
        <ScrollFade />
      </div>

      <section className="relative flex min-h-0 flex-1 flex-col border-t border-white/10">
        <h2 className="m-0 shrink-0 border-b border-white/10 px-4 py-2.5 text-2xs font-medium tracking-wide text-text-on-deep-muted uppercase">
          Watchlist
        </h2>
        {/* Its own scroll, so a sixty-row list cannot lengthen the terminal and
            push the status bar off the bottom of the panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto max-xl:max-h-100">
          <WatchlistRail assetClass={assetClass} symbol={data.symbol} />
        </div>
        <ScrollFade />
      </section>
    </aside>
  );
}

/**
 * A fade at the foot of a scroll area.
 *
 * Both rails are capped and both cut a row in half at their boundary — measured
 * at 1280×900, the Details list ends mid-"Currency". A sliced row reads as a
 * rendering fault rather than as "there is more below", and this is the cheapest
 * honest correction: it costs nothing when the content is short, because a fade
 * from ink to transparent over ink is invisible.
 */
function ScrollFade() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-ink to-transparent"
    />
  );
}

/* ---------------------------------------------------------------- details */

/**
 * Every figure here is DERIVED FROM THE VISIBLE CANDLE SERIES rather than read
 * from a stored snapshot.
 *
 * `Stock` carries seeded `dayOpenCents` and `week52HighCents`, and they are
 * stale: AAPL's seeded 52-week high is $237.23 against a live quote of $309.35,
 * so rendering it would put a 52-week high beneath the current price on the
 * same panel. Open, high, low and last computed from the drawn points are
 * always consistent with the chart beside them, because they are the same
 * numbers.
 *
 * The labels carry the range for the same reason — "High" alone implies the
 * day, which is only true on 1D.
 */
function Details({ data, candles, assetClass }) {
  const p = candles.points;
  if (!p.length) return null;

  const fmt = candles.format;
  const rows = [
    ['Open', fmt(p[0].o)],
    [`High · ${candles.range}`, fmt(Math.max(...p.map((x) => x.h)))],
    [`Low · ${candles.range}`, fmt(Math.min(...p.map((x) => x.l)))],
    ['Last', fmt(p[p.length - 1].c)],
    // Volume is absent from CoinGecko's OHLC endpoint and market cap has no
    // meaning for a currency pair — the rows are dropped rather than dashed.
    data.volume ? ['Volume', compact(data.volume)] : null,
    data.marketCap ? ['Market cap', compact(data.marketCap, { prefix: '$' })] : null,
    // Seeded reference data, and labelled as such — Finnhub 401s fundamentals.
    data.reference?.peRatio ? ['P/E · ref', String(data.reference.peRatio)] : null,
    assetClass === 'forex'
      ? ['Pair', `${data.symbol.slice(0, 3)} / ${data.symbol.slice(3)}`]
      : null,
    assetClass !== 'forex' ? ['Currency', data.currency] : null,
    data.exchange ? ['Exchange', data.exchange] : null,
    data.sector ? ['Sector', data.sector] : null,
  ].filter(Boolean);

  return (
    <>
      <dl className="m-0 divide-y divide-white/6">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-xs whitespace-nowrap text-text-on-deep-muted">{label}</dt>
            <dd className="m-0 truncate font-numeric text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Equities only, and it rides along on the query that was already
          fetching `peRatio` — so it costs nothing and gives the rail something
          to say below a list that is short by the standards of the screen it is
          imitating. A currency pair has no description, and the rail is simply
          shorter there rather than padded. */}
      {data.about && (
        <div className="border-t border-white/6 px-4 py-4">
          <h2 className="m-0 text-2xs font-medium tracking-wide text-text-on-deep-muted uppercase">
            About
          </h2>
          <p className="mt-2 mb-0 text-xs leading-relaxed text-text-on-deep-muted">{data.about}</p>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- watchlist */

/**
 * The watchlist as a navigable rail, which is the point of putting it here: it
 * turns the instrument page into somewhere you can stay, rather than somewhere
 * you bounce back out of to the Markets table to reach the next symbol.
 *
 * Prices come off the SAME live hook the rest of the app shares — refcounted to
 * one EventSource — so a row here cannot disagree with the same row on
 * /markets, and forty rows cost one connection rather than forty.
 */
function WatchlistRail({ assetClass, symbol }) {
  const { items, isLoading, signedIn } = useWatchlist();
  const { live } = useLivePrices();

  if (!signedIn) {
    return (
      <Empty>
        <p className="m-0">Sign in to keep a watchlist and jump between instruments here.</p>
        <Button to="/auth?mode=signup" size="sm" className="mt-3">
          Get started
        </Button>
      </Empty>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-white/6" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <p className="m-0">
          Nothing followed yet. The <span className="text-text-on-deep">＋</span> beside any symbol
          adds it.
        </p>
      </Empty>
    );
  }

  return (
    <ul className="m-0 list-none divide-y divide-white/6 p-0">
      {items.map((item) => {
        const active = item.assetClass === assetClass && item.symbol === symbol;
        const tick = livePrice(live, item.assetClass, item.symbol);
        const isForex = item.assetClass === 'forex';
        const rate = tick?.price ?? item.rate;
        const priceCents = tick?.priceCents ?? item.priceCents;

        return (
          <li key={`${item.assetClass}:${item.symbol}`}>
            <Link
              to={`/${item.assetClass}/${item.symbol}`}
              // aria-current, not a colour alone: the active row is the page
              // you are already on and a screen reader has no other way to know.
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-4 py-2 no-underline transition-colors ${
                active ? 'bg-white/8' : 'hover:bg-white/5'
              }`}
            >
              {/* Through the shared mark, which this row previously bypassed —
                  it branched on `logoUrl` being present, and a present URL that
                  404s is not the same thing as an absent one. Without an
                  `onError` a dead logo left a broken image in the rail. */}
              <AssetMark
                symbol={item.symbol}
                name={item.name}
                logoUrl={item.logoUrl}
                size={28}
                radius="rounded-md"
                tone="deep"
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs font-medium text-text-on-deep">
                  {item.symbol}
                </span>
                <span className="block truncate text-2xs text-text-on-deep-muted">
                  {/* An entry can outlive its instrument — a coin that falls out
                      of CoinGecko's top 50 still exists in the database, and
                      saying so is what leaves the user a way to remove it. */}
                  {item.resolved ? item.name : 'Unavailable'}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="block font-numeric text-xs tabular-nums text-text-on-deep">
                  {!item.resolved
                    ? '—'
                    : isForex
                      ? rate?.toFixed(rate >= 50 ? 2 : 4)
                      : money(priceCents, item.currency)}
                </span>
                {item.resolved && <PriceChange value={item.changePct} size={11} onDark />}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- position */

/**
 * The holding, and — when there isn't one — the reason there isn't.
 *
 * An "0 shares" row would be noise, but an empty panel with no explanation is
 * worse on a tab the user deliberately opened. Each dead end says which one it
 * is: signed out, halted, or simply not held yet.
 */
function Position({ data, assetClass, holding, buyingPowerCents, signedIn, tradable, onTrade }) {
  if (!signedIn) {
    return (
      <Empty>
        <p className="m-0">Sign in to trade {data.symbol} and track the position here.</p>
        <Button to="/auth?mode=signup" size="sm" className="mt-3">
          Get started
        </Button>
      </Empty>
    );
  }

  if (!holding) {
    return (
      <Empty>
        <p className="m-0">No position in {data.symbol}.</p>
        <p className="mt-1 mb-0 text-2xs">Buying power {money(buyingPowerCents)}</p>
        <Button size="sm" className="mt-3" onClick={onTrade} disabled={!tradable}>
          Trade
        </Button>
      </Empty>
    );
  }

  const rows = [
    // "Shares" is wrong for a coin and for a currency pair, and `qty` trims the
    // trailing zeros a fractional quantity would otherwise carry.
    [assetClass === 'stocks' ? 'Shares' : 'Units', qty(holding.shares, assetClass)],
    ['Average cost', money(holding.avgCostCents ?? 0)],
    ['Cost basis', money(holding.costBasisCents ?? 0)],
    ['Market value', money(holding.marketValueCents ?? 0)],
  ];

  return (
    <div>
      <dl className="m-0 divide-y divide-white/6">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-xs text-text-on-deep-muted">{label}</dt>
            <dd className="m-0 font-numeric text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="text-xs text-text-on-deep-muted">Total return</dt>
          <dd className="m-0">
            {holding.totalReturnPct != null ? (
              <PriceChange value={holding.totalReturnPct} size={13} onDark />
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>

      <div className="px-4 py-4">
        <Button className="w-full" onClick={onTrade} disabled={!tradable}>
          Trade
        </Button>
        <p className="mt-3 mb-0 text-2xs text-text-on-deep-muted">
          Buying power {money(buyingPowerCents)}
        </p>
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="px-4 py-6 text-xs text-text-on-deep-muted">{children}</div>;
}
