import { useTranslation } from 'react-i18next';

/**
 * The FAQ's SHAPE. The words live in `i18n/locales/faq.*.json`.
 *
 * This file used to hold the English copy inline. It cannot any more, and the
 * split is the useful kind: order, ids and which question carries a call to
 * action are structure, and structure must be identical in every language —
 * while the sentences are the part that is translated. Keeping both in one
 * file would mean a translator editing the array that also defines the running
 * 01–19 numbering, and a dropped entry in one language silently renumbering
 * that language only.
 *
 * The ids are also the anchor targets and the accordion keys, so they must not
 * change when the copy does.
 */

/** @typedef {{id: string, cta?: string}} FaqRef */

export const CATEGORY_IDS = [
  { id: 'gettingStarted', anchor: 'getting-started', items: ['whatIs', 'whoCanOpen', 'howToOpen'] },
  { id: 'accounts', anchor: 'accounts', items: ['whyVerify', 'documents', 'howLong'] },
  {
    id: 'funding',
    anchor: 'funding',
    items: ['howToFund', 'depositTime', 'howToWithdraw', 'limits'],
  },
  {
    id: 'trading',
    anchor: 'trading',
    items: ['whatCanInvest', 'sameAccount', 'fractional', 'anyTime', 'advice'],
  },
  { id: 'security', anchor: 'security', items: ['howProtected', 'suspicious'] },
  { id: 'fees', anchor: 'fees', items: ['whatFees', 'riskFree'] },
];

/** Where a question's inline call to action goes. Structure, not copy. */
const CTA_TARGET = { howToOpen: '/auth?mode=signup' };

export const FAQ_COUNT = CATEGORY_IDS.reduce((sum, c) => sum + c.items.length, 0);

/**
 * The resolved FAQ for the active language.
 *
 * A hook rather than a module constant because the content now changes at
 * runtime — a module-level array would be built once, in whichever language
 * happened to be active at import time, and never update on a switch.
 *
 * `returnObjects` is what lets a single key carry an answer's whole body as an
 * array. The alternative — `body.0`, `body.1` — makes an answer's paragraph
 * count part of its key set, so a language that needs three paragraphs where
 * English needs two cannot express it.
 *
 * THE NUMBERING IS COMPUTED, not stored, and it runs ACROSS categories. Written
 * by hand it would all need renumbering the moment a question is inserted
 * anywhere but the end — in every language at once.
 */
export function useFaqs() {
  const { t } = useTranslation();
  let n = 0;

  return CATEGORY_IDS.map((category) => ({
    id: category.anchor,
    label: t(`faqs.${category.id}.label`),
    faqs: category.items.map((item) => {
      n += 1;
      const base = `faqs.${category.id}.items.${item}`;
      return {
        key: item,
        n: String(n).padStart(2, '0'),
        q: t(`${base}.q`),
        // i18next types a `returnObjects` lookup as an opaque object; the cast
        // is the narrowest place to say what the resource file actually holds.
        body: /** @type {any[]} */ (t(`${base}.body`, { returnObjects: true })),
        cta: CTA_TARGET[item]
          ? { label: t(`${base}.cta`), to: CTA_TARGET[item] }
          : null,
      };
    }),
  }));
}
