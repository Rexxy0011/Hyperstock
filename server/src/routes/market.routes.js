import { Router } from 'express';
import { Stock } from '../models/Stock.js';
import { Exchange } from '../models/Exchange.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ApiError } from '../lib/ApiError.js';
import { generateCandles, SUPPORTED_RANGES } from '../market/mockCandles.js';
import { isOpen, minutesUntilOpen } from '../market/hours.js';
import { validate } from '../middleware/validate.js';
import { ASSET_CLASSES, getInstruments } from '../services/market.service.js';
import { getCandles } from '../services/candles.service.js';
import { stats as quoteStats } from '../market/refreshJob.js';
import { liveFeed } from '../market/liveFeed.js';
import * as twelvedata from '../market/providers/twelvedata.provider.js';
import { z } from 'zod';

const router = Router();

/** Symbols shown in the Landing ticker tape, in the design's order. */
const TAPE = ['AAPL', 'TSLA', 'NVDA', 'ASML', 'TSM', 'MSFT', 'AMZN'];

const publicStock = (s) => ({
  symbol: s.symbol,
  name: s.name,
  exchange: s.exchange,
  sector: s.sector,
  currency: s.currency,
  status: s.status,
  priceCents: s.priceCents,
  priceUsdCents: s.priceUsdCents,
  changePct: s.changePct,
  quoteAsOf: s.quoteAsOf,
});

router.get(
  '/ticker',
  asyncHandler(async (req, res) => {
    const symbols = req.query.symbols ? String(req.query.symbols).split(',') : TAPE;
    const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();

    // Preserve the requested order rather than Mongo's.
    const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
    const items = symbols.map((sym) => bySymbol.get(sym)).filter(Boolean).map(publicStock);

    res.json({ asOf: new Date().toISOString(), degraded: false, items });
  }),
);

router.get(
  '/exchanges',
  asyncHandler(async (req, res) => {
    const rows = await Exchange.find().sort({ displayOrder: 1 }).lean();
    res.json(
      rows.map((e) => ({
        code: e.code,
        name: e.name,
        region: e.region,
        hours: `${e.openTime}-${e.closeTime} ${e.tzLabel}`,
        openTime: e.openTime,
        closeTime: e.closeTime,
        timezone: e.timezone,
        currency: e.currency,
        stockCount: e.stockCount,
      })),
    );
  }),
);

/**
 * GET /api/market/status
 *
 * Whether prices are actually moving. Worth an endpoint because the failure is
 * otherwise invisible: with the refresh job off, every screen still renders a
 * full set of plausible prices — they simply never change again.
 */
/**
 * GET /api/market/stream — Server-Sent Events.
 *
 * SSE rather than a WebSocket because the traffic is one-way and the browser
 * side is `new EventSource(url)` with reconnection already built in. A socket
 * would mean writing that bookkeeping twice for no gain.
 *
 * The connection is deliberately cheap: it forwards ticks the feed already has
 * and never touches the database or the vendor, so a hundred open tabs cost a
 * hundred writes to a socket rather than a hundred requests to Finnhub.
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Node compresses via middleware upstream; buffering an event stream would
    // hold every tick until the buffer filled.
    'x-accel-buffering': 'no',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('status', liveFeed.status());

  const onTicks = (batch) => send('ticks', batch);
  const onStatus = (s) => send('status', s);
  liveFeed.on('ticks', onTicks);
  liveFeed.on('status', onStatus);

  // Proxies and load balancers close an idle stream. A comment line is a valid
  // SSE keep-alive and costs two bytes.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  ping.unref?.();

  req.on('close', () => {
    clearInterval(ping);
    liveFeed.off('ticks', onTicks);
    liveFeed.off('status', onStatus);
  });
});

router.get('/status', asyncHandler(async (req, res) => {
  const ageMs = quoteStats.lastRunAt ? Date.now() - quoteStats.lastRunAt.getTime() : null;

  /**
   * The US session, carried here so the client has ONE endpoint for "is
   * anything wrong or has anything changed" rather than polling feed health in
   * one place and reading a session off a per-symbol instrument response in
   * another. NASDAQ stands for both US venues: they keep the same hours, and
   * the instrument screens already compute their own row's exchange.
   */
  const nasdaq = await Exchange.findOne({ code: 'NASDAQ' }).lean();
  const session = nasdaq
    ? {
        code: nasdaq.code,
        open: isOpen(nasdaq),
        minutesUntilOpen: isOpen(nasdaq) ? 0 : minutesUntilOpen(nasdaq),
      }
    : null;

  res.json({
    session,
    live: Boolean(quoteStats.startedAt) && quoteStats.consecutiveFailures === 0,
    startedAt: quoteStats.startedAt,
    lastRunAt: quoteStats.lastRunAt,
    quoteAgeMs: ageMs,
    symbolsTracked: quoteStats.symbols,
    lastUpdated: quoteStats.updated,
    consecutiveFailures: quoteStats.consecutiveFailures,
    lastError: quoteStats.lastError,
    // The six exchanges the free tier cannot quote, stated rather than implied.
    liveExchanges: ['NYSE', 'NASDAQ'],
    stream: liveFeed.status(),
    // Whether the Twelve Data plan actually sells non-US venues. `false` on the
    // free tier, and worth reporting: the failure it guards against is a silent
    // one — a mis-detected plan re-probes every cycle and drains an 800/day
    // credit budget overnight, taking the candle charts with it.
    twelvedata: {
      configured: twelvedata.isConfigured(),
      coversNonUs: twelvedata.planCoversIntl(),
    },
  });
}));

