import i18n from '../i18n';

/**
 * A server error, in the user's language.
 *
 * THIS WORKS BECAUSE THE API WAS ALREADY BUILT FOR IT. Errors surface as
 * `{ error: { code, message } }` and the client already switches on `code`
 * (TradeModal on `PRICE_MOVED`), so the wire format needs no change at all to
 * be translatable — the code IS the translation key. The server keeps emitting
 * English `message`, which becomes the fallback for anything not yet in the
 * bundles rather than a gap.
 *
 * That fallback ordering matters. A missing key must degrade to the server's
 * English sentence, never to the bare code: "STALE_STATE" on a funding screen
 * is not an error message, it is a leak.
 *
 * Server messages often carry detail the generic string cannot — an exact
 * minimum, the asset that could not be priced. Where a code has no entry here
 * that detail survives untouched.
 */
export function errorMessage(err, fallback = undefined) {
  const code = /** @type {any} */ (err)?.code;
  const serverMessage = /** @type {any} */ (err)?.message;

  if (code && i18n.exists(`errors.${code}`)) return i18n.t(`errors.${code}`);
  return serverMessage || fallback || i18n.t('errors.generic');
}
