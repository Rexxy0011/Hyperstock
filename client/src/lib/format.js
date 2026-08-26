/**
 * Number formatting for HyperStocks.
 *
 * Only <PriceChange> and <Money> call these, so the conventions cannot drift
 * between screens — which matters, because the design uses a real U+2212 MINUS
 * SIGN (−), not an ASCII hyphen (-). They render at noticeably different
 * widths in the mono face, and mixing them makes columns look ragged.
 */

const MINUS = '−';

/**
 * THE ACTIVE LOCALE, FOR DIGIT GROUPING ONLY.
 *
 * These functions are called from render paths that are not hooks, so the
 * locale is pushed in from `i18n` rather than read through `useTranslation`.
 * One module-level value, set on language change; every formatter reads it.
 *
 * WHAT IS AND IS NOT LOCALISED, because the distinction is the whole point:
 *
 *   localised — the group separator and the decimal mark. Ukrainian writes
 *     12 220,64 where English writes 12,220.64, and reading a balance in the
 *     wrong convention is a genuine misreading, not a preference.
 *
 *   NOT localised — the sign and the symbol position. `pct()` emits a real
 *     U+2212 because the design does and because it aligns with the mono
 *     digits; `Intl`'s own currency mode would replace it with the locale's
 *     minus and move `$` behind the number for uk-UA, which would break the
 *     column rule this module exists to own. So the parts are assembled here
 *     and only the digits go through `Intl`.
 *
 * `toLocaleString` also emits U+00A0 (uk) or U+202F (fr) as the group
 * separator. Both are non-breaking, which is what stops "12 220,64" wrapping
 * across two lines mid-number in a narrow table cell.
 */
let numberLocale = 'en-US';

/** Called by `i18n` on language change — see `i18n/index.js`. */
export function setNumberLocale(locale) {
  numberLocale = locale || 'en-US';
}

export const getNumberLocale = () => numberLocale;

export const CURRENCY_SYMBOL = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  CNY: '¥',
};

/** Currencies conventionally shown without decimals. */
const ZERO_DECIMAL = new Set(['JPY']);

/**
 * "+2.20%" / "−4.30%" — always 2dp, always signed, always U+2212 for negative.
 *
 * THE DIGITS ARE LOCALISED AND THE SIGN IS NOT, which is the same split
 * `money()` makes and for the same reasons. It did NOT used to be: this was
 * `toFixed(2)`, which is hardcoded English whatever the interface language, so
 * a German page rendered a localised balance beside an unlocalised percentage
 * — `+$4.289,96` and `+16.91%` on one line, with the decimal mark disagreeing
 * with itself inside a single row. Found when Spanish and German landed; it had
 * been true for Ukrainian all along.
 *
 * `toLocaleString` rather than `toFixed` also means a percentage above 1000
 * finally groups: `1.234,56%` in German, `1,234.56%` in English.
 */
export function pct(value) {
  const v = Number(value) || 0;
  const body = Math.abs(v).toLocaleString(numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v >= 0 ? '+' : MINUS}${body}%`;
}

/**
 * "$12,220.64", "¥2,940" — grouped, fixed decimals, native currency symbol.
 *
 * Takes INTEGER CENTS, matching how the API sends every monetary value. Cents
 * are the storage and transport unit throughout; dividing by 100 happens here
 * and nowhere else, so no other module can be tempted to do float arithmetic
 * on money.
 */
export function money(cents, currency = 'USD', { signed = false } = {}) {
  const major = (Number(cents) || 0) / 100;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const body = Math.abs(major).toLocaleString(numberLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = CURRENCY_SYMBOL[currency] ?? '';
  const sign = major < 0 ? MINUS : signed ? '+' : '';
  return `${sign}${symbol}${body}`;
}

/**
 * A USD price held in NANOS — billionths of a dollar — rendered at whatever
 * precision the number actually needs.
 *
 * `money()` above cannot do this and should not try: it takes cents, and cents
 * are exact for a share and lossy for everything else this product now trades.
 * A coin quoting at $0.0051 prints "$0.01" through `money()`, which is not the
 * price the trade was struck at, and an FX rate is not a cent figure at all.
 *
 * At or above a dollar this is deliberately identical to `money()` — two
 * decimals, grouped — so a price does not change shape as it crosses $1. Below
 * a dollar the places follow the magnitude, to four significant figures.
 */
export function priceUsd(nanos, decimals = undefined) {
  const usd = (Number(nanos) || 0) / 1e9;
  const abs = Math.abs(usd);
  // An explicit override exists for forex, where two decimals is not merely
  // coarse but visibly inconsistent: EURUSD renders "$1.17" while the ledger
  // charges 1.1664, so quantity x displayed price does not reproduce the total
  // on the same panel. Same per-class rule the candle axis already applies.
  const digits =
    decimals ??
    (abs >= 1 || abs === 0 ? 2 : Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(abs)) - 1)));
  const body = abs.toLocaleString(numberLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${usd < 0 ? MINUS : ''}$${body}`;
}

/**
 * A traded quantity. Whole for shares; for a fractional class the trailing
 * zeros are trimmed, because "0.50000000 BTC" is noise and "0.5" is what was
 * typed. Never used for money.
 */
export function qty(value, assetClass = 'stocks') {
  const n = Number(value) || 0;
  return assetClass === 'stocks' ? String(n) : String(Number(n.toFixed(8)));
}

/** Compact magnitudes for volume and market cap: 48.2M, $3.54T. Not cents. */
export function compact(value, { prefix = '' } = {}) {
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  /** @type {[number, string][]} */
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `${prefix}${(v / scale).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
  }
  return `${prefix}${v.toLocaleString(numberLocale)}`;
}

/** "Aug 17, 10:22" — the Wallet transactions table format. */
export function dateTime(value) {
  return new Date(value).toLocaleString(numberLocale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "Mar 02, 2026" — the admin Joined column format. */
export function dateOnly(value) {
  return new Date(value).toLocaleDateString(numberLocale, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

/**
 * "4h 07m" / "18m" — how long until a closed venue opens.
 *
 * Here rather than beside its first caller because two surfaces now render it:
 * the Markets pill and the instrument terminal's status bar. They read the same
 * `minutesUntilOpen` off the same Exchange record, so they must not be able to
 * word it differently.
 */
export const untilLabel = (mins) =>
  mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

export const isUp = (v) => Number(v) >= 0;
