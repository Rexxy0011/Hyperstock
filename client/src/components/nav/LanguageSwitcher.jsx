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
        onChange={(code) => i18n.changeLanguage(code)}
        options={LANGUAGES.map((l) => ({
          value: l.code,
          label: l.label,
          // The nav slot fits a code, not a language name — but the OPEN list
          // still shows the full name, which is the half that has to be
          // readable by someone who cannot read the current interface.
          triggerLabel: compact ? l.short : undefined,
          sublabel: compact ? undefined : l.short,
          icon: compact ? null : (
            <span
              aria-hidden="true"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-mist text-2xs font-bold text-text-muted"
            >
              {l.short.slice(0, 2)}
            </span>
          ),
        }))}
      />
    </div>
  );
}
