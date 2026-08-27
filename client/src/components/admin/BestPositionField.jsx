import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { pct } from '../../lib/format';
import Select from '../ui/Select';

/**
 * The Best-position picker, shared by both curation editors.
 *
 * ONE COMPONENT RATHER THAN THE SAME LIST TWICE. `/soap/users` edits a real
 * trader's row and `/soap/featured-traders` composes one from nothing, but the
 * question the control answers is identical in both — and the moment it exists
 * twice the two drift, which on this control means one screen offering symbols
 * the other refuses. Same rule `lib/toast.js` follows for durations.
 *
 * IT IS A DROPDOWN, NEVER A TEXT BOX. "Best position" names an instrument, and
 * free text lets an operator publish one the platform does not list — or a
 * typo, which renders on a public board as a ticker that does not exist beside
 * a return nothing can be checked against.
 *
 * TWO GROUPS, AND THEY MUST STAY DISTINGUISHABLE:
 *
 * - What the account HOLDS, sorted by return with the best performer first and
 *   labelled as such. "Best position" means best PERFORMING; the server sorts
 *   this group rather than reusing `getPortfolio`'s value order, because the
 *   largest holding is routinely not the best one.
 * - Everything else the platform lists, carrying NO return. An unheld symbol
 *   has no measured performance for this row, and printing a figure for one
 *   would put an invention in the same shape as a measurement.
 *
 * `userId` IS OPTIONAL. A standalone curated row belongs to nobody and simply
 * has no holdings, so it gets the available list and an empty held group.
 *
 * @param {object} props
 * @param {string=} props.userId account whose holdings lead the list
 * @param {string} props.value the selected symbol, '' for none
 * @param {(symbol: string, returnPct: number|null) => void} props.onChange
 *   `returnPct` is the holding's real return, or null when the symbol is not
 *   held — the caller decides whether to copy it into its own return field.
 * @param {boolean=} props.enabled false while the dialog is closed, so a table
 *   of rows does not fetch a list nobody has opened
 */
export default function BestPositionField({ userId, value, onChange, enabled = true }) {
  const { t } = useTranslation();
  const id = useId();

  const { data } = useQuery({
    queryKey: ['admin', 'positions', userId ?? ''],
    queryFn: () => get(`/admin/positions${userId ? `?userId=${userId}` : ''}`),
    enabled,
    staleTime: 60_000,
    // It has its own empty state, and a toast about a dropdown nobody is
    // looking at is a notification about something the user was not doing.
    meta: { silent: true },
  });

  /**
   * Memoised so the `?? []` fallback is not a new array identity every render,
   * which would rebuild the options below on every keystroke elsewhere in the
   * form.
   */
  const held = useMemo(() => data?.held ?? [], [data]);
  const available = useMemo(() => data?.available ?? [], [data]);

  const options = useMemo(() => {
    const opts = [
      { value: '', label: t('admin.override.bestNone') },

      ...held.map((p, i) => ({
        value: p.symbol,
        label: p.symbol,
        sublabel:
          i === 0
            ? `${p.name} · ${pct(p.returnPct)} · ${t('admin.override.bestPerformer')}`
            : `${p.name} · ${pct(p.returnPct)}`,
      })),

      ...available.map((p) => ({
        value: p.symbol,
        label: p.symbol,
        sublabel: `${p.name} · ${t('admin.override.notHeld')}`,
      })),
    ];

    /**
     * A STORED SYMBOL THE LIST NO LONGER CARRIES STAYS ON IT. `Select` renders
     * a blank trigger for a value it has no option for, so a delisted or closed
     * position would read as "None" and be erased by the next save — the same
     * reason `listWatchlist` returns rows it can no longer resolve rather than
     * dropping them.
     */
    if (value && !opts.some((o) => o.value === value)) {
      opts.push({ value, label: value, sublabel: t('admin.override.bestNotHeld') });
    }
    return opts;
  }, [held, available, value, t]);

  const choose = (symbol) => {
    const hit = [...held, ...available].find((p) => p.symbol === symbol);
    onChange(symbol, hit?.returnPct ?? null);
  };

  return (
    /* The label is a SIBLING with `htmlFor`, never a wrapper. A `<label>` around
       a custom listbox forwards a click on an option back to the trigger, which
       sets the value and then immediately reopens the list — the payout form's
       exact bug. */
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-text-body">
        {t('admin.override.bestSymbol')}
      </label>
      <Select
        id={id}
        value={value}
        onChange={choose}
        options={options}
        placeholder={t('admin.override.bestNone')}
      />
      <span className="text-2xs text-text-muted">
        {held.length
          ? t('admin.override.bestHint', { count: held.length })
          : t('admin.override.availableOnly', { count: available.length })}
      </span>
    </div>
  );
}
