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
export const SUPPORT_EMAIL = "support@hyperstocks.finance";

/** `mailto:` for the support address, optionally with a subject. */
export const supportMailto = (subject = undefined) =>
  subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;

/**
 * The published phone number.
 *
 * PLACEHOLDER, AND IT HAS TO BE REPLACED BEFORE A PUBLIC DEPLOY. `+1 555 0100`
 * is inside the 555-01xx block, which is reserved for fiction precisely so a
 * made-up number in published material cannot ring a real person's phone. The
 * reference this page was built from prints `(123) 456-7890`, which is not
 * reserved and does dial somewhere.
 *
 * `tel:` wants the E.164 form with no punctuation; the display form is written
 * separately rather than derived, because grouping is a local convention and
 * stripping characters out of a formatted string gets it wrong for half the
 * world's numbering plans.
 */
export const SUPPORT_PHONE = {
  display: "(951) 776-7277",
  dial: "+19517767277",
};

/**
 * Where the office is, and where the map puts its pin.
 *
 * ONE DEFINITION FOR BOTH, which is the whole reason the coordinates live here
 * beside the text rather than being pasted into an iframe URL on the page. A
 * printed address and a map pin are two claims about one place, and there is no
 * failure mode in which they disagree that is not a bug — the map is the half
 * nobody proofreads, so it is the half that would have been wrong.
 *
 * IT IS DISTRICT-LEVEL AND THAT IS DELIBERATE. The reference prints
 * "123 Business Street, New York", which is Divi's filler. Substituting a
 * plausible-looking street number would be worse than filler: on a site that
 * also publishes risk disclosures and a privacy policy, a specific street
 * address is a claim about a real building that somebody else occupies. This
 * names a district, which is true of nothing in particular and misattributes
 * nothing to anyone. REPLACE IT with the real registered address before this
 * page goes anywhere public — the same standing instruction the partner strip
 * and the leaderboard's illustrative names carry.
 */
export const OFFICE = {
  lines: ["Financial District", "New York, NY", "United States"],
  /** Lower Manhattan, near Broad Street. Accurate to the district, not a door. */
  lat: 40.7061,
  lon: -74.0104,
};

/** Opening hours, as a key into the locale bundles plus the literal times. */
export const OFFICE_HOURS = {
  days: "monFri",
  from: "9:00 AM",
  to: "6:00 PM",
  zone: "ET",
};

/**
 * The map embed URL.
 *
 * OPENSTREETMAP RATHER THAN GOOGLE, and the reference uses Google. Three
 * reasons, in the order they mattered:
 *
 *   - It needs no account and no key. Google's keyless `output=embed` form
 *     works but is undocumented, and the documented `maps/embed` one wants an
 *     API key plus a billing profile for a static picture of a district.
 *   - It sets no advertising cookie. This page is reachable signed out, and
 *     there is no consent banner in this product any more (see the note under
 *     the legal pages) — so an iframe that starts profiling a visitor is one
 *     nothing on the site has asked permission for.
 *   - The whole URL is computable from a latitude and a longitude, so `OFFICE`
 *     above can own both the words and the pin. Google's embed encodes its
 *     camera in an opaque `pb=` blob that can only be obtained by hand from
 *     their UI, which would have made the map a second, uncheckable source of
 *     the address.
 *
 * The bbox is the pin plus a small margin. `0.008°` is roughly 900m of latitude
 * — close enough to read street names, wide enough that the district is legible
 * rather than a single junction.
 */
export function officeMapSrc({ lat, lon } = OFFICE, span = 0.008) {
  const bbox = [lon - span, lat - span / 2, lon + span, lat + span / 2]
    .map((n) => n.toFixed(5))
    .join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
}

/** Where "view a larger map" goes. Same coordinates, so it cannot drift. */
export const officeMapLink = ({ lat, lon } = OFFICE) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
