import toast from 'react-hot-toast';
import i18n from '../i18n';
import { errorMessage } from './apiError';

/**
 * The single owner of every toast in the app.
 *
 * WHY A WRAPPER RATHER THAN IMPORTING `react-hot-toast` AT CALL SITES. The same
 * reason `PriceChange` owns the signed percentage and `Money` owns currency: the
 * moment two places decide a duration or an icon, they disagree, and a toast is
 * the one surface where an inconsistency reads as a bug in the product rather
 * than a style slip. It also keeps the library at one import, so swapping it is
 * one file.
 *
 * ERRORS DWELL LONGER THAN SUCCESSES. A confirmation is read in passing and a
 * failure has to be read properly — 6s against 3s, measured against nothing more
 * scientific than how long a sentence takes to read twice.
 *
 * `id` is used deliberately on the repeatable ones. Without it a socket that
 * flaps stacks six identical "connection lost" toasts down the screen; with it,
 * the same id REPLACES the previous toast in place.
 */

const DURATION = { success: 3_000, error: 6_000, info: 4_000 };

export const notify = {
  success: (message, opts = {}) =>
    toast.success(message, { duration: DURATION.success, ...opts }),

  error: (message, opts = {}) => toast.error(message, { duration: DURATION.error, ...opts }),

  info: (message, opts = {}) => toast(message, { duration: DURATION.info, ...opts }),

  /**
   * The one every mutation should use. It runs the server's `code` through the
   * translation table first — the client already switches on `code`, so the code
   * IS the key — and falls back to the server's English message rather than to
   * the bare code, because "STALE_STATE" on a funding screen is a leak and not
   * a sentence.
   */
  apiError: (err, fallback = undefined, opts = {}) =>
    toast.error(errorMessage(err, fallback), { duration: DURATION.error, ...opts }),

  /** Translated at call time, so a language change mid-session is respected. */
  t: (key, vars = undefined, kind = 'success') =>
    notify[kind](/** @type {string} */ (i18n.t(key, vars))),

  /**
   * A toast that renders its own body instead of a string and an icon.
   *
   * IT EXISTS SO THE LIBRARY STAYS AT ONE IMPORT. `LiveGains` needs an avatar,
   * a name, a figure and a disclosure label in one row, which the string API
   * cannot express — and importing `react-hot-toast` there to get `toast.custom`
   * would be the second owner this module exists to prevent.
   *
   * `ariaProps` DEFAULTS TO SILENT here, which is the opposite of every other
   * toast in the app and is the point. The rest are consequences of something
   * the user just did and must be announced; a marketing notice that arrives on
   * its own every half minute would interrupt a screen reader mid-sentence,
   * repeatedly, with something nobody asked for. Callers that need it announced
   * pass their own.
   */
  custom: (render, opts = {}) =>
    toast.custom(render, {
      duration: DURATION.info,
      ariaProps: { role: 'status', 'aria-live': 'off' },
      ...opts,
    }),

  dismiss: toast.dismiss,
};

export default notify;
