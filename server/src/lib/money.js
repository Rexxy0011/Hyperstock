/**
 * Money in HyperStocks is ALWAYS an integer number of cents. Never a float.
 *
 * Floats cannot represent 0.1 exactly, so repeated addition drifts: a ledger
 * built on them eventually disagrees with itself by fractions of a cent, and
 * those fractions are real money in a real brokerage. Every persisted monetary
 * field is an integer and carries a `Cents` suffix so the unit is impossible to
 * misread at a call site.
 *
 * "Cents" here means the major unit x 100, uniformly, for every currency —
 * including JPY, which conventionally shows no decimals. Uniform storage keeps
 * arithmetic and FX identical across currencies; the display layer applies each
 * currency's own decimal convention.
 *
 * Percentages are NOT money. They are derived display values, never summed into
 * a balance, and stay as plain numbers.
 */

/** Currencies quoted by vendors in a minor unit rather than the major one. */
const MINOR_UNIT = {
  GBp: { major: 'GBP', divisor: 100 },
  ZAc: { major: 'ZAR', divisor: 100 },
  ILA: { major: 'ILS', divisor: 100 },
};

/**
 * Normalises a vendor quote to its major currency unit.
 * Yahoo reports LSE in GBp (pence): AZN.L arrives as 11606 meaning £116.06.
 * Miss this and every LSE holding is overvalued 100x.
 */
export function normalizeCurrency(price, currency) {
  const minor = MINOR_UNIT[currency];
  if (!minor) return { price, currency };
  return { price: price / minor.divisor, currency: minor.major };
}

/** Major units (e.g. dollars) -> integer cents. The only place rounding occurs. */
export function toCents(major) {
  return Math.round(Number(major) * 100);
}

/** Integer cents -> major units. For display and vendor payloads only. */
export function toMajor(cents) {
  return (Number(cents) || 0) / 100;
}

/**
 * Multiplies cents by a quantity and returns cents.
 * `quantity` is a whole share count, so the product stays exact.
 */
export function multiplyCents(cents, quantity) {
  return Math.round(cents * quantity);
}

/* ------------------------------------------------------- sub-cent prices */

/**
 * THE LEDGER PRICE IS NANOS, not cents, and that is forced by two of the three
 * asset classes rather than being a refinement.
 *
 * `priceUsdCents` is exact for an equity, which is quoted in cents. It is not
 * exact for anything else:
 *
 *   AAPL     $310.34      -> 31034      exact
 *   RAIN     $0.0051      -> 1          rounded to a cent: ~100% error
 *   EURUSD   1.1663       -> 11664      not cents at all — it is rate x 10^4,
 *                                       so pricing a trade off it is 100x out
 *
 * A billionth of a dollar holds every price this product can quote, and the
 * largest figure involved — BTC at ~$79k, so 7.9e13 nanos — has three orders of
 * magnitude of headroom under 2^53, where a JS integer stops being exact.
 *
 * MONEY IS STILL INTEGER CENTS EVERYWHERE IT IS STORED. Nanos are a *price*,
 * never a balance: they exist so that `quantity x price` can be rounded to
 * cents ONCE, at the point the ledger records it, instead of inheriting a
 * rounding error that was already baked into the unit price.
 */
export const NANOS_PER_USD = 1_000_000_000;
export const NANOS_PER_CENT = 10_000_000;

/** Major units (e.g. dollars) -> integer nanos. */
export const toNanos = (major) => Math.round(Number(major) * NANOS_PER_USD);

/** Integer nanos -> integer cents, for display beside every other money field. */
export const nanosToCents = (nanos) => Math.round(Number(nanos) / NANOS_PER_CENT);

/**
 * What `quantity` units cost, in integer cents. The ONE rounding in a fill.
 *
 * Note the parenthesis: `quantity * (nanos / NANOS_PER_CENT)` divides first on
 * purpose. `quantity * nanos` evaluated left-to-right overflows exact integer
 * range for a large position in an expensive asset — 100 BTC is 7.9e15, past
 * 2^53 — and would start silently losing whole cents.
 */
export function costCents(quantity, priceUsdNanos) {
  return Math.round(Number(quantity) * (Number(priceUsdNanos) / NANOS_PER_CENT));
}

/**
 * Quantity precision, and the dust threshold that follows from it.
 *
 * Eight decimals is one satoshi, which is as fine as any vendor here quotes.
 * Quantities are floats — they are counts, not money — so repeated `$inc`
 * leaves the familiar residue: buy 0.1 three times, sell 0.3, and the position
 * is left holding 4e-17 of a coin rather than being closed. Anything under one
 * unit of precision is therefore treated as closed, which is what a real venue
 * does with dust too.
 */
export const QTY_DECIMALS = 8;
export const QTY_EPSILON = 1e-8;
export const quantizeQty = (q) => Math.round(Number(q) * 1e8) / 1e8;

/**
 * Converts cents in one currency to USD cents.
 * `rates` maps currency code -> USD per 1 major unit of that currency.
 */
export function toUsdCents(cents, currency, rates) {
  if (!currency || currency === 'USD') return Math.round(cents);
  const rate = rates?.[currency];
  if (!rate || !Number.isFinite(rate)) {
    throw new Error(`No FX rate available for ${currency}`);
  }
  return Math.round(cents * rate);
}

/**
 * Average cost per share, in cents, derived from a position's total cost basis.
 *
 * Cost basis is stored, average is derived — the reverse would round on every
 * partial buy and drift the position's book value away from what was actually
 * paid.
 */
export function avgCostCents(costBasisCents, shares) {
  if (!shares) return 0;
  return Math.round(costBasisCents / shares);
}

/**
 * "$1,000.00" — the human-readable form for a ledger row's `detail` string.
 *
 * Display formatting is the CLIENT's job almost everywhere, and deliberately so.
 * The exception is `Transaction.detail`, which is prose the server writes once
 * and stores ("12 AAPL @ $214.02"), so the wording has to be decided here. One
 * owner for it rather than a template literal per service.
 */
export const usdFromCents = (cents) =>
  `$${((Number(cents) || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Percent change between two cent amounts. Returns a number, not money. */
export function changePct(currentCents, previousCents) {
  if (!previousCents) return 0;
  return ((currentCents - previousCents) / previousCents) * 100;
}

/** Rounds a percentage for transport. Display formatting lives on the client. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const CURRENCY_SYMBOL = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  CNY: '¥',
};
