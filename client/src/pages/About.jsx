import { FiArrowRight, FiCheck } from "react-icons/fi";
import { useTranslation } from 'react-i18next';

import { useAuth } from "../auth/AuthProvider";
import Button from "../components/ui/Button";
import CountUp from "../components/ui/CountUp";
import Eyebrow from "../components/ui/Eyebrow";
import Reveal from "../components/ui/Reveal";
import VideoBackdrop from "../components/ui/VideoBackdrop";
import { assets } from "../assets/assets";

/**
 * The "Learn more" destination, reached from the Landing hero and the footer's
 * Company column. Structured from the supplied consulting-site reference, which
 * has exactly three section archetypes; the page reuses them rather than
 * inventing a fourth per section:
 *
 *   A  hero card — mist ground, copy left, photo right, counters beneath a rule
 *   B  split    — photo one side, copy the other, alternating down the page
 *   C  grid     — eyebrow, heading, then cards with the first one filled
 *
 * Two sections opt out, each for a stated reason: Security is centred because
 * there is no sixth photograph and reusing one would read as a mistake, and the
 * closing section runs video.
 *
 * The copy is the client's, normalised only in that "Hyperstock" is written
 * "HyperStocks" to match the wordmark it sits under.
 *
 * NOTE ON CLAIMS. This copy positions the product as a multi-asset platform
 * covering stocks, crypto, gold and mutual funds. The app trades equities and
 * nothing else — there is no crypto, commodity or fund model anywhere in
 * server/src/models. Three of the four cards in "Access the Markets That
 * Matter" describe things that do not exist yet.
 */

/**
 * The page's two calls to action, resolved against the session.
 *
 * Asking a signed-in visitor to open an account is the kind of thing that
 * makes a product feel like it does not know who you are, and this page is
 * reachable from the nav while logged in.
 *
 * It waits on `authReady`. `AuthProvider` calls /auth/refresh on mount, so
 * before that resolves `user` is null and is indistinguishable from a genuine
 * anonymous visit — acting on it early would show every returning user "Open
 * an Account" and then swap it a moment later. Holding the signed-out copy
 * until the answer arrives is the safe default: the overwhelming majority of
 * traffic to a marketing page is signed out, so it is right almost always and
 * briefly stale otherwise.
 */
function useAccountCta() {
  const { user, authReady } = useAuth();
  const signedIn = authReady && Boolean(user);

  return signedIn
    ? { to: "/dashboard", label: "Go to dashboard" }
    : { to: "/auth?mode=signup", label: "Open an Account" };
}

/** Landing's vertical rhythm, kept identical so the two pages agree. */
const SECTION_Y = "py-14";

const CONTAINER = "mx-auto max-w-300 px-8";

export default function About() {
  return (
    <>
      <AboutHero />
      <WithoutComplexity />
      <Markets />
      <ModernInvestor />
      <Technology />
      <Security />
      <Strategy />
      <WhatsNext />
      <AboutCta />
    </>
  );
}

/* --------------------------------------------------------------- archetype A */

/**
 * The counter bar under the hero buttons.
 *
 * These are supplied marketing figures, not measurements — nothing in the app
 * produces them, and no endpoint is behind them. They are held as structured
 * parts rather than strings ("$1.2B+" → prefix/value/suffix) because CountUp
 * has to animate the numeric part and leave the rest alone.
 */
/**
 * The hero figures. The NUMBERS stay here — they are the same in every
 * language — and only the label and its sentence are keyed out.
 */
const HERO_STATS = [
  { prefix: '$', to: 3, suffix: 'B+', key: 'statVolume' },
  { to: 2.5, decimals: 1, suffix: 'M+', key: 'statTrades' },
  { to: 500, suffix: 'K+', key: 'statInvestors' },
  { prefix: '$', to: 1.2, decimals: 1, suffix: 'B+', key: 'statAssets' },
  { to: 40, suffix: '+', key: 'statMarkets' },
];

