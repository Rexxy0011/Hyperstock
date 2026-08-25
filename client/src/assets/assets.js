import logoMark from "./brand/logo-mark.png";

import heroChart from "./images/hero-chart.webp";
import investorsPanel from "./images/investors-panel.webp";
import flowArrow from "./images/flow-arrow.webp";
import heroArrow from "./images/hero-arrow.webp";
import ctaCardArt from "./images/cta-card-art.webp";

// About page photography. Sources are the cosmos_* JPEGs in ./brand; these are
// the cropped webp builds actually shipped. The three split sections share one
// 4:3 crop so their images line up when the page is scanned vertically; the
// hero keeps a 4:5 portrait because it stretches beside a tall text column.
// The two grainy floor shots are encoded at q74 rather than q82 — film grain
// costs webp ~40KB apiece and the difference is invisible at render size.
import aboutFloor from "./images/about-floor.webp";
import aboutTraders from "./images/about-traders.webp";
import aboutDesk from "./images/about-desk.webp";
import aboutTape from "./images/about-tape.webp";
import aboutChart from "./images/about-chart.webp";

// The looping backdrop behind About's closing section. Re-encoded from the
// 4.5MB source at CRF 34 — it plays under an 80% ink scrim, so the quality it
// would otherwise be carrying is not visible. The poster is what renders under
// prefers-reduced-motion and whenever the browser declines to autoplay.
import marketsLoop from "./video/markets-loop.mp4";
import marketsLoopPoster from "./images/markets-loop-poster.webp";

// Landing's Security section. Sources live in ./brand as 512px PNGs; these are
// the webp builds actually shipped, roughly half the bytes at the same alpha.
import iconWallet from "./icons/wallet.webp";
import iconMoney from "./icons/money.webp";
import iconLock from "./icons/lock.webp";
import iconSecurity from "./icons/security.webp";

// About's asset-class cards and its security mark. Normalised before encoding:
// the five sources filled anywhere from 70% to 100% of their canvas, so at a
// fixed 48px box gold would have rendered visibly smaller than crypto. Each is
// cropped to its alpha bbox, scaled so the LONG edge is 464, and re-centred on
// 512 — so every one carries the same margin and the same optical weight.
import iconStocks from "./icons/stocks.webp";
import iconCrypto from "./icons/crypto.webp";
import iconGold from "./icons/gold.webp";
import iconFunds from "./icons/funds.webp";
import iconShield from "./icons/shield.webp";
// The deposit progress marker. Source is brand/deadline.png; this is the webp
// build actually shipped, ~5.8KB against 16KB, same alpha.
import iconHourglass from "./icons/hourglass.webp";

import deniseCoates from "./investors/denise_coates.webp";
import elonMusk from "./investors/elon_musk.webp";
import emmaGrede from "./investors/emma_grede.webp";
import keanuReeves from "./investors/keanu_reeves.webp";
import vadymNovynskyi from "./investors/vadym_novynskyi.webp";

export const assets = {
  logoMark,

  heroChart,
  investorsPanel,
  flowArrow,
  heroArrow,
  ctaCardArt,

  about: {
    floor: aboutFloor,
    traders: aboutTraders,
    desk: aboutDesk,
    tape: aboutTape,
    chart: aboutChart,
    loop: marketsLoop,
    loopPoster: marketsLoopPoster,
  },

  icons: {
    wallet: iconWallet,
    money: iconMoney,
    lock: iconLock,
    security: iconSecurity,

    stocks: iconStocks,
    crypto: iconCrypto,
    gold: iconGold,
    funds: iconFunds,
    shield: iconShield,
    hourglass: iconHourglass,
  },

  investors: {
    denise_coates: deniseCoates,
    elon_musk: elonMusk,
    emma_grede: emmaGrede,
    keanu_reeves: keanuReeves,
    vadym_novynskyi: vadymNovynskyi,
  },
};

export function investorPhoto(username) {
  return assets.investors[username];
}

export default assets;

/**
 * Landing's market-partner strip.
 *
 * These are the firms' OWN icon assets, fetched once and bundled rather than
 * hotlinked. Hotlinking would put nine third-party requests on the landing page,
 * each subject to a CSP rule, a rate limit and a host that may hotlink-protect
 * its CDN — the lesson Investing.com already taught the news thumbnails.
 *
 * They are ICONS, NOT WORDMARKS: every free source that survives is a favicon
 * service, so each of these is the company symbol and the name beside it is
 * rendered as text. Clearbit's logo API is discontinued, `simple-icons` carries
 * none of these ten, and Wikipedia's page image is a photograph of the building
 * for six of them.
 *
 * Native sizes run 32px (Jane Street, all that is published) to 192px, so they
 * render into a fixed square with `object-contain` — stretching any of them to
 * fill would distort a trademark.
 *
 * NYSE IS ABSENT and that is not an oversight: it publishes no icon at any path
 * or service, and its parent's mark is a different brand. It renders as a
 * wordmark alone.
 */
import partnerNasdaq from './partners/nasdaq.png';
import partnerCboe from './partners/cboe.png';
import partnerCitadel from './partners/citadel-securities.png';
import partnerVirtu from './partners/virtu.png';
import partnerJaneStreet from './partners/jane-street.png';
import partnerSig from './partners/sig.png';
import partnerApex from './partners/apex.png';
import partnerDrivewealth from './partners/drivewealth.png';
import partnerAlpaca from './partners/alpaca.png';

export const partnerLogos = {
  nasdaq: partnerNasdaq,
  cboe: partnerCboe,
  citadelSecurities: partnerCitadel,
  virtu: partnerVirtu,
  janeStreet: partnerJaneStreet,
  sig: partnerSig,
  apex: partnerApex,
  drivewealth: partnerDrivewealth,
  alpaca: partnerAlpaca,
};
