import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from "@tanstack/react-query";
import { FiArrowRight, FiCheck } from "react-icons/fi";
import { get, post } from "../lib/api";
import { keys, QUOTE_POLL_MS } from "../lib/queryClient";
import { money } from "../lib/format";
import notify from "../lib/toast";

import Button from "../components/ui/Button";
import Avatar from "../components/ui/Avatar";
import Card from "../components/ui/Card";
import PriceChange from "../components/market/PriceChange";
import Money from "../components/market/Money";

import { assets, investorPhoto, partnerLogos } from "../assets/assets";

/** Placeholder rows held while the leaderboard resolves — the section sits
 *  above the fold now, so an empty card would be the first thing rendered. */
const SKELETON_ROWS = [1, 2, 3, 4, 5];

/**
 * One vertical rhythm for every section on the page. These had drifted to five
 * different values (56/48, 56, 40, 24, 72), so the gaps between sections read
 * as accidental rather than as a system. 56px sits on the 8px grid and was
 * already the most common.
 *
 * The ticker tape is the one exception and keeps its own `py-2.5`: it is a rule
 * between sections, not a section.
 */
const SECTION_Y = "py-14";

export default function Landing() {
  const { data: ticker } = useQuery({
    queryKey: keys.ticker,
    queryFn: () => get("/market/ticker"),
    refetchInterval: QUOTE_POLL_MS,
  });

  const { data: exchanges } = useQuery({
    queryKey: keys.exchanges,
    queryFn: () => get("/market/exchanges"),
    staleTime: Infinity,
  });

  // "Top investors this month" — monthly, measured against each trader's
  // portfolio snapshot from 30 days ago. All-time would measure against the
  // $10,000 signup grant and read +382%, which is true but not the claim here.
  // Polled on the quote interval so the board ticks the way the Forbes list
  // does. The service memoises 60s, so this costs a cache read, not a pipeline.
  const { data: board, isPending: boardPending } = useQuery({
    queryKey: keys.leaderboard("monthly"),
    queryFn: () => get("/leaderboard?period=monthly&limit=5"),
    refetchInterval: QUOTE_POLL_MS,
  });

  const tape = ticker?.items ?? [];

  return (
    <>
      <Hero />
      <TickerTape items={tape} />
      <TopInvestors rows={board?.top ?? []} loading={boardPending} />
      <Security />
      <Markets exchanges={exchanges ?? []} />
      <CtaShowcase />
      <MarketPartners />
    </>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero() {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden">
      <div
        className={`mx-auto grid max-w-300 items-center gap-12 px-8 lg:grid-cols-[1fr_1.1fr] ${SECTION_Y}`}
      >
        <div className="relative">
          <h1 className="m-0 text-[clamp(28px,4vw,42px)] font-bold">
            {t('landing.heroTitle')}
          </h1>
          <p className="mt-6 mb-8 max-w-105 font-display text-md font-normal text-text-muted">
            {t('landing.heroBody')}
          </p>
          {/* Goes to /about, not /markets. The arrow below points at this
              button as the page's "read on" affordance, and the exchange table
              further down is already the route to the market list. */}
          <Button to="/about" variant="slate" size="lg" pill>
            {t('landing.learnMore')}
            <FiArrowRight size={18} aria-hidden="true" />
          </Button>

          {/* Hand-drawn arrow sweeping in from the left margin, from the last
              h1 line down into the Learn more button.

              It lives OUTSIDE the text column (negative left) and so depends
              entirely on there being margin to sit in. That margin is the page
              gutter: 152px at 1440, but only 32px at 1024, where the arrow
              would land on top of the copy. Hence the 1400px gate rather than
              a standard breakpoint — `xl` (1280) leaves just 72px and clips
              the tail against the section's overflow-hidden.

              Anchored from the BOTTOM, not the top: the h1 wraps to a
              different number of lines as the viewport narrows, so a top
              offset drifts while the button stays put. */}
          <img
            src={assets.heroArrow}
            alt=""
            aria-hidden="true"
            width={457}
            height={806}
            className="pointer-events-none absolute bottom-10 -left-24 hidden w-20 min-[1400px]:block"
          />
        </div>

        <div className="relative">
          {/* The tinted field the shot sits on, bleeding off the right of the
              viewport. `w-screen` from the column's left edge always overshoots
              the page, and the section clips it — so it reads as a band running
              off the page rather than a box that happens to end. The image keeps
              its own panel: that panel IS the card, and the cards floating past
              its edge are what make the composition read as layered. */}
          <div className="absolute -inset-y-14 left-14 hidden w-screen bg-mist lg:block" />
          <img
            src={assets.heroChart}
            alt="A HyperStocks candlestick chart for Spotify over one week, with live Apple and Meta quotes alongside"
            width={1036}
            height={858}
            className="relative w-full"
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- ticker tape */

/**
 * A continuously scrolling price tape.
 *
 * The row is rendered twice and the track shifts -50%, so copy two is exactly
 * where copy one started when the animation wraps — no jump. Both copies must
 * therefore measure identically, which is why the gap after the last item is
 * `pr-8` on the row rather than a gap on the track: a gap between the two
 * copies would make -50% land mid-gap.
 *
 * The duplicate is aria-hidden so the tape is announced once, and the whole
 * thing stops dead under prefers-reduced-motion — this is decorative movement
 * behind live financial figures, which is exactly what that setting is for.
 */
function TickerTape({ items }) {
  if (!items.length) return <div className="h-10.5 bg-ink" />;

  const row = (hidden) => (
    <div className="flex shrink-0 gap-8 pr-8" aria-hidden={hidden || undefined}>
      {items.map((t) => (
        <span
          key={t.symbol}
          className="inline-flex items-center gap-2 font-numeric text-sm whitespace-nowrap tabular-nums"
        >
          <b className="text-text-on-deep">{t.symbol}</b>
          <span className="text-text-on-deep-muted">
            {money(t.priceCents, t.currency)}
          </span>
          <PriceChange value={t.changePct} size={12} onDark />
        </span>
      ))}
    </div>
  );

  return (
    // bg-ink, the same deep surface as the nav balance pill. The grey rules it
    // used to carry are gone: a dark band separates the sections by itself, and
    // a 1px cool-grey line on near-black reads as a rendering artefact.
    <div className="overflow-hidden bg-ink py-2.5">
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:animate-none">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- top investors */

/**
 * Sits directly under the tape, so it carries only a bottom border — the tape
 * already draws the rule above it, and two 1px lines stack into a visible 2px.
 */
function TopInvestors({ rows, loading = false }) {
  const { t } = useTranslation();
  const rowClass = (last) =>
    `flex items-center gap-4 bg-white px-6 py-3.5 ${last ? "" : "border-b border-cool-grey"}`;

  return (
    <section className="border-b border-cool-grey bg-mist">
      <div className={`mx-auto max-w-300 px-8 ${SECTION_Y}`}>
        {/* Flex rather than grid: the list takes whatever is left after the
            panel's fixed 360px, and `min-w-0` lets long usernames truncate
            instead of forcing the row wider than its column. Below lg they
            stack, with the panel second — the ranking is the substance. */}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-xl font-bold">{t('landing.topInvestors')}</h2>
            {/* The rows carry real people's names against entirely invented
                figures. In a Forbes-styled ranking that reads as a claim about
                their money unless it is said plainly, so it is said here and
                not only in the footer. Remove the names before a public
                deploy, not this line. */}
            <p className="mt-2 mb-6 font-display text-base font-normal text-text-muted">
              {t('landing.topInvestorsNote')}
            </p>

            <div className="overflow-hidden rounded-3xl border border-cool-grey bg-white shadow-card">
          {loading &&
            SKELETON_ROWS.map((n, i) => (
              <div
                key={n}
                className={rowClass(i === SKELETON_ROWS.length - 1)}
                aria-hidden="true"
              >
                <span className="h-4 w-5 animate-pulse rounded-sm bg-cool-grey" />
                <span className="size-10 animate-pulse rounded-lg bg-cool-grey" />
                <span className="h-4 w-32 animate-pulse rounded-sm bg-cool-grey" />
                <span className="ml-auto h-4 w-24 animate-pulse rounded-sm bg-cool-grey" />
              </div>
            ))}

          {!loading && !rows.length && (
            <p className="m-0 px-6 py-10 text-center text-sm text-text-muted">
              {t('landing.rankingsPending')}
            </p>
          )}

          {/* Keyed on userId, not username: a curated row carries a free-typed
              name that may match a real trader's, and two rows sharing a key
              silently drop one of them. */}
          {rows.map((r, i) => (
            <div key={r.userId} className={rowClass(i === rows.length - 1)}>
              <span
                className={`w-5 font-numeric font-semibold tabular-nums ${
                  r.rank <= 3 ? "text-void" : "text-text-muted"
                }`}
              >
                {r.rank}
              </span>

              <Avatar
                name={r.name ?? r.username}
                src={investorPhoto(r.username)}
                size={40}
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">
                  {r.name ?? r.username}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {r.trades} trades
                </span>
              </span>

              {/* Total, then today's move — the order Forbes reads in, because
                  the day's change is the part that actually moves. */}
              <span className="text-right">
                <Money
                  value={r.portfolioValueCents}
                  size={16}
                  className="block font-semibold"
                />
                <span className="mt-0.5 flex items-center justify-end gap-1.5">
                  <Money
                    value={r.dayChangeCents}
                    size={12}
                    signed
                    className="text-text-muted"
                  />
                  <PriceChange value={r.dayChangePct} size={12} pill />
                </span>
              </span>
            </div>
          ))}
            </div>

            <div className="mt-6">
              <Button to="/leaderboard" variant="secondary" size="sm">
                {t('landing.seeRankings')}
              </Button>
            </div>
          </div>

          {/* Purely decorative, so it carries an empty alt and is hidden while
              the columns are stacked — an arrow pointing right means nothing
              when the two things it connects sit one above the other. */}
          <img
            src={assets.flowArrow}
            alt=""
            width={993}
            height={406}
            className="hidden shrink-0 self-center lg:block lg:w-56"
          />

          <div className="min-w-0 flex-1">
            {/* Plain, matching "Top investors this month" in the left column.
                This used to carry the secondary Button's skin — white fill,
                cool-grey border, 8px radius. The border was the whole point of
                it: white on the mist field is a 1% difference, so without the
                rule the box was invisible and its padding just knocked the
                heading 16px out of line with the copy below. */}
            <h2 className="m-0 text-xl font-bold">
              {t('landing.fastTrackTitle')}
            </h2>
            <p className="mt-2 mb-6 font-display text-base font-normal text-text-muted">
              {t('landing.fastTrackBody')}
            </p>

            <img
              src={assets.investorsPanel}
              alt="A HyperStocks user reviewing her portfolio, alongside team member cards and a weekly activity chart"
              width={640}
              height={631}
              className="w-full rounded-3xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
}


/* --------------------------------------------------------------- security */

/**
 * Icons are full-colour raster art from ./assets/icons, not a glyph font, so
 * they are <img> rather than a component and carry explicit width/height —
 * without those the cards reflow as each one decodes.
 *
 * ICON FIT: 02 (padlock over a binary field), 03 (wallet) and 04 (magnifier
 * over a shield) all state their claim directly. 01 gets the coin-and-padlock,
 * where only the padlock is doing the work — the coin pulls toward 03's
 * meaning, so it is the one left to improve.
 */
/**
 * The four security pillars, as KEYS. The copy lives in the bundles; the icon
 * and the order are structure. The `01.` prefix is composed in the JSX rather
 * than carried in the string — it is a numeral, identical in every language,
 * and baking it into the copy means translating it four times.
 */
const PILLARS = [
  { icon: assets.icons.money, key: 'sec1' },
  { icon: assets.icons.lock, key: 'sec2' },
  { icon: assets.icons.wallet, key: 'sec3' },
  { icon: assets.icons.security, key: 'sec4' },
];

/**
 * Sits between Features and Markets: after the product has been shown, before
 * the exchange table backs the data claim up.
 *
 * No green anywhere in here, and that is a rule rather than a preference.
 * Green means gain or call-to-action everywhere else in this product; spending
 * it on four decorative icons would cost it that meaning in the two places it
 * has to be unambiguous. The icons are near-black on mist instead — at 18px a
 * Feather stroke in muted grey would have landed at the same 4.5:1 the body
 * copy is already straining against.
 */
function Security() {
  const { t } = useTranslation();
  return (
    <section className="bg-mist">
      <div className={`mx-auto max-w-300 px-8 ${SECTION_Y}`}>
        {/* A capsule with a rule running out of each side, fading as it goes.
            The rules are `flex-1` so they absorb whatever the capsule does not
            use and stay symmetrical at every width; below ~430px they collapse
            to nothing rather than forcing the capsule to wrap.

            Each gradient runs opaque at the capsule and transparent at the
            outer edge, so the two must point in OPPOSITE directions — one
            `to-r`, one `to-l`. Both the same way is the easy mistake and reads
            as a lighting error rather than a divider.

            `rounded-full` is the second sanctioned use in the codebase after
            Button's `pill` prop; see the note in styles/theme.css. */}
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-linear-to-l from-slate/55 from-60% to-transparent" />
          <h2 className="m-0 shrink-0 rounded-full border border-slate/35 px-6 py-2 text-center text-lg font-bold tracking-widest uppercase">
            {t('landing.securityEyebrow')}
          </h2>
          <span className="h-px flex-1 bg-linear-to-r from-slate/55 from-60% to-transparent" />
        </div>

        <p className="mx-auto mt-4 mb-8 max-w-118 text-center font-display text-base font-normal text-text-muted">
          {t('landing.securityLead')}
        </p>

        {/* One column on phones, two from `sm` up — and it stops at two.
            Four columns put these bodies at 26-30 characters a line, less than
            half the ~45 floor for comfortable reading, and wrapped two of the
            four titles so the paragraphs started at different heights across
            the row. The copy outgrew the original 4-up spec.

            `items-start` is wrong here — the cards must stretch so their
            borders align when one body runs a line longer, which is grid's
            default behaviour. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map(({ icon, key }, i) => (
            <Card key={key} className="flex flex-col gap-3 rounded-xl">
              {/* No mist tile behind these. It was there to give an 18px line
                  icon a surface to sit on; full-colour artwork brings its own,
                  and a second one just competes. alt is empty on purpose —
                  the heading underneath already names the idea, so announcing
                  the icon would read it twice. */}
              <img
                src={icon}
                alt=""
                width={48}
                height={48}
                className="size-12"
              />

              <h3 className="m-0 text-md font-bold">
                {/* The numeral is composed here, not carried in the copy —
                    it is the same in every language. */}
                {String(i + 1).padStart(2, '0')}. {t(`landing.${key}Title`)}
              </h3>

              <p className="m-0 font-display text-base font-normal text-text-muted">
                {t(`landing.${key}Body`)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- markets */

function Markets({ exchanges }) {
  const { t } = useTranslation();
  return (
    <section className={`mx-auto max-w-300 px-8 ${SECTION_Y}`}>
      <h2 className="m-0 mb-6 text-xl font-bold">{t('landing.marketsCovered')}</h2>

      {/* bg-ink, the same deep surface as the nav balance pill and the ticker
          tape. No border on the panel: a cool-grey rule against near-black
          reads as a rendering artefact rather than an edge, and the fill
          already defines the shape. Row separators move to white/10 for the
          same reason — the light divider has to come out of the surface, not
          off the light-theme palette. */}
      <div className="overflow-x-auto rounded-md bg-ink shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[t('landing.colExchange'), t('landing.colRegion'), t('landing.colHours')].map((h) => (
                <th
                  key={h}
                  className="border-b border-white/10 px-4 py-2.5 text-left font-display text-xs font-medium text-text-on-deep-muted"
                >
                  {h}
                </th>
              ))}
              <th className="border-b border-white/10 px-4 py-2.5 text-right font-display text-xs font-medium text-text-on-deep-muted">
                {t('landing.colStocks')}
              </th>
            </tr>
          </thead>
          <tbody>
            {exchanges.map((e) => (
              <tr key={e.code} className="last:[&>td]:border-b-0">
                <td className="border-b border-white/10 px-4 py-3 font-display text-sm font-semibold text-text-on-deep">
                  {e.code}
                </td>
                <td className="border-b border-white/10 px-4 py-3 font-display text-sm text-text-on-deep-muted">
                  {e.region}
                </td>
                <td className="border-b border-white/10 px-4 py-3 font-numeric text-sm whitespace-nowrap text-text-on-deep tabular-nums">
                  {e.hours}
                </td>
                <td className="border-b border-white/10 px-4 py-3 text-right font-numeric text-sm text-text-on-deep tabular-nums">
                  {e.stockCount.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ cta showcase */

/**
 * Artwork-only for now — the heading and subline land later, so this carries
 * the standard container and section rhythm and nothing else.
 *
 * This replaced a mockup image. The card reproduces that image's dark panel as
 * real DOM, measured off it rather than eyeballed: the panel was 728x256 in
 * the source, which reduces exactly to 91:32, and its corner radius scaled to
 * 16.7px at render size — near enough rounded-xl that the theme value is used
 * instead of an arbitrary one.
 *
 * bg-ink is the same token as the nav balance pill, the ticker tape and the
 * Markets table, so this is a fourth instance of one surface rather than a
 * new colour.
 *
 * The 91:32 ratio only applies from `lg` up. Below that the card is 247px tall
 * or less, which the headline and paragraph cannot fit inside — so on narrow
 * screens padding sets the height and the copy is allowed to push it taller.
 *
 * THE EMAIL IS COLLECTED NOW, and it goes to this product's own API rather than
 * to EmailJS or a form backend. EmailJS would ship its service id, template id
 * and public key in this bundle, where anyone can lift them and send through the
 * account's own quota — its domain allowlist is an `Origin` check, and `curl`
 * does not send one. A form backend keeps the addresses somewhere this product
 * cannot read them. Both are the right answer for a static site; there is an
 * Express API and a Mongo instance here, so `POST /api/subscribers` is 40 lines
 * and the address ends up somewhere the admin screen can show it.
 *
 * IT IS A SUBSCRIPTION, NOT A SIGNUP FUNNEL, and that changes the mechanics as
 * well as the label. It previously fired the capture and navigated straight to
 * `/auth` regardless of the outcome — correct when the button said Get Started
 * and the address was a convenience being carried across. A subscribe button
 * that navigates somewhere else has not done what it said, and a failure it
 * never mentions leaves somebody believing they are on a list they are not on.
 *
 * So the request is AWAITED, the outcome is stated, and the page does not move.
 * The form is replaced in place by a confirmation rather than reset to an empty
 * field, which is indistinguishable from a submit that did nothing.
 *
 * Signing up still has a route out of here — the nav and the hero both carry it
 * — and it is deliberately not a second button competing with this one.
 */
function CtaShowcase() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const subscribe = useMutation({
    /** @param {string} address */
    mutationFn: (address) => post("/subscribers", { email: address, source: "landing_cta" }),
    onSuccess: () => {
      setDone(true);
      notify.t("toast.subscribed");
    },
    // Not silent any more: this IS the action now, so its failure is the
    // visitor's business. The global handler renders it.
  });

  const onSubmit = (e) => {
    e.preventDefault();
    const address = email.trim();
    if (address) subscribe.mutate(address);
  };

  return (
    <section className={`mx-auto max-w-300 px-8 ${SECTION_Y}`}>
      {/* White needs an edge that ink did not: the card sits on a white page,
          so the border and shadow are what separate it from the background.
          Same pair the Card component uses, kept here rather than swapping to
          Card because that brings a p-5 that fights this padding. */}
      <div className="flex w-full flex-col items-center gap-10 rounded-xl border border-cool-grey bg-white px-6 py-14 text-center shadow-card lg:aspect-91/32 lg:flex-row lg:justify-between lg:gap-12 lg:px-14 lg:py-0 lg:text-left">
        <div className="lg:max-w-150">
          <h2 className="m-0 text-xl font-bold">
            {t('landing.closingTitle')}
          </h2>

          <p className="mt-3 mb-8 font-display text-base font-normal text-text-muted">
            {t('landing.closingBody')}
          </p>

          {done ? (
            /* Replaces the form rather than clearing it. A field that empties
               itself is indistinguishable from a submit that did nothing, and
               it invites the same address a second time. `role="status"` so a
               screen reader is told without the focus moving. */
            <p
              role="status"
              className="mx-auto flex max-w-120 items-center justify-center gap-2.5 rounded-md border border-gain/30 bg-green-tint px-4 py-3.5 text-base font-medium text-gain lg:mx-0 lg:justify-start"
            >
              <FiCheck size={18} aria-hidden="true" />
              {t('landing.subscribedTitle')}
            </p>
          ) : (
            <form
              onSubmit={onSubmit}
              className="mx-auto flex w-full max-w-120 flex-col gap-3 sm:flex-row lg:mx-0"
            >
              <label className="sr-only" htmlFor="cta-email">
                {t('landing.emailAddress')}
              </label>
              <input
                id="cta-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('landing.emailPlaceholder')}
                autoComplete="email"
                className="min-w-0 flex-1 rounded-md border border-cool-grey bg-white px-4 py-3 font-display text-base text-text-body outline-none placeholder:text-text-muted focus:border-slate"
              />
              <Button type="submit" size="lg" className="shrink-0" disabled={subscribe.isPending}>
                {subscribe.isPending ? t('common.submitting') : t('landing.subscribe')}
              </Button>
            </form>
          )}
        </div>

        {/* Corners are baked into the alpha, not applied with a CSS radius:
            the source square was clipped flat on its right edge, so a CSS
            radius would round three corners and leave the fourth square. */}
        <img
          src={assets.ctaCardArt}
          alt="An Apple holding card showing total shares and total return"
          width={929}
          height={933}
          className="w-56 shrink-0 sm:w-64 lg:w-72"
        />
      </div>
    </section>
  );
}


/* ---------------------------------------------------------- market partners */

/**
 * The venues and firms that make up the market structure this product models.
 *
 * DATA, NOT COPY — proper nouns are the same in every language, so the list
 * lives here and only the heading and the line under it are translated. Same
 * rule as the exchange table above and Landing's `PILLARS`.
 *
 * A MARQUEE RATHER THAN A GRID, because a static row of ten wordmarks at this
 * width either wraps into an awkward two-and-a-bit lines or shrinks the type
 * until it stops reading as a logo strip. It reuses the ticker tape's keyframes
 * and its doubling technique — the row is rendered twice and the track shifts
 * exactly -50%, so copy two lands where copy one began and the wrap is
 * seamless. Both copies must therefore measure identically, which is why the
 * trailing gap is `pr-14` on the row rather than a gap on the track.
 *
 * UNDER `prefers-reduced-motion` IT BECOMES A WRAPPED, CENTRED LIST rather than
 * a frozen marquee. Stopping the animation would leave the strip cut off
 * mid-name at the right edge on any narrow viewport — the ticker tape gets away
 * with freezing because a truncated price list still reads as a price list, and
 * a truncated partner list reads as a layout bug. The duplicate copy is hidden
 * in that mode so nothing is announced or shown twice.
 */
const PARTNERS = [
  { name: 'NASDAQ', logo: partnerLogos.nasdaq },
  // NYSE PUBLISHES NO FAVICON OR ICON ANYWHERE — 404 from nyse.com directly and
  // from every icon service. Its parent (theice.com) has one, but that is the
  // ICE brand, not this one, and drawing a trademark by hand is the thing
  // `CoinIcon` already refuses to do. So it renders as a wordmark alone, which
  // is what the missing-logo path exists for.
  { name: 'NYSE', logo: null },
  { name: 'CBOE', logo: partnerLogos.cboe },
  { name: 'CITADEL SECURITIES', logo: partnerLogos.citadelSecurities },
  { name: 'VIRTU', logo: partnerLogos.virtu },
  { name: 'JANE STREET', logo: partnerLogos.janeStreet },
  { name: 'SIG', logo: partnerLogos.sig },
  { name: 'APEX', logo: partnerLogos.apex },
  { name: 'DRIVEWEALTH', logo: partnerLogos.drivewealth },
  { name: 'ALPACA', logo: partnerLogos.alpaca },
];

function MarketPartners() {
  const { t } = useTranslation();

  const row = (duplicate) => (
    <div
      className={`flex shrink-0 items-center gap-14 pr-14 motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-x-10 motion-reduce:gap-y-4 motion-reduce:pr-0 ${
        duplicate ? 'motion-reduce:hidden' : ''
      }`}
      aria-hidden={duplicate || undefined}
    >
      {PARTNERS.map(({ name, logo }) => (
        <span key={name} className="inline-flex items-center gap-2.5 whitespace-nowrap">
          {logo && (
            <img
              src={logo}
              alt=""
              aria-hidden="true"
              width={24}
              height={24}
              // `object-contain` in a square box, because the marks arrive at
              // nine different native sizes (32px to 192px) and any of them
              // stretched to fill would distort a trademark.
              //
              // A failed load HIDES THE MARK rather than leaving a broken
              // frame: the wordmark beside it already carries the name, so the
              // row degrades to exactly what it looked like before there were
              // logos. Same rule as `AssetMark` and `Thumbnail`.
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              className="size-6 shrink-0 object-contain"
            />
          )}
          {/* Tracked-out uppercase at a muted weight: this is a credibility
              strip, and type that competes with the CTA above it turns a quiet
              signal into another thing shouting. */}
          <span className="font-display text-base font-semibold tracking-[0.12em] text-text-muted">
            {name}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <section className="border-t border-cool-grey bg-mist">
      <div className="mx-auto max-w-300 px-8 py-14">
        <div className="text-center">
          <h2 className="m-0 text-xl font-bold">{t('landing.partnersTitle')}</h2>
          <p className="mx-auto mt-3 mb-0 max-w-150 font-display text-base font-normal text-text-muted">
            {t('landing.partnersBody')}
          </p>
        </div>

        {/* Clipped, with the edges MASKED rather than cut.
            A hard clip severs a wordmark mid-letter — measured at 1440 it left
            "NYSE" reading "YSE" against the left edge, which looks like a
            rendering fault rather than a strip that continues. The gradient
            makes entering and leaving deliberate. Dropped under reduced motion,
            where nothing moves and a fade over static text is just low
            contrast. */}
        <div className="mt-10 overflow-hidden mask-[linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] motion-reduce:mask-none">
          <div className="flex w-max animate-marquee-partners hover:[animation-play-state:paused] motion-reduce:w-full motion-reduce:animate-none">
            {row(false)}
            {row(true)}
          </div>
        </div>

        {/*
          NOT IN THE SUPPLIED COPY. These are real, trademarked firms, and a
          heading reading "Our Market Partners" above them is a claim about
          commercial relationships that do not exist — a materially stronger
          statement than the illustrative names on the leaderboard, because it
          names counterparties rather than individuals. One quiet line is what
          separates a credibility strip from an assertion of affiliation.
        */}
        <p className="mx-auto mt-8 mb-0 max-w-150 text-center text-2xs text-text-muted">
          {t('landing.partnersNote')}
        </p>
      </div>
    </section>
  );
}
