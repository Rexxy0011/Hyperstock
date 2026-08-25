import { useEffect, useState } from 'react';

/**
 * Subscribes to the server's price stream and returns a live price map.
 *
 * ONE CONNECTION FOR THE WHOLE APP, not one per component. `EventSource` is
 * cheap but browsers cap concurrent connections per origin at six, and a table
 * that opened one per row would exhaust that and then silently stall every
 * other request on the page. So the connection is module-level and refcounted:
 * components subscribe to the store, not to the network.
 *
 * Reconnection is EventSource's own — it retries automatically on drop, which
 * is the main reason this is SSE rather than a WebSocket. The one case it does
 * NOT retry is an HTTP error at open, so that is handled here.
 */

/** `${assetClass}:${symbol}` → { priceCents, at } */
const prices = new Map();
const listeners = new Set();

let source = null;
let refCount = 0;
let connected = false;

const keyOf = (assetClass, symbol) => `${assetClass}:${String(symbol).toUpperCase()}`;

/**
 * Ticks arrive several times a second per symbol. Notifying React on each one
 * would re-render the table faster than the screen refreshes, so they are
 * coalesced into a single flush on the next animation frame — which is exactly
 * as often as a repaint can actually show.
 */
let frame = 0;
function scheduleFlush() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const snapshot = new Map(prices);
    for (const fn of listeners) fn(snapshot);
  });
}

function open() {
  if (source) return;

  source = new EventSource('/api/market/stream');

  source.addEventListener('ticks', (e) => {
    let batch;
    try {
      batch = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const t of batch) prices.set(keyOf(t.assetClass, t.symbol), t);
    scheduleFlush();
  });

  source.addEventListener('status', (e) => {
    try {
      connected = JSON.parse(e.data).connected;
    } catch {
      /* keep the last known state */
    }
    scheduleFlush();
  });

  source.onerror = () => {
    connected = false;
    scheduleFlush();
    // EventSource reconnects on its own after a dropped connection. It does
    // not when the endpoint answers with an HTTP error, and in that state it
    // is CLOSED and will never try again — so that case is closed out and left
    // to the next mount rather than leaking a dead object.
    if (source?.readyState === EventSource.CLOSED) close(true);
  };
}

function close(force = false) {
  if (!force && refCount > 0) return;
  source?.close();
  source = null;
  connected = false;
}

/**
 * NO ASSET CLASS ARGUMENT, deliberately. One stream carries all three, and
 * every one of them has a live path now — including forex, whose REST
 * endpoints Finnhub 403s on this tier while streaming the same OANDA pairs
 * over the socket. A per-class hook would have implied per-class connections.
 *
 * @returns {{ live: Map<string, {price?: number, priceCents: number, at: number}>,
 *   connected: boolean }}
 */
export function useLivePrices() {
  const [snapshot, setSnapshot] = useState(() => new Map(prices));
  const [isConnected, setIsConnected] = useState(connected);

  useEffect(() => {
    refCount += 1;
    open();

    const onFlush = (next) => {
      setSnapshot(next);
      setIsConnected(connected);
    };
    listeners.add(onFlush);

    return () => {
      listeners.delete(onFlush);
      refCount -= 1;
      // Deferred: React unmounts and remounts in StrictMode, and in normal
      // navigation the next page subscribes a tick after this one leaves.
      // Closing synchronously would tear the socket down and rebuild it on
      // every route change.
      setTimeout(() => close(), 1000);
    };
  }, []);

  return { live: snapshot, connected: isConnected };
}

/** Reads one instrument out of a snapshot, or undefined if it has not ticked. */
export const livePrice = (snapshot, assetClass, symbol) =>
  snapshot.get(keyOf(assetClass, symbol));
