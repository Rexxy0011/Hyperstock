import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
} from 'lightweight-charts';

/**
 * The price chart, on TradingView's Lightweight Charts.
 *
 * WHICH TRADINGVIEW PRODUCT, because there are three and only one of them fits:
 *
 *   Advanced Chart widget   an iframe carrying TRADINGVIEW'S OWN DATA. It would
 *                           discard every price this product fetches, ignore the
 *                           live socket, and draw intraday forex wicks the ECB
 *                           never published. Rejected on those grounds, not on
 *                           licensing.
 *   Charting Library        self-hosted, needs an access request and a UDF
 *                           datafeed adapter. A much larger build for the same
 *                           picture.
 *   Lightweight Charts      Apache-2.0, on npm, renders OUR data. This.
 *
 * So the chrome is TradingView's and the numbers stay ours — the Twelve Data
 * OHLC, the CoinGecko OHLC, the ECB closes, and the forming bar patched from the
 * socket all arrive here exactly as before.
 */

/** Brand colours, resolved once — the library takes strings, not CSS vars. */
const UP = '#00c853';
const DOWN_LIGHT = '#e53935';
/** --color-loss reaches only 4.48:1 on ink; this is the deep-surface pair. */
const DOWN_DARK = '#ef5350';

/**
 * `--font-numeric`, resolved to a plain string for the canvas.
 *
 * Lightweight Charts paints to a canvas, which no stylesheet reaches, so the
 * family has to be handed over as a value. Reading the token keeps theme.css
 * the single owner of what a figure looks like; the fallback matters only if
 * this ever runs before the stylesheet has applied.
 */
const numericFontFamily = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--font-numeric').trim() ||
  'system-ui, sans-serif';

/**
 * `height` is the reason this is annotated: it accepts a number OR the string
 * 'fill', and checkJs infers `number` from the default alone.
 *
 * @param {{
 *   points?: {t:number,o:number,h:number,l:number,c:number,v?:number}[],
 *   divisor?: number,
 *   decimals?: number,
 *   chartType?: 'candles' | 'area',
 *   hasVolume?: boolean,
 *   dark?: boolean,
 *   height?: number | 'fill',
 *   seriesKey?: string,
 * }} props
 */
