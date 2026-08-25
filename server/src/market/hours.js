/**
 * Whether an exchange is currently trading.
 *
 * WHY THIS EXISTS. Equities and crypto share one socket, one SSE stream and one
 * client hook — measured, 1 stock tick against 113 crypto ticks in the same 15
 * seconds. The difference is not the plumbing, it is that crypto trades all day
 * and the NYSE does not. Without this the Markets page shows a "Live" pill over
 * a column of numbers that have not moved in hours, which reads as a broken
 * feed rather than as a closed market.
 *
 * `Intl.DateTimeFormat` does the timezone work rather than a stored offset,
 * because the offset is not a constant: New York is UTC-5 in January and UTC-4
 * in July, and half the point of storing an IANA zone on the Exchange is that
 * DST resolves itself.
 *
 * Weekends only — exchange holidays are not modelled. A holiday therefore reads
 * as open-but-silent, which is the same failure this is meant to fix, just
 * rarer. Fixing it properly needs a holiday calendar per venue.
 */

/** Local wall-clock parts for an IANA zone, without pulling in a date library. */
function partsIn(timezone, at = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    // "24" is a real output of hour12:false at midnight in some engines.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

const WEEKEND = new Set(['Sat', 'Sun']);

/**
 * Every field is optional in the signature because the guard on the first line
 * is the point: this is fed straight from a database document, and a venue
 * missing its zone must read as shut rather than throw or guess.
 *
 * @param {{openTime?: string, closeTime?: string, timezone?: string} | undefined} exchange
 * @param {Date} [at]
 */
export function isOpen(exchange, at = new Date()) {
  if (!exchange?.timezone || !exchange.openTime || !exchange.closeTime) return false;

  const { weekday, minutes } = partsIn(exchange.timezone, at);
  if (WEEKEND.has(weekday)) return false;

  const open = toMinutes(exchange.openTime);
  const close = toMinutes(exchange.closeTime);

  // Every venue in this product opens and closes on the same calendar day, so
  // a session that wraps midnight is not handled — it would need the previous
  // day's weekday check too, and asserting support we have not tested is worse
  // than not having it.
  return minutes >= open && minutes < close;
}

/**
 * Minutes until the next open, or 0 when already trading. Coarse by design: it
 * feeds "opens in about 5h", not a countdown.
 *
 * @param {{openTime?: string, closeTime?: string, timezone?: string} | undefined} exchange
 * @param {Date} [at]
 */
export function minutesUntilOpen(exchange, at = new Date()) {
  if (isOpen(exchange, at)) return 0;
  if (!exchange?.timezone) return null;

  const { weekday, minutes } = partsIn(exchange.timezone, at);
  const open = toMinutes(exchange.openTime);

  const daysAhead = { Fri: 3, Sat: 2, Sun: 1 };
  // Before the bell on a weekday is later today; after it, tomorrow.
  const days = WEEKEND.has(weekday)
    ? daysAhead[weekday]
    : minutes < open
      ? 0
      : (daysAhead[weekday] ?? 1);

  return days * 1440 + open - minutes;
}
