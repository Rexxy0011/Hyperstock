/**
 * The single owner of the Tawk.to embed. Nothing else in the client touches
 * `window.Tawk_API`.
 *
 * SAME RULE AS `lib/toast.js` OWNING react-hot-toast, and the same payoff: the
 * vendor is reachable from one file, so swapping Tawk for Crisp or for an
 * in-house thread is this module's surface rather than a grep across the app.
 * That mattered enough to write down because a chat widget is exactly the kind
 * of dependency that gets called from three components and then cannot move.
 *
 * WHY TAWK AND NOT THE ALTERNATIVES. Free tier with unlimited agents, unlimited
 * conversation history and no card, which is the only one of those three that
 * Crisp's free tier also gives; and a documented `Tawk_API` global with the
 * four hooks this integration actually needs (`onLoad`, `setAttributes`,
 * `hideWidget`, `endChat`). Intercom and Zendesk are per-seat from the first
 * agent.
 *
 * WHAT WE GIVE UP BY EMBEDDING SOMEBODY ELSE'S WIDGET, stated plainly because
 * it is not recoverable later:
 *
 * - The conversations live on Tawk's servers. They are not in this database,
 *   not in `/admin`, and not in any export this product can produce. A support
 *   history that cannot be read beside the deposit it is about is the cost of
 *   the ten minutes this took instead of a week.
 * - It draws its own UI. The panel does not use this design system's tokens,
 *   radius or type, and cannot be made to beyond the handful of colours Tawk's
 *   dashboard exposes.
 * - It is a third-party script and a WebSocket to another origin on every
 *   signed-in page load. If a CSP is ever added to whatever serves the client,
 *   `embed.tawk.to`, `*.tawk.to` and `wss://*.tawk.to` all have to be on it.
 *   `helmet` currently runs with `contentSecurityPolicy: false` and only guards
 *   the API anyway, so nothing blocks it today.
 */

/**
 * `window.Tawk_API` is injected by a remote script and has no types, so every
 * reach for it goes through here with one cast instead of a dozen.
 * @returns {any}
 */
const api = () => /** @type {any} */ (window).Tawk_API;

/** The user id the widget was booted for, or null. See `bootedFor` below. */
let bootedUserId = null;
let loading = null;

/**
 * Which account the loaded widget belongs to.
 *
 * IT EXISTS BECAUSE THE WIDGET CANNOT BE RE-IDENTIFIED. Tawk's visitor is the
 * browser, and once a session is open, pointing `setAttributes` at a different
 * person does not start a new conversation — it renames the one already on
 * screen, which would put the next user's messages into the last user's thread
 * and show them its history. On a shared machine that is a real leak, so the
 * caller compares this against the current user and reloads rather than
 * re-identifying. Rare by construction: it can only differ when two accounts
 * sign in without a page load between them.
 */
export const bootedFor = () => bootedUserId;

/** Whether the embed script has been injected at all this page lifetime. */
export const isBooted = () => bootedUserId !== null;

/**
 * Injects the embed and resolves once Tawk reports itself ready.
 *
 * EVERYTHING SET BEFORE THE SCRIPT TAG IS DELIBERATE. Tawk reads `customStyle`
 * and `onLoad` off the global at startup; assigning them after the script has
 * run is a no-op that fails silently — the widget simply appears in the default
 * corner and the callback never fires.
 */
export function boot({ propertyId, widgetId, visitor, userId }) {
  if (loading) return loading;

  const w = /** @type {any} */ (window);
  w.Tawk_API = w.Tawk_API || {};
  w.Tawk_LoadStart = new Date();

  /**
   * BOTTOM LEFT, AND THAT IS NOT A PREFERENCE — the other corner is taken.
   *
   * Tawk defaults to bottom right, which is where this app's toasts live, and
   * that position is itself already a constraint rather than taste: top-centre
   * and top-right cover the sticky nav with the balance pill and account menu
   * in it, so bottom right is the only region nothing else occupies (see
   * `ui/Toasts.jsx`). Left at the default, the launcher would sit under every
   * order confirmation, deposit notice and error in the product, and the open
   * panel would cover them outright at 380x560.
   *
   * So the newcomer moves. Bottom left is empty on every route in this app.
   */
  w.Tawk_API.customStyle = {
    visibility: {
      desktop: { position: 'bl', xOffset: 24, yOffset: 24 },
      // Tighter on a phone, where the panel goes full-screen anyway and the
      // launcher is the only thing the offset applies to.
      mobile: { position: 'bl', xOffset: 12, yOffset: 12 },
    },
  };

  loading = new Promise((resolve) => {
    w.Tawk_API.onLoad = () => {
      identify(visitor);
      resolve(undefined);
    };

    const s = document.createElement('script');
    s.async = true;
    s.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
    s.charset = 'UTF-8';
    // Tawk's own snippet sets this. Without it their CDN response is treated as
    // opaque and the script's errors are unreportable.
    s.setAttribute('crossorigin', '*');
    document.head.appendChild(s);
  });

  bootedUserId = userId;
  return loading;
}

/**
 * Attaches the visitor's details to the conversation.
 *
 * The `hash` in here is what makes the name TRUSTWORTHY to the operator. It is
 * an HMAC of the email computed on the server under a key the browser never
 * sees, so a console call claiming somebody else's address is rejected by Tawk
 * rather than accepted and shown to whoever is answering. Secure mode is
 * OPTIONAL and off by default — without it there is no hash and the attributes
 * are self-asserted, which the config response reports as `verified: false`.
 */
export function identify(visitor) {
  if (!visitor) return;
  api()?.setAttributes?.(visitor, (err) => {
    if (err) {
      // Loud, because the failure mode is silent otherwise: attributes are
      // dropped and every conversation shows as an anonymous visitor, which
      // looks like nobody has signed in rather than like a key mismatch.
      console.warn('[liveChat] visitor attributes rejected', err);
    }
  });
}

export function show() {
  api()?.showWidget?.();
}

export function hide() {
  api()?.hideWidget?.();
}

/**
 * Signing out.
 *
 * `endChat` closes the conversation on Tawk's side and `hide` takes the
 * launcher off the screen. WHAT THIS DOES NOT DO is erase Tawk's own visitor
 * cookie, which lives on their domain and is not ours to clear — so the honest
 * statement is that the next person on this browser gets a fresh widget only
 * after a page load, which is why `bootedFor` exists and why the caller
 * reloads on an account switch.
 */
export function endSession() {
  api()?.endChat?.();
  hide();
}
