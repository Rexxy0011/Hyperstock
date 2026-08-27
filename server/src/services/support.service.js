import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * What the browser needs to boot the live chat widget.
 *
 * THE CONFIG COMES FROM THE API, NOT FROM A CLIENT ENV FILE. The obvious
 * alternative is `VITE_TAWK_PROPERTY_ID` in `client/.env`, and it is worse for
 * the reason `DEPOSIT_DESTINATIONS` already records: a second place to
 * configure one feature is a place an operator's edit gets silently ignored
 * while they believe it is live. It also could not carry the signature below,
 * which has to be computed somewhere the secret key exists.
 *
 * NOTHING FINANCIAL CROSSES THIS BOUNDARY. The payload carries an id, a
 * handle, a display name, an address and a language, and that list is the whole
 * of it — no balance, no positions, no deposit history. `adminQueue.service.js`
 * makes the same call for the review queues ("exactly one place decides that a
 * queue may see a username and an email and may not see a balance"), and the
 * argument is stronger here because the recipient is a third party's servers
 * rather than our own admin screen. A test asserts the shape.
 */

/** Live chat is off unless a property has been configured. */
export const chatEnabled = () => Boolean(env.TAWK_PROPERTY_ID && env.TAWK_WIDGET_ID);

/**
 * Tawk's secure-mode signature: HMAC-SHA256 of the visitor's email under the
 * property's API key, hex encoded.
 *
 * IT IS COMPUTED PER REQUEST RATHER THAN STORED. It is derived from two values
 * we already hold, so caching it would only create a second copy to invalidate
 * when the key is rotated.
 */
export function visitorHash(email, apiKey) {
  return crypto.createHmac('sha256', apiKey).update(String(email)).digest('hex');
}

/**
 * The pure half, so the shape can be tested without touching `process.env`.
 *
 * A test that has to set an environment variable to exercise a branch is a test
 * that depends on the machine it runs on — the trap this repo has already hit
 * four times (`MONGODB_URI`, `DEPOSIT_DESTINATIONS`, the CoinGecko call,
 * `RESEND_API_KEY`). Passing the config in means the interesting cases are
 * ordinary function calls.
 *
 * @param {object} args
 * @param {Record<string, any>} args.user  the user document. Loosely typed
 *   because it arrives as a `lean()` result on one path and a test fixture on
 *   the other, and the only thing read off it is five string fields.
 * @param {string} args.propertyId
 * @param {string} args.widgetId
 * @param {string} args.apiKey     empty when secure mode is off
 * @param {string=} args.language  the interface language, for the operator
 */
export function buildChatConfig({ user, propertyId, widgetId, apiKey, language = '' }) {
  // `enabled: false` rather than a 404 or an empty object: the client switches
  // on one field, and an absent config and a disabled one are the same answer
  // to the only question it asks.
  if (!propertyId || !widgetId) return { enabled: false };

  const email = String(user?.email ?? '');

  return {
    enabled: true,
    propertyId,
    widgetId,
    /**
     * Whether the operator may TRUST the name beside the conversation.
     *
     * Reported rather than inferred, because the failure is silent in both
     * directions: with secure mode on in the Tawk dashboard and no key here,
     * attributes are rejected and every visitor shows as anonymous; with it off
     * and a key here, the signature is sent and ignored. One boolean on the
     * response is what makes the mismatch visible.
     */
    verified: Boolean(apiKey),
    visitor: {
      /**
       * Tawk's own reserved fields.
       *
       * `||` RATHER THAN `??`, WHICH IS NOT A STYLE CHOICE HERE. `??` falls
       * through on null and undefined only, so a user carrying
       * `displayName: ''` — which is what an account that opened the field and
       * saved it empty looks like — would send a BLANK name to the operator
       * while a perfectly good username sat one line below. `traderOf()` makes
       * the same call for the same reason.
       */
      name: String(user?.displayName || user?.name || user?.username || ''),
      email,
      ...(apiKey ? { hash: visitorHash(email, apiKey) } : {}),
      // Custom attributes, prefixed so they cannot collide with a reserved one
      // Tawk adds later.
      'hs-user-id': String(user?._id ?? user?.id ?? ''),
      'hs-username': String(user?.username ?? ''),
      // What language the operator should answer in. The widget's OWN chrome
      // language is a per-widget dashboard setting and cannot be switched from
      // the embed, so this is the only thing that carries it across.
      'hs-language': language,
    },
  };
}

/** The env-bound wrapper the route calls. */
export function chatConfigFor(user, language) {
  return buildChatConfig({
    user,
    propertyId: env.TAWK_PROPERTY_ID,
    widgetId: env.TAWK_WIDGET_ID,
    apiKey: env.TAWK_API_KEY,
    language,
  });
}