export default function TvChart({
  points = [],
  divisor = 100,
  decimals = 2,
  chartType = 'candles',
  hasVolume = false,
  dark = false,
  /**
   * A pixel height, or 'fill' to take the height of the flex slot it is given.
   *
   * 'fill' is what the terminal layout uses: the chart is the page there, not a
   * band inside a card, so its height is whatever is left after the symbol bar,
   * the price strip and the status bar have taken theirs. `autoSize` already
   * wires up a ResizeObserver, so the only thing this switches is whether a
   * fixed height is written onto the container.
   */
  height = 340,
  /** Changes whenever the underlying series changes — see setData vs update. */
  seriesKey = '',
}) {
  const fill = height === 'fill';
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const priceRef = useRef(null);
  const volRef = useRef(null);
  const lastRef = useRef(null);
  const [legend, setLegend] = useState(null);

  const down = dark ? DOWN_DARK : DOWN_LIGHT;

  /* ------------------------------------------------------- create / destroy */
  useEffect(() => {
    const chart = createChart(boxRef.current, {
      ...(fill ? {} : { height }),
      // autoSize wires up a ResizeObserver internally, so the chart follows the
      // panel through breakpoints without a resize handler here.
      autoSize: true,
      layout: {
        // Transparent, not a colour: the ink panel behind it is the background,
        // and painting our own would put a second near-black on top of it.
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: dark ? '#9ca3af' : '#6b7280',
        // Both axes are entirely figures, so they take the numeric face like
        // every other number — left on the mono face they disagreed with the
        // headline price directly above them. Read from the stylesheet rather
        // than repeated here: the canvas is outside CSS's reach, and a copied
        // stack is a second definition waiting to drift from the first.
        fontFamily: numericFontFamily(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
        horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
      },
      crosshair: {
        // Magnet snaps the crosshair to OHLC values rather than floating between
        // them, which is what makes the readout trustworthy.
        mode: CrosshairMode.Magnet,
        vertLine: { color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)', labelBackgroundColor: dark ? '#1f2937' : '#111111' },
        horzLine: { color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)', labelBackgroundColor: dark ? '#1f2937' : '#111111' },
      },
      rightPriceScale: {
        borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
        // Without a top margin the highest gridline sits flush against the
        // canvas edge and its label is clipped in half. The bottom margin
        // leaves the volume overlay somewhere to live when there is one.
        scaleMargins: { top: 0.1, bottom: hasVolume ? 0.22 : 0.1 },
      },
      timeScale: {
        borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
        // Intraday ranges need the clock; daily ones do not. Cheap to always
        // allow — the library hides it when the spacing makes it meaningless.
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
      lastRef.current = null;
    };
    // Theme and type rebuild the chart rather than mutating it: a series cannot
    // change kind in place, and the option churn is not worth the branching.
  }, [dark, height, fill, chartType, hasVolume]);

  /* --------------------------------------------------------------- the data */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;

    const scale = (v) => v / divisor;
    const priceFormat = {
      type: 'price',
      precision: decimals,
      minMove: 1 / 10 ** decimals,
    };

    // Lightweight Charts requires STRICTLY ASCENDING, UNIQUE times and throws
    // on a duplicate rather than ignoring it. Our adapters are ordered, but the
    // forming bar is appended client-side, so this is cheap insurance.
    const seen = new Set();
    const rows = [];
    for (const p of points) {
      const time = Math.floor(p.t / 1000);
      if (seen.has(time)) continue;
      seen.add(time);
      rows.push({ time, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v });
    }
    rows.sort((a, b) => a.time - b.time);

    const priceData =
      chartType === 'candles'
        ? rows.map((r) => ({
            time: r.time,
            open: scale(r.o),
            high: scale(r.h),
            low: scale(r.l),
            close: scale(r.c),
          }))
        : rows.map((r) => ({ time: r.time, value: scale(r.c) }));

    if (!priceRef.current) {
      priceRef.current =
        chartType === 'candles'
          ? chart.addSeries(CandlestickSeries, {
              upColor: UP,
              downColor: down,
              borderUpColor: UP,
              borderDownColor: down,
              wickUpColor: UP,
              wickDownColor: down,
              priceFormat,
            })
          : chart.addSeries(AreaSeries, {
              lineColor: UP,
              topColor: 'rgba(0,200,83,0.28)',
              bottomColor: 'rgba(0,200,83,0.02)',
              lineWidth: 2,
              priceFormat,
            });

      if (hasVolume) {
        volRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          // An empty priceScaleId overlays the histogram on its own invisible
          // scale, so volume cannot squash the price axis.
          priceScaleId: '',
          // Both OFF or the histogram publishes its own last value onto the
          // price axis — a red "716.05K" tag sitting under the real price, on a
          // scale that is not the price scale, plus a horizontal line across
          // the plot at the last bar's volume.
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volRef.current.priceScale().applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
      }
    }

    /**
     * setData RESETS THE VISIBLE RANGE. Calling it on every tick would yank the
     * chart back to its default zoom about once a second and make panning
     * impossible, so a full set is reserved for an actual series change —
     * symbol, range or chart type — and live ticks go through `update`, which
     * patches the last bar in place or appends a newer one.
     */
    const changed = lastRef.current !== seriesKey;
    if (changed) {
      priceRef.current.setData(priceData);
      if (volRef.current) {
        volRef.current.setData(
          rows.map((r) => ({
            time: r.time,
            value: r.v,
            color: r.c >= r.o ? 'rgba(0,200,83,0.45)' : `${down}73`,
          })),
        );
      }
      chart.timeScale().fitContent();
      lastRef.current = seriesKey;
    } else {
      try {
        const lastBar = priceData[priceData.length - 1];
        if (lastBar) {
          priceRef.current.update(lastBar);
        }
        if (volRef.current && rows.length > 0) {
          const r = rows[rows.length - 1];
          volRef.current.update({
            time: r.time,
            value: r.v,
            color: r.c >= r.o ? 'rgba(0,200,83,0.45)' : `${down}73`,
          });
        }
      } catch {
        // Fallback to setData on timestamp ordering anomalies or series sync mismatches
        priceRef.current.setData(priceData);
        if (volRef.current) {
          volRef.current.setData(
            rows.map((r) => ({
              time: r.time,
              value: r.v,
              color: r.c >= r.o ? 'rgba(0,200,83,0.45)' : `${down}73`,
            })),
          );
        }
      }
    }
  }, [points, divisor, decimals, chartType, hasVolume, down, seriesKey]);

  /* ------------------------------------------------------------- the legend */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onMove = (param) => {
      if (!param?.time || !priceRef.current) return setLegend(null);
      const bar = param.seriesData.get(priceRef.current);
      if (!bar) return setLegend(null);
      setLegend(
        bar.close != null
          ? { o: bar.open, h: bar.high, l: bar.low, c: bar.close, up: bar.close >= bar.open }
          : { c: bar.value, up: true },
      );
    };

    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chartType, dark]);

  const fmt = (v) =>
    v == null ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className={fill ? 'relative h-full' : 'relative'}>
      <div
        ref={boxRef}
        style={fill ? undefined : { height }}
        className={fill ? 'h-full w-full' : 'w-full'}
      />

      {/* The OHLC readout sits over the plot, as it does on a real terminal —
          putting it below would move the chart every time the pointer entered. */}
      {legend && (
        <div
          className={`pointer-events-none absolute top-2 left-2 flex gap-3 rounded-md px-2.5 py-1.5 font-numeric text-2xs tabular-nums ${
            dark ? 'bg-white/8 text-text-on-deep' : 'bg-ink/85 text-white'
          }`}
        >
          {legend.o != null && (
            <>
              <span>
                <span className="opacity-60">O</span> {fmt(legend.o)}
              </span>
              <span>
                <span className="opacity-60">H</span> {fmt(legend.h)}
              </span>
              <span>
                <span className="opacity-60">L</span> {fmt(legend.l)}
              </span>
            </>
          )}
          <span style={{ color: legend.up ? UP : down }}>
            <span className="opacity-60">C</span> {fmt(legend.c)}
          </span>
        </div>
      )}
    </div>
  );
}
