/**
 * A trade the user started, carried across a trip to the funding screen.
 *
 * WHY THIS EXISTS. Hitting a shortfall mid-order used to be a dead end dressed
 * up as an action: the ticket offered practice funds, and when the gap was
 * larger than that ceiling — 100 AAPL is $31,034 against a $5,000 limit — the
 * user added the most they could, closed the modal, and still could not buy.
 * The button worked and the flow did not.
 *
 * The fix is a round trip: funding is a place you GO, and the order you were
 * placing has to survive the journey and be waiting when you get back.
 *
 * IT LIVES IN THE URL, not in a store. A funding round trip crosses a route,
 * survives a reload, and can take minutes if the money is a real deposit — so
 * the state has to be in the one place that outlives all three. It also makes
 * the return link a plain `<a href>` that behaves exactly as a user expects,
 * back button included.
 *
 * The encoding is deliberately flat and readable — `stocks:AAPL:BUY:100` — so
 * a URL in a bug report says what the user was doing.
 */

/**
 * A decoded intent. `side` is a union rather than a string so the pages that
 * feed it straight into the ticket's `initialSide` type-check without a cast.
 *
 * @typedef {{assetClass: string, symbol: string, side: 'BUY'|'SELL', quantity: string}} TradeIntent
 */

/** @param {{assetClass:string, symbol:string, side:string, quantity:string|number}} t */
export const encodeTrade = ({ assetClass, symbol, side, quantity }) =>
  [assetClass, symbol, side, quantity].join(':');

/**
 * Returns null for anything that does not parse. A malformed `?trade=` is a
 * stale or hand-edited link, and reopening a ticket on a guess is worse than
 * not reopening one — this is a screen that spends money.
 */
/** @returns {TradeIntent | null} */
export function decodeTrade(raw) {
  if (!raw) return null;
  const [assetClass, symbol, side, quantity] = String(raw).split(':');

  if (!['stocks', 'crypto', 'forex'].includes(assetClass)) return null;
  if (!symbol || !/^[A-Za-z0-9.-]{1,12}$/.test(symbol)) return null;
  if (side !== 'BUY' && side !== 'SELL') return null;

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  return { assetClass, symbol: symbol.toUpperCase(), side, quantity: String(quantity) };
}

/**
 * The URL of the funding screen, carrying the shortfall and the way back.
 *
 * `need` prefills the amount so the user is not asked to work out their own
 * shortfall to the cent, and `back` is a full path INCLUDING the trade, so the
 * screen it returns to knows which ticket to reopen.
 *
 * @param {{path: string,
 *   trade: {assetClass:string, symbol:string, side:string, quantity:string|number},
 *   needCents: number}} args
 */
export function fundingUrl({ path, trade, needCents }) {
  const back = `${path}?trade=${encodeTrade(trade)}`;
  return `/fund?need=${Math.max(0, Math.round(needCents))}&back=${encodeURIComponent(back)}`;
}

/**
 * Where to return to, validated.
 *
 * ONLY A SAME-ORIGIN PATH. `back` arrives from the query string, so without
 * this an `?back=https://elsewhere` turns a funding screen into an open
 * redirect — on the one page in the product where a user is most primed to
 * trust what it tells them to do next. A leading `//` is rejected too: the
 * browser reads it as protocol-relative and it is a URL, not a path.
 */
export function safeReturnPath(raw, fallback = '/portfolio') {
  if (!raw) return fallback;
  const path = String(raw);
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  return path;
}
