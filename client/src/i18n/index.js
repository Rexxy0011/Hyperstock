import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import uk from './locales/uk.json';
import faqEn from './locales/faq.en.json';
import faqUk from './locales/faq.uk.json';
import siteEn from './locales/site.en.json';
import siteUk from './locales/site.uk.json';
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
 * THE BUNDLES ARE STATIC IMPORTS, not lazy namespaces. Two languages of app
 * chrome is a few tens of KB, and the alternative — a fetch per language on
 * switch — buys a loading state on a menu click for a saving nobody measures.
 * Split them by namespace when a third and fourth language land, not before.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'uk', label: 'Українська', short: 'УКР' },
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
/** Digit grouping per language — `format.js` owns the sign and symbol. */
const NUMBER_LOCALE = { en: 'en-US', uk: 'uk-UA' };

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
