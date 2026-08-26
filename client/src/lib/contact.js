/**
 * The one address this product publishes.
 *
 * ONE OWNER, for the reason `toast.js` owns notification durations and
 * `PriceChange` owns the signed percentage. Before this there were SEVEN
 * hardcoded literals across three files, and they had drifted onto two
 * different domains: the footer offered `security@` and `support@hyperstocks.app`
 * while the legal documents printed `privacy@` and `legal@hyperstock.com` —
 * a name that is not even the one the rest of the product uses.
 *
 * UNIFIED TO `support@` DELIBERATELY, rather than keeping a routed set. Four
 * inboxes are four things to monitor, and an unmonitored `security@` is worse
 * than none: somebody reporting a vulnerability believes they have reached
 * someone. One address that is actually read beats four that suggest a
 * department structure this product does not have.
 *
 * THE SERVER HAS ITS OWN COPY, and that is not duplication. `env.SUPPORT_EMAIL`
 * is what the deposit and withdrawal services stamp onto responses, because a
 * deployment may need to change it without a rebuild — and where the server
 * sends one (Fund.jsx's rejected-deposit mailto) the client uses THAT value,
 * not this constant. This is the default for the surfaces the server never
 * touches: the footer, the legal documents, the unsubscribe fallback.
 *
 * NOTE ON THE DOMAIN: `hyperstocks.app` is not currently controlled by this
 * project — it resolves to a third party's site and has no MX record, so mail
 * to this address bounces today. The address is unified and correct in shape;
 * pointing it at a domain the project owns is a separate, still-outstanding
 * step, and it is the one that has to happen before the footer's promise of a
 * place to report a security issue becomes true.
 */
export const SUPPORT_EMAIL = 'support@hyperstocks.app';

/** `mailto:` for the support address, optionally with a subject. */
export const supportMailto = (subject = undefined) =>
  subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
