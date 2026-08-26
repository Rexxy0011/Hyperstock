import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import uk from './locales/uk.json';
import es from './locales/es.json';
import de from './locales/de.json';
import faqEn from './locales/faq.en.json';
import faqUk from './locales/faq.uk.json';
import faqEs from './locales/faq.es.json';
import faqDe from './locales/faq.de.json';
import siteEn from './locales/site.en.json';
import siteUk from './locales/site.uk.json';
import siteEs from './locales/site.es.json';
import siteDe from './locales/site.de.json';
import { flagEn, flagUk, flagEs, flagDe } from '../assets/assets';
import { setNumberLocale } from '../lib/format';

/**
 * Internationalisation.
 *
 * WHY NOT A TRANSLATE WIDGET. The obvious alternative — a Google Translate
 * embed — rewrites text nodes in place, which fights React's reconciler (the
 * classic `removeChild` crash) and, far worse here, REWRITES NUMBERS. This
 * product asks people to copy `1000.304000 USDT` into a wallet; a widget
 * reformatting that to `1.000,304000` produces an amount that cannot be sent.
 * Wallet addresses and transaction hashes have the same exposure. Translation
 * has to be something the app controls, not something layered over it.
 *
 * THE BUNDLES ARE STATIC IMPORTS, not lazy namespaces. The four bundles weigh
 * ~120KB of JSON before compression, which gzips to well under the cost of the
 * loading state the alternative buys: a fetch per language would put a spinner
 * on a menu click to save bytes nobody measures. Revisit at a language count
 * where that stops being true, and split by namespace rather than by language
 * when it happens, since the FAQ and marketing copy are what actually weigh.
 *
 * A LANGUAGE'S OWN NAME IS ITS LABEL, never the English name for it. Somebody
 * who cannot read the current interface cannot read "German" either, so the
 * list has to work before the translation does. The flag beside it is what
 * makes that list scannable rather than four foreign words.
 *
 * The flag is DECORATION, not the identity of the entry — a flag names a
 * country and a language is not one. `label` is what is announced and what a
 * screen reader reads; the image is `aria-hidden` at the call site. This
 * matters most for the ones where the mapping is loosest: German is also spoken
 * in Austria and Switzerland, Spanish across twenty countries.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', flag: flagEn },
  { code: 'es', label: 'Español', short: 'ES', flag: flagEs },
  { code: 'de', label: 'Deutsch', short: 'DE', flag: flagDe },
  { code: 'uk', label: 'Українська', short: 'УКР', flag: flagUk },
];

export const DEFAULT_LANGUAGE = 'en';

/** The key the detector persists under. Exported so tests and the switcher agree. */
export const LANGUAGE_KEY = 'hs_lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    /**
     * The FAQ copy is a SEPARATE FILE merged in under `faqs`, not a separate
     * namespace. Nineteen answers in the main bundle would bury the forty app
     * strings a developer actually edits, and a namespace would mean every
     * consumer naming it — for content only one page reads.
     */
    resources: {
      en: { translation: { ...en, ...siteEn, faqs: faqEn } },
      es: { translation: { ...es, ...siteEs, faqs: faqEs } },
      de: { translation: { ...de, ...siteDe, faqs: faqDe } },
      uk: { translation: { ...uk, ...siteUk, faqs: faqUk } },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    /**
     * `uk-UA` and `uk` must resolve to the same bundle. Without this a browser
     * reporting the regional tag misses every key and the whole app silently
     * renders in the fallback — which looks like the switch not working.
     */
    load: 'languageOnly',
    detection: {
      // A stored choice beats the browser's guess: someone who picked English
      // on a Ukrainian-locale machine meant it.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_KEY,
      /**
       * The detector owns the write again.
       *
       * It briefly did not: while a cookie consent banner existed, this was
       * `caches: []` and the write moved to a listener gated on functional
       * consent, because `hs_lang` is the one non-essential thing this app
       * stores and a toggle that does not gate it gates nothing. The banner is
       * gone, and the gate had to go with it — `isAllowed()` with no stored
       * record returns false, so leaving it would have meant the language
       * preference silently never persisting again.
       */
      caches: ['localStorage'],
    },
    interpolation: {
      // React escapes for us; escaping again turns an apostrophe into &#39;.
      escapeValue: false,
    },
    // Keys are readable English sentences, so a missing translation degrades to
    // something legible rather than to `portfolio.header.title`.
    nsSeparator: false,
    keySeparator: '.',
    returnEmptyString: false,
  });

/**
 * `<html lang>` FOLLOWS THE CHOICE.
 *
 * Not cosmetic: screen readers pick pronunciation from it, `:lang()` selectors
 * key off it, and font matching consults it for CJK-style disambiguation. It is
 * hardcoded `en` in index.html, so nothing else would ever update it.
 */
/**
 * Digit grouping per language. `format.js` owns the sign and the symbol.
 *
 * SPANISH IS PINNED TO `es-ES`, and the regional tag is load-bearing rather
 * than incidental. `es-419` (Latin America) groups exactly like English, so
 * picking the wrong one silently renders every figure in the other
 * convention. The flag on the switcher is Spain's, so `es-ES` is the one that
 * matches what the control promises.
 *
 * Expect one consequence that looks like a bug and is not: `es-ES` prints a
 * FOUR-DIGIT number with no group separator at all. `1000` is "1000,00" while
 * `12220.64` is "12.220,64", so a price column can hold both shapes at once.
 * That is the Real Academia's rule, not a formatting fault, and it is what a
 * Spanish reader expects. Alignment is unaffected, since the decimal mark is
 * what the tabular figures line up on.
 */
const NUMBER_LOCALE = { en: 'en-US', es: 'es-ES', de: 'de-DE', uk: 'uk-UA' };

const applyLang = (lng) => {
  const base = (lng || DEFAULT_LANGUAGE).split('-')[0];
  document.documentElement.lang = base;
  // Pushed rather than pulled: `money()` and friends are called from plain
  // functions, not components, so they cannot read a hook.
  setNumberLocale(NUMBER_LOCALE[base] ?? 'en-US');
};

applyLang(i18n.resolvedLanguage);
i18n.on('languageChanged', applyLang);

export default i18n;
