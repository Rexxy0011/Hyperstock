import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The translation bundles, checked against each other.
 *
 * IT LIVES IN THE SERVER SUITE BECAUSE THAT IS THE ONLY TEST RUNNER THIS REPO
 * HAS, and `npm run check` is the gate every change goes through. Nothing here
 * imports client runtime code or touches a database: these are four pairs of
 * JSON files being compared as data, so the cross-workspace read costs nothing
 * and buys the check a place it will actually be run.
 *
 * IT WAS A ONE-LINE NODE COMMAND UNTIL THERE WERE FOUR LANGUAGES. Two bundles
 * can be diffed by hand when something looks wrong. Four cannot, and the
 * failure mode is the reason it matters: a missing key does not throw, it
 * falls back to English, so a Spanish page renders one English sentence in the
 * middle of a paragraph and nothing anywhere reports it. The same is true of a
 * mistyped `{{count}}`, which renders the braces literally on screen.
 */

const dir = fileURLToPath(new URL('../../client/src/i18n/locales/', import.meta.url));
const load = (f) => JSON.parse(readFileSync(dir + f, 'utf8'));

/** Every language the switcher offers. `en` is the reference the rest match. */
const LANGS = ['en', 'es', 'de', 'uk'];

const bundle = (l) => ({ ...load(`${l}.json`), ...load(`site.${l}.json`), faqs: load(`faq.${l}.json`) });

/**
 * Plural suffixes are stripped before comparing. Ukrainian legitimately carries
 * `_few` and `_many` where English has only `_one`/`_other`, so comparing raw
 * keys would fail on a bundle that is correct.
 */
const base = (k) => k.replace(/_(one|few|many|other)$/, '');

function flatten(node, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(base(key), v);
  }
  return out;
}

/** The same walk, keeping the plural suffix the comparison above drops. */
function rawKeys(node, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) rawKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

/** Interpolation names in a string, or in the strings inside an array. */
function placeholders(value) {
  const text = Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')
    : String(value ?? '');
  return [...new Set([...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]))].sort().join(',');
}

test('locale bundles', async (t) => {
  const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(bundle(l))]));
  const en = flat.en;

  await t.test('every language carries exactly the English key set', () => {
    for (const l of LANGS) {
      const missing = [...en.keys()].filter((k) => !flat[l].has(k));
      const extra = [...flat[l].keys()].filter((k) => !en.has(k));
      assert.deepEqual(missing, [], `${l} is missing keys`);
      assert.deepEqual(extra, [], `${l} has keys English does not`);
    }
  });

  /**
   * A renamed or mistyped placeholder is the failure this catches: i18next does
   * not error on one it cannot fill, it leaves `{{cout}}` in the sentence.
   */
  await t.test('interpolation placeholders match English exactly', () => {
    for (const l of LANGS.filter((x) => x !== 'en')) {
      const wrong = [...en.entries()]
        .filter(([k, v]) => placeholders(v) !== placeholders(flat[l].get(k)))
        .map(([k]) => `${k} (en: ${placeholders(en.get(k))}, ${l}: ${placeholders(flat[l].get(k))})`);
      assert.deepEqual(wrong, [], `${l} placeholder mismatch`);
    }
  });

  /**
   * Both languages that need a plural need BOTH forms. A bundle carrying only
   * `_other` renders "1 exchanges", which reads as a bug rather than a
   * translation gap.
   */
  await t.test('a plural key carries every form its language needs', () => {
    const forms = {
      en: ['one', 'other'],
      es: ['one', 'other'],
      de: ['one', 'other'],
      // Ukrainian resolves through Intl.PluralRules, which asks for all four.
      uk: ['one', 'few', 'many', 'other'],
    };

    for (const l of LANGS) {
      // The un-stripped keys, which `flatten` collapses by design.
      const keys = rawKeys(bundle(l));
      const stems = new Set([...keys].filter((k) => /_(one|few|many|other)$/.test(k)).map(base));
      assert.ok(stems.size > 0, `${l} has no plural keys at all, which cannot be right`);

      const missing = [];
      for (const stem of stems) {
        for (const form of forms[l]) {
          if (!keys.has(`${stem}_${form}`)) missing.push(`${stem}_${form}`);
        }
      }
      assert.deepEqual(missing, [], `${l} is missing plural forms`);
    }
  });

  /**
   * THE TYPOGRAPHY RULE THIS PRODUCT SETS ITS COPY IN. Em and en dashes were
   * swept out of every rendered string; a bundle is the easiest place for one
   * to come back, since a translator's editor may insert them automatically.
   *
   * The U+2212 MINUS in `lib/format.js` is a different character and is not
   * checked here — it is a mathematical sign on a number, not punctuation in a
   * sentence, and it is deliberate.
   */
  await t.test('no long dashes in any bundle', () => {
    for (const l of LANGS) {
      const offenders = [...flatten(bundle(l)).entries()]
        .filter(([, v]) => /[—–]/.test(Array.isArray(v) ? v.join(' ') : String(v ?? '')))
        .map(([k]) => k);
      assert.deepEqual(offenders, [], `${l} carries an em or en dash`);
    }
  });

  /**
   * A language's own name is what the switcher lists, so an empty one leaves a
   * row somebody cannot identify in the one menu that must work before the
   * translation does.
   */
  await t.test('nothing is blank', () => {
    for (const l of LANGS) {
      const blank = [...flatten(bundle(l)).entries()]
        .filter(([, v]) => (Array.isArray(v) ? v.length === 0 : String(v ?? '').trim() === ''))
        .map(([k]) => k);
      assert.deepEqual(blank, [], `${l} has an empty value`);
    }
  });
});
