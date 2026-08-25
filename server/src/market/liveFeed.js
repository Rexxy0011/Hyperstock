import { EventEmitter } from 'node:events';
import { env } from '../config/env.js';

/**
 * The real-time price feed: one Finnhub WebSocket, fanned out to every client.
 *
 * WHY A SOCKET AND NOT A SHORTER INTERVAL. The REST quote endpoint is one call
 * per symbol against 60 calls a minute. Refreshing 17 symbols every 5 seconds
 * would be 204 calls a minute — over budget on its own, before news spends any
 * of it. The socket costs one connection and delivers every trade as it prints,
 * so "seconds" is not a compromise between freshness and quota; it removes the
 * trade-off entirely.
 *
 * ONE SOCKET FOR TWO ASSET CLASSES. Finnhub streams US equities and crypto over
 * the same connection — crypto as `BINANCE:BTCUSDT` — so this replaces what
 * would otherwise be a Binance socket alongside it. Measured on the live key:
 * 66 messages in 12 seconds, all crypto, because the US market was closed.
 *
 * FOREX IS NOT HERE. Finnhub's forex stream is a paid resource and the ECB
 * publishes once a business day, so those rows stay daily. Pretending otherwise
 * would mean inventing ticks.
 *
 * The socket is a CACHE WARMER, not the source of truth. Ticks land in memory
 * and are flushed to Mongo on a timer — see `flushIntervalMs` — because a trade
 * print every few milliseconds is not a write every few milliseconds.
 */
const WS_URL = 'wss://ws.finnhub.io';

/** Finnhub's free tier caps a connection at 50 symbols. */
const MAX_SYMBOLS = 50;

/** Crypto is quoted against Tether on Binance, which is what Finnhub relays. */
export const cryptoStreamSymbol = (symbol) => `BINANCE:${symbol.toUpperCase()}USDT`;

/**
 * Forex streams as OANDA pairs — `EURUSD` on our side is `OANDA:EUR_USD`.
 *
 * WORTH KNOWING BEFORE YOU TRUST THE DOCS: Finnhub's free tier returns 403 for
 * every forex REST call (`/forex/rates`, and `/quote?symbol=OANDA:EUR_USD`)
 * but streams the same pairs over the WebSocket without complaint — measured,
 * 24 ticks in 12 seconds. So the daily ECB rates still back the table's opening
 * state and its change column, and the socket makes the rate itself live.
 */
export const forexStreamSymbol = (symbol) =>
  `OANDA:${symbol.slice(0, 3).toUpperCase()}_${symbol.slice(3).toUpperCase()}`;

const streamSymbolFor = (symbol, assetClass) => {
  if (assetClass === 'crypto') return cryptoStreamSymbol(symbol);
  if (assetClass === 'forex') return forexStreamSymbol(symbol);
  return symbol.toUpperCase();
};

class LiveFeed extends EventEmitter {
  constructor() {
    super();
    /** @type {WebSocket | null} */
    this.ws = null;
    /** streamSymbol -> { priceCents, at } */
    this.prices = new Map();
    /** streamSymbol -> { symbol, assetClass } */
    this.subscriptions = new Map();
    this.connected = false;
    this.attempts = 0;
    this.ticks = 0;
    this.lastTickAt = /** @type {Date | null} */ (null);
    this.stopped = true;
    // Many listeners is the normal case here: one per open SSE client.
    this.setMaxListeners(0);
  }

  isConfigured() {
    return Boolean(env.FINNHUB_API_KEY || env.MARKET_DATA_API_KEY);
  }

  /**
   * @param {{symbol: string, assetClass: string}[]} instruments
   */
  setSubscriptions(instruments) {
    const next = new Map();
    for (const { symbol, assetClass } of instruments) {
      if (next.size >= MAX_SYMBOLS) break;
      next.set(streamSymbolFor(symbol, assetClass), { symbol, assetClass });
    }

    // Diff rather than resubscribe wholesale: an unsubscribe/subscribe cycle
    // on an unchanged symbol drops ticks in the gap for no reason.
    for (const stream of this.subscriptions.keys()) {
      if (!next.has(stream)) this.#send('unsubscribe', stream);
    }
    for (const stream of next.keys()) {
      if (!this.subscriptions.has(stream)) this.#send('subscribe', stream);
    }

    this.subscriptions = next;
  }

