import { useTranslation } from 'react-i18next';
import Select from '../ui/Select';
import { LANGUAGES } from '../../i18n';

/**
 * The language control.
 *
 * IT REUSES `ui/Select` rather than being a third dropdown. That component is
 * already a proper listbox — roles, `aria-activedescendant`, arrow keys, focus
 * return, click-outside — and a language menu is exactly the control that must
 * be reachable without a mouse. It also inherits the fix that made it exist: a
 * native `<select>` renders dark-on-dark in the system popup and reads as empty.
 *
 * The label is the language's OWN NAME — "Українська", not "Ukrainian". Someone
 * who cannot read the current interface language cannot read an English list of
 * languages either, which is the one list on the page that has to work before
 * the translation does.
 *
 * THE FLAG SHOWS IN BOTH MODES, and in the compact one it is the point. The nav
 * trigger has room for about three characters, so before there were flags it
 * read "EN" against a list of four codes — and "ES" / "DE" tell apart two
 * languages a reader may not have been looking for. The flag is recognised
 * without being read, which is the only thing that works at 20px.
 *
 * IT IS DECORATION AND MARKED AS SUCH. A flag names a country and a language is
 * not one: German is also Austria and Switzerland, Spanish is twenty countries,
 * and English here flies the UK's. So every flag is `aria-hidden` and the
 * accessible name comes from `label` — a screen reader announces "Deutsch",
 * never "flag of Germany". `alt=""` on the image says the same thing twice on
 * purpose, since the two are read by different things.
 *
 * @param {{ compact?: boolean, className?: string }} props
 */
export default function LanguageSwitcher({ compact = false, className = '' }) {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div className={className}>
      {!compact && (
        <label
          htmlFor="lang-select"
          className="mb-1.5 block text-2xs font-medium text-text-muted"
        >
          {t('lang.label')}
        </label>
      )}
      <Select
        id="lang-select"
        value={current}
        // The nav trigger is 112px and the longest label is "Українська", so
        // the open list has to size to its own content or it truncates the
        // names it exists to show.
        menuToContent={compact}
        onChange={(code) => i18n.changeLanguage(code)}
        options={LANGUAGES.map((l) => ({
          value: l.code,
          label: l.label,
          // The nav slot fits a code, not a language name — but the OPEN list
          // still shows the full name, which is the half that has to be
          // readable by someone who cannot read the current interface.
          triggerLabel: compact ? l.short : undefined,
          sublabel: compact ? undefined : l.short,
          icon: (
            <img
              src={l.flag}
              alt=""
              aria-hidden="true"
              width={compact ? 20 : 24}
              height={compact ? 20 : 24}
              // Not lazy: four 2KB images inside a control the user has just
              // opened, where a placeholder frame would be the whole row.
              className={`${compact ? 'size-5' : 'size-6'} shrink-0 rounded-full`}
            />
          ),
        }))}
      />
    </div>
  );
}