/**
 * GET /api/market/instruments
 *
 * The Markets table for one asset class. Equities still have their own
 * paginated `/stocks` route — that one filters by exchange and sector against
 * Mongo, which crypto and forex have no equivalent of — so this sits alongside
 * it rather than replacing it.
 */
router.get(
  '/instruments',
  validate({
    query: z.object({
      assetClass: z.enum(/** @type {[string, ...string[]]} */ (ASSET_CLASSES)).default('stocks'),
      q: z.string().max(40).optional(),
      limit: z.coerce.number().int().min(1).max(250).default(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { assetClass, q, limit } = req.validatedQuery;
    res.json(await getInstruments({ assetClass, q, limit }));
  }),
);

router.get(
  '/stocks',
  asyncHandler(async (req, res) => {
    const { exchange, sector, q } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const filter = {};
    if (exchange && exchange !== 'All') filter.exchange = exchange;
    if (sector) filter.sector = sector;
    if (q) {
      filter.$or = [
        { symbol: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ];
    }

    const [rows, total] = await Promise.all([
      Stock.find(filter)
        .sort({ symbol: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Stock.countDocuments(filter),
    ]);

    res.json({ items: rows.map(publicStock), total, page, limit });
  }),
);

/**
 * GET /api/market/instruments/:assetClass/:symbol
 *
 * The detail record for any tradable row, whatever class it belongs to.
 *
 * Equities keep their own `/stocks/:symbol` route because they have fields the
 * other classes do not — sector, P/E, 52-week range, an `about` paragraph — and
 * they come from Mongo rather than a cached vendor list. This one exists so the
 * Crypto and Forex tabs can link somewhere at all: their rows live only in the
 * market service's cache, so there is nothing to look up by primary key.
 */
router.get(
  '/instruments/:assetClass/:symbol',
  asyncHandler(async (req, res) => {
    const assetClass = String(req.params.assetClass).toLowerCase();
    if (!ASSET_CLASSES.includes(assetClass)) {
      throw ApiError.notFound(`No asset class ${req.params.assetClass}`);
    }

    const symbol = String(req.params.symbol).toUpperCase();
    const { items, resolution } = await getInstruments({ assetClass, limit: 250 });
    const row = items.find((i) => i.symbol.toUpperCase() === symbol);
    if (!row) throw ApiError.notFound(`No ${assetClass} listing ${symbol}`);

    // Candles are NO LONGER simulated for every class. Crypto gets real OHLC
    // from CoinGecko and forex real daily closes from the ECB; equities have no
    // free source and keep the seeded walk. `candles.service.js` picks, and the
    // response says which — see `simulated` and `hasRange` on the payload.
    const range = String(req.query.range ?? '1M').toUpperCase();
    if (!SUPPORTED_RANGES.includes(range)) {
      throw ApiError.badRequest('BAD_RANGE', `range must be one of ${SUPPORTED_RANGES.join(', ')}`);
    }

    /**
     * Equities carry a few reference figures the other classes have no
     * equivalent of. They are SEEDED, not live — Finnhub 401s the fundamentals
     * endpoints — so they travel under `reference` with the date they were
     * taken, and the client labels them rather than mixing them in beside live
     * numbers.
     *
     * The 52-week range is deliberately NOT included: it is anchored to the
     * seeded price and the live quote has since moved past it, so AAPL would
     * render a 52-week high of $237.23 beneath a live price of $309.35. The
     * page derives a range from the real candle series instead.
     */
    let reference;
    let about;
    if (assetClass === 'stocks') {
      const doc = await Stock.findOne({ symbol: row.symbol })
        .select('peRatio referenceAsOf about')
        .lean();
      if (doc?.peRatio) reference = { peRatio: doc.peRatio, asOf: doc.referenceAsOf };
      // Free-riding on the query that was already being made for `peRatio`, so
      // the terminal's rail gets a description at no extra round trip. Only
      // equities have one — a currency pair has nothing to describe.
      about = doc?.about;
    }

    /**
     * Whether THIS venue is trading, for the terminal's status bar.
     *
     * The markets list computes sessions for NYSE and NASDAQ only, because they
     * are the two it can claim live prices for. A page about a single Euronext
     * listing still has to say Euronext is shut — otherwise its unmoving price
     * reads as a broken feed, which is the exact failure `hours.js` exists to
     * prevent.
     *
     * Looked up by the row's own casing: `Exchange.code` stores the design's
     * `Euronext`, and uppercasing it here would match nothing.
     */
    let session;
    if (assetClass === 'stocks') {
      const venue = await Exchange.findOne({ code: row.exchange }).lean();
      if (venue) {
        session = {
          code: venue.code,
          open: isOpen(venue),
          minutesUntilOpen: minutesUntilOpen(venue),
          hours: `${venue.openTime}-${venue.closeTime} ${venue.tzLabel}`,
        };
      }
    }

    res.json({
      ...row,
      resolution,
      ...(reference && { reference }),
      ...(about && { about }),
      ...(session && { session }),
      candles: await getCandles(
        {
          assetClass,
          symbol: row.symbol,
          exchange: row.exchange,
          priceCents: row.priceCents,
          vendorId: row.vendorId,
        },
        range,
      ),
    });
  }),
);

router.get(
  '/stocks/:symbol',
  asyncHandler(async (req, res) => {
    const stock = await Stock.findOne({ symbol: req.params.symbol.toUpperCase() }).lean();
    if (!stock) throw ApiError.notFound(`No stock ${req.params.symbol}`);

    res.json({
      ...publicStock(stock),
      about: stock.about,
      // The design's Key stats card renders 8 label/value pairs. The mockup
      // referenced a `stats` array its script never returned, so it is defined
      // here. Raw numbers — the client formats them.
      keyStats: {
        openCents: stock.dayOpenCents,
        highCents: stock.dayHighCents,
        lowCents: stock.dayLowCents,
        volume: stock.volume,
        peRatio: stock.peRatio,
        marketCap: stock.marketCap,
        week52LowCents: stock.week52LowCents,
        week52HighCents: stock.week52HighCents,
      },
      referenceAsOf: stock.referenceAsOf,
    });
  }),
);

router.get(
  '/stocks/:symbol/candles',
  asyncHandler(async (req, res) => {
    const range = String(req.query.range ?? '1M').toUpperCase();
    if (!SUPPORTED_RANGES.includes(range)) {
      throw ApiError.badRequest('BAD_RANGE', `range must be one of ${SUPPORTED_RANGES.join(', ')}`);
    }

    const stock = await Stock.findOne({ symbol: req.params.symbol.toUpperCase() }).lean();
    if (!stock) throw ApiError.notFound(`No stock ${req.params.symbol}`);

    res.json({
      symbol: stock.symbol,
      currency: stock.currency,
      ...generateCandles(stock.symbol, stock.priceCents, range),
    });
  }),
);

export default router;