function AboutHero() {
  const { t } = useTranslation();
  const cta = useAccountCta();

  return (
    <section className={`${CONTAINER} ${SECTION_Y}`}>
      {/* The reference's opening card: a tinted panel inset from the page, not
          a full-bleed band. The generous radius is what makes it read as a
          card at this size — at rounded-md a 1100px panel just looks like the
          page has changed colour. */}
      <div className="overflow-hidden rounded-3xl bg-mist p-8 lg:p-12">
        <div className="grid items-stretch gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <Reveal className="flex flex-col">
            <Eyebrow className="self-start">{t('about.eyebrow')}</Eyebrow>

            <h1 className="mt-6 mb-0 text-[clamp(28px,4vw,42px)] font-bold">
              {t('about.title')}
            </h1>

            <div className="mt-5 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
              <p className="m-0">
                {t('about.lead1')}
              </p>
              <p className="m-0">
                {t('about.lead2')}
              </p>
              <p className="m-0">
                {t('about.lead3')}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button to={cta.to} pill>
                {cta.label}
                <FiArrowRight size={16} aria-hidden="true" />
              </Button>
              <Button to="/markets" variant="secondary" pill>
                Explore markets
              </Button>
            </div>
          </Reveal>

          {/* The photo is positioned out of flow inside a wrapper that has no
              intrinsic height, so the row is sized by the copy column alone and
              the picture matches it exactly.

              `h-full` on the <img> itself does not do this: a stretch item with
              a percentage height and an intrinsic aspect ratio resolves to its
              own natural size first, so the 4:5 source made the row 585px tall
              against 490px of copy and left a gap under the buttons. Below `lg`
              the wrapper carries the ratio, because there is no row to fill. */}
          {/* Still the grid item with no intrinsic height, so the note above
              holds: Reveal renders exactly this div, it does not add one. The
              `transform` the reveal animates does not disturb the absolute
              child, which is positioned against `relative` on this same
              element and travels with it. */}
          <Reveal delay={90} className="relative aspect-4/5 w-full lg:aspect-auto">
            <img
              src={assets.about.floor}
              alt="The main trading floor of a stock exchange, its overhead boards lit with quotes"
              width={864}
              height={1080}
              className="absolute inset-0 size-full rounded-2xl object-cover"
            />
          </Reveal>
        </div>

        {/* Under the buttons in reading order, but spanning the whole card
            rather than sitting inside the copy column. Five figures in the
            521px left column is 104px apiece — narrower than the widest value
            plus its label, so they would collide the way an earlier three-up
            row did at 414. Across the full card each gets 182px.

            Never more than three abreast below `lg`: five columns of a title
            AND a sentence is the layout that turns this into confetti. */}
        <Reveal
          delay={180}
          className="mt-10 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-cool-grey pt-10 sm:grid-cols-3 lg:grid-cols-5"
        >
          {HERO_STATS.map(({ key, ...fig }) => (
            <div key={key}>
              <CountUp
                {...fig}
                className="block font-numeric text-xl font-semibold tabular-nums"
              />
              <span className="mt-2 block font-display text-sm font-semibold">
                {t(`about.${key}`)}
              </span>
              <span className="mt-1 block font-display text-xs text-text-muted">
                {t(`about.${key}Sub`)}
              </span>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- archetype B */

/**
 * The alternating photo/copy row. `reverse` moves the photo to the right on
 * large screens only — below `lg` the photo always comes first, because a
 * stacked layout that sometimes leads with the picture and sometimes with the
 * heading reads as two different templates rather than one alternating.
 *
 * The photo takes the row's full height rather than a fixed ratio, so a section
 * with a checklist and one without still end level with their images. This is
 * the opposite call from the hero, and safe here for the opposite reason: in
 * these sections the copy is reliably the taller of the two.
 */
function Split({ image, alt, reverse = false, children }) {
  // The half that is visually FIRST leads, so the stagger follows the eye
  // rather than the source order — `reverse` moves the photo to the right, and
  // a right-hand element arriving before the left one reads backwards. Below
  // `lg` the columns stack photo-first in both cases, which is why the photo
  // never leads by more than one step.
  const imageDelay = reverse ? 110 : 0;
  const copyDelay = reverse ? 0 : 110;

  return (
    <section className={`${CONTAINER} ${SECTION_Y}`}>
      <div className="grid items-stretch gap-10 lg:grid-cols-2 lg:gap-14">
        {/* The wrapper is the grid item now, so it is what stretches and the
            image's `lg:h-full` resolves against it — the row is still sized by
            the copy column and the photo still fills it. `lg:order-2` has to
            travel to the wrapper for the same reason. */}
        <Reveal
          delay={imageDelay}
          className={`lg:h-full ${reverse ? "lg:order-2" : ""}`}
        >
          <img
            src={image}
            alt={alt}
            className="aspect-4/3 w-full rounded-2xl object-cover lg:aspect-auto lg:h-full lg:max-h-130"
          />
        </Reveal>
        <Reveal delay={copyDelay} className="flex flex-col justify-center">
          {children}
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Two columns of affirmations, lifted from the sentences above them rather
 * than invented.
 *
 * The checks are green, which the Landing security section explicitly refuses
 * for its icons. The distinction is that those were decorative and these are
 * semantic: a tick means "yes, this is included", and green-for-affirmative is
 * the one meaning in this palette nobody has to be taught.
 */
function CheckList({ items }) {
  return (
    <ul className="mt-6 grid list-none grid-cols-1 gap-x-8 gap-y-3 p-0 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2.5">
          <FiCheck
            size={16}
            className="shrink-0 text-gain"
            aria-hidden="true"
          />
          <span className="font-display text-base font-medium">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function WithoutComplexity() {
  const { t } = useTranslation();
  return (
    <Split
      image={assets.about.traders}
      alt="A crowded exchange floor, traders working beneath a wall of price boards"
    >
      <Eyebrow className="self-start">{t('about.accessEyebrow')}</Eyebrow>

      <h2 className="mt-6 mb-0 text-2xl font-medium">
        {t('about.accessTitle')}
      </h2>

      <div className="mt-4 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
        <p className="m-0">
          {t('about.accessP1')}
        </p>
        <p className="m-0 font-medium text-text-body">
          {t('about.accessP2')}
        </p>
        <p className="m-0">
          {t('about.accessP3')}
        </p>
        <p className="m-0">
          {t('about.accessP4')}
        </p>
      </div>

      <CheckList
        items={[
          t('about.accessB1'),
          t('about.accessB2'),
          t('about.accessB3'),
          t('about.accessB4'),
        ]}
      />
    </Split>
  );
}

/* --------------------------------------------------------------- archetype C */

/**
 * Full-colour raster art, matching the treatment on Landing's security cards:
 * <img> rather than a component, explicit width/height so the cards do not
 * reflow as each one decodes, and empty alt because the heading underneath
 * already names the idea.
 *
 * NO TILE BEHIND THEM. The mist square existed to give an 18px line glyph a
 * surface to sit on; artwork brings its own and a second one just competes.
 * Same call as Landing.
 *
 * ONE SOURCE IS UNUSED. `brand/graph.png` is a bar chart with a DESCENDING
 * arrow — a loss. Stocks takes `statistics` instead, which is the same subject
 * rising. Do not swap them back.
 */
const ASSET_CLASSES = [
  { icon: assets.icons.stocks, key: 'assetStocks' },
  { icon: assets.icons.crypto, key: 'assetCrypto' },
  { icon: assets.icons.gold, key: 'assetGold' },
  { icon: assets.icons.funds, key: 'assetFunds' },
];

function Markets() {
  const { t } = useTranslation();
  return (
    <section className="bg-mist">
      <div className={`${CONTAINER} ${SECTION_Y}`}>
        <Reveal>
          <Eyebrow>{t('about.assetsEyebrow')}</Eyebrow>
          <h2 className="mt-6 mb-8 max-w-160 text-2xl font-medium">
            {t('about.assetsTitle')}
          </h2>
        </Reveal>

        {/* Two columns, not the reference's three, and it stops at two for the
            reason the Landing security grid does: these bodies run 120-180
            characters, and a four-up row sets them at under 30 characters a
            line. Four cards would also leave a three-column row an orphan. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {ASSET_CLASSES.map(({ icon, key }, i) => {
            // The first card is filled, as in the reference. green-deep rather
            // than the brand green: #00c853 carries white body text at 2.24:1,
            // this carries it at 10.2:1 while staying the same hue.
            //
            // Checked against the artwork before keeping it: all four icons
            // read on green-deep, including the two that carry a black outline,
            // so the fill did not have to move to a card with a safer glyph.
            const filled = i === 0;
            return (
              // `h-full` on both wrapper and card: the Reveal div is the grid
              // item, so it takes the stretch and the card has to be told to
              // fill it or the two cards in a row stop ending level.
              <Reveal key={key} delay={i * 80} className="h-full">
              <div
                className={`flex h-full flex-col gap-3 rounded-xl border p-5 ${
                  filled
                    ? "border-transparent bg-green-deep text-text-on-deep"
                    : "border-cool-grey bg-white shadow-card"
                }`}
              >
                <img
                  src={icon}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12"
                />

                <h3 className="m-0 text-md font-bold">{t(`about.${key}`)}</h3>

                {/* white/80 rather than --color-text-on-deep-muted. That token
                    is calibrated for --color-ink; on green-deep it lands at
                    3.98:1, under AA for body text. This composites to 7.1:1
                    and still sits below the heading. */}
                <p
                  className={`m-0 font-display text-base font-normal ${
                    filled ? "text-white/80" : "text-text-muted"
                  }`}
                >
                  {t(`about.${key}Body`)}
                </p>
              </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- more splits */

function ModernInvestor() {
  const { t } = useTranslation();
  return (
    <Split
      image={assets.about.desk}
      alt="A dealing desk running two terminals of live quotes and volume analysis"
      reverse
    >
      <Eyebrow className="self-start">{t('about.controlEyebrow')}</Eyebrow>

      <h2 className="mt-6 mb-0 text-2xl font-medium">
        {t('about.controlTitle')}
      </h2>

      <div className="mt-4 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
        <p className="m-0 font-medium text-text-body">
          {t('about.controlP1')}
        </p>
        <p className="m-0">
          {t('about.controlP2')}
        </p>
        <p className="m-0">
          {t('about.controlP3')}
        </p>
      </div>

      <CheckList
        items={[
          t('about.controlB1'),
          t('about.controlB2'),
          t('about.controlB3'),
          t('about.controlB4'),
        ]}
      />
    </Split>
  );
}

function Technology() {
  const { t } = useTranslation();
  return (
    <Split
      image={assets.about.tape}
      alt="A market data terminal listing index levels, volumes and volatility in red and green"
    >
      <Eyebrow className="self-start">{t('about.techEyebrow')}</Eyebrow>

      <h2 className="mt-6 mb-0 text-2xl font-medium">
        {t('about.techTitle')}
      </h2>

      <div className="mt-4 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
        <p className="m-0 font-medium text-text-body">
          {t('about.techP1')}
        </p>
        <p className="m-0">
          {t('about.techP2')}
        </p>
        <p className="m-0">
          {t('about.techP3')}
        </p>
      </div>
    </Split>
  );
}

/* ---------------------------------------------------------------- security */

/**
 * Centred rather than split, and the one section that breaks the alternating
 * rhythm. There is no sixth photograph: five are in use above and the only
 * remaining source is a pharmaceutical dashboard, which would put visibly wrong
 * data on the page. Repeating one of the five reads as a mistake, so this
 * section stands on type alone.
 *
 * On mist, and that is structural rather than decorative. Without it the page
 * runs five white sections between the asset grid and the video, which is long
 * enough that the middle of the page stops reading as separate sections.
 *
 * The blue shield, NOT `icons.security` from Landing. That one is a saturated
 * yellow disc, and at this size alone in the centre of a section it was the
 * only high-chroma element on the page and read as a warning badge rather than
 * a section mark. Larger than the card icons at 64px, because it is carrying a
 * whole section rather than labelling one card in a grid of four.
 */
function Security() {
  const { t } = useTranslation();
  return (
    <section className="bg-mist">
      <div className={`${CONTAINER} ${SECTION_Y}`}>
        <Reveal className="mx-auto flex max-w-160 flex-col items-center text-center">
          <img
            src={assets.icons.shield}
            alt=""
            width={64}
            height={64}
            className="size-16"
          />

          <Eyebrow className="mt-6">{t('about.securityEyebrow')}</Eyebrow>

          <h2 className="mt-6 mb-0 text-2xl font-medium">
            {t('about.securityTitle')}
          </h2>

          <div className="mt-5 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
            <p className="m-0 font-medium text-text-body">
              {t('about.securityP1')}
            </p>
            <p className="m-0">
              {t('about.securityP2')}
            </p>
            <p className="m-0">
              {t('about.securityP3')}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- strategy */

function Strategy() {
  const { t } = useTranslation();
  return (
    <Split
      image={assets.about.chart}
      alt="A performance chart on screen, one series climbing against another"
      reverse
    >
      <Eyebrow className="self-start">{t('about.portfolioEyebrow')}</Eyebrow>

      <h2 className="mt-6 mb-0 text-2xl font-medium">
        {t('about.portfolioTitle')}
      </h2>

      <div className="mt-4 flex flex-col gap-4 font-display text-base font-normal text-text-muted">
        <p className="m-0 font-medium text-text-body">
          {t('about.portfolioP1')}
        </p>
        <p className="m-0">
          {t('about.portfolioP2')}
        </p>
        <p className="m-0">
          {t('about.portfolioP3')}
        </p>
        <p className="m-0">
          {t('about.portfolioP4')}
        </p>
      </div>
    </Split>
  );
}

/* -------------------------------------------------------------------- video */

/**
 * The closing statement, over the market-loop video.
 *
 * THE SCRIM IS NOT DECORATION. The footage runs bright green candles and a
 * white line chart straight through the middle of the frame, which is exactly
 * where the copy sits. Measured across 54 sampled frames, at the 99.9th
 * percentile of brightness inside the text band:
 *
 *   scrim      white heading    white/85 body    on-deep-muted body
 *   ink/65        6.6:1            4.8:1              2.6:1
 *   ink/78       10.3:1            7.4:1              4.1:1
 *   ink/85       13.0:1            9.4:1              5.1:1
 *
 * Hence ink/80 with white and white/85 — measured on the rendered video at
 * 10.9:1 and 7.8:1 against the worst frame of a full loop. The muted on-deep
 * token fails AA over this video at any scrim weak enough to leave the footage
 * visible, which is why the body copy here does not use the same colour as
 * every other dark surface in the product.
 *
 * `isolate` keeps the two negative z-indexes inside this section; without it
 * they escape the stacking context and slide behind the page background.
 */
function WhatsNext() {
  const { t } = useTranslation();
  return (
    <section className="relative isolate overflow-hidden bg-ink text-text-on-deep">
      <VideoBackdrop
        src={assets.about.loop}
        poster={assets.about.loopPoster}
        className="absolute inset-0 -z-20 size-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-ink/80" />

      {/* py-20 rather than the page's SECTION_Y, and the only section that
          departs from it. object-cover on a 16:9 source in a 1440-wide band
          shows a horizontal slice of the footage: at SECTION_Y's 387px that
          slice is 44% of the frame and the chart reads as texture rather than
          as a chart. The extra 48px takes it past half. */}
      <div className={`${CONTAINER} py-20`}>
        {/* The copy reveals; the video and the scrim behind it do not. Fading a
            full-bleed background band in reads as a rendering fault rather than
            as an entrance, and `VideoBackdrop` already has its own
            intersection trigger — it starts playing when this scrolls into
            view, which is the same moment. */}
        <Reveal className="mx-auto max-w-160 text-center">
          <h2 className="m-0 text-2xl font-medium">
            {t('about.nextTitle')}
          </h2>

          <div className="mt-5 flex flex-col gap-4 font-display text-base font-normal text-white/85">
            <p className="m-0">
              {t('about.nextP1')}
            </p>
            <p className="m-0">
              {t('about.nextP2')}
            </p>
            <p className="m-0">
              {t('about.nextP3')}
            </p>
          </div>

          <p className="mt-8 mb-0 font-display text-lg font-bold text-text-on-deep">
            {t('about.nextP4')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- cta */

/**
 * The same skin as Landing's closing card — white, cool-grey border, one
 * shadow, rounded-xl — so the two pages end the same way.
 *
 * It does NOT take Landing's 91:32 ratio. That ratio was measured off a mockup
 * whose right half is filled with artwork; with only a heading, a line and a
 * button it renders a 1136x399 panel that is two-thirds empty. Padding sets the
 * height here, and the copy and the button sit on opposite ends of the row so
 * the width is doing something.
 */
function AboutCta() {
  const { t } = useTranslation();
  const cta = useAccountCta();

  return (
    <section className={`${CONTAINER} ${SECTION_Y}`}>
      <Reveal className="flex w-full flex-col items-center gap-8 rounded-xl border border-cool-grey bg-white px-6 py-12 text-center shadow-card lg:flex-row lg:justify-between lg:gap-12 lg:px-14 lg:text-left">
        <div className="lg:max-w-150">
          <h2 className="m-0 text-xl font-bold">{t('about.ctaTitle')}</h2>
          <p className="mt-3 mb-0 font-display text-base font-normal text-text-muted">
            {t('about.ctaBody')}
          </p>
        </div>

        <Button to={cta.to} size="lg" pill className="shrink-0">
          {cta.label}
          <FiArrowRight size={18} aria-hidden="true" />
        </Button>
      </Reveal>
    </section>
  );
}