  #send(type, symbol) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type, symbol }));
  }

  start() {
    if (!this.isConfigured() || this.ws) return false;
    this.stopped = false;
    this.#connect();
    return true;
  }

  #connect() {
    const token = env.FINNHUB_API_KEY || env.MARKET_DATA_API_KEY;
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    this.ws = ws;

    /**
     * A HANDSHAKE THAT NEVER COMPLETES IS THE WORST CASE, and it happened: a
     * retry socket sat in CONNECTING indefinitely, so no open, error or close
     * event ever fired, the retry counter stayed at 1 and the feed was dark
     * permanently while every health check reported a plausible state.
     *
     * Backoff alone cannot save you from this — there is no event to back off
     * from. The timer is the only thing that turns a hung connect into a
     * failed one.
     */
    const handshake = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        // close() on a CONNECTING socket fires onclose, which is what schedules
        // the next attempt — so this hands off to the existing path rather
        // than duplicating it.
        try {
          ws.close();
        } catch {
          /* already gone */
        }
      }
    }, env.MARKET_TIMEOUT_MS);
    handshake.unref?.();

    ws.onopen = () => {
      clearTimeout(handshake);
      this.connected = true;
      this.attempts = 0;
      // Re-subscribe from scratch: a new socket knows nothing about the old
      // one's subscriptions, so a reconnect that skipped this would connect
      // successfully and then sit silent forever — the worst failure shape,
      // because every health check would read green.
      for (const stream of this.subscriptions.keys()) this.#send('subscribe', stream);
      this.emit('status', { connected: true });
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;

      const batch = [];
      for (const t of msg.data) {
        const sub = this.subscriptions.get(t.s);
        if (!sub || !Number.isFinite(t.p) || t.p <= 0) continue;

        // The raw price is carried alongside the cents figure because forex is
        // not money in the cents sense — USDJPY at 159.1825 rounds to 15918
        // cents and loses the two decimals the pair actually moves in. The
        // client reads `price` for FX and `priceCents` for everything else.
        const priceCents = Math.round(t.p * 100);
        const prev = this.prices.get(t.s);
        // Trades print at the same price constantly; only a CHANGE is worth
        // waking every connected browser for. FX is compared on the raw value
        // for the same reason — at cent resolution most FX ticks look equal.
        if (sub.assetClass === 'forex' ? prev?.price === t.p : prev?.priceCents === priceCents) {
          continue;
        }

        this.prices.set(t.s, { price: t.p, priceCents, at: t.t });
        batch.push({ ...sub, price: t.p, priceCents, at: t.t });
      }

      if (batch.length) {
        this.ticks += batch.length;
        this.lastTickAt = new Date();
        this.emit('ticks', batch);
      }
    };

    ws.onclose = () => {
      clearTimeout(handshake);
      this.connected = false;
      this.ws = null;
      this.emit('status', { connected: false });
      if (!this.stopped) this.#scheduleReconnect();
    };

    // An error is always followed by a close, so reconnection is handled there
    // rather than in both places — doing both opens two sockets.
    ws.onerror = () => {};
  }

  #scheduleReconnect() {
    this.attempts += 1;
    // Exponential with a 30s ceiling. Without a ceiling a long outage backs off
    // to hours and the feed never returns after the vendor does.
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5));
    const t = setTimeout(() => !this.stopped && this.#connect(), delay);
    t.unref?.();
  }

  stop() {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }

  status() {
    return {
      connected: this.connected,
      subscribed: this.subscriptions.size,
      ticks: this.ticks,
      lastTickAt: this.lastTickAt,
      reconnectAttempts: this.attempts,
    };
  }

  /** Latest price for one instrument, or undefined if it has not traded yet. */
  priceFor(symbol, assetClass) {
    return this.prices.get(streamSymbolFor(symbol, assetClass));
  }
}

export const liveFeed = new LiveFeed();
