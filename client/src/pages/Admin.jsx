import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../lib/api';
import { errorMessage } from '../lib/apiError';
import notify from '../lib/toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import BestPositionField from '../components/admin/BestPositionField';
import { useRankPreview } from '../hooks/useRankPreview';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Money from '../components/market/Money';
import PriceChange from '../components/market/PriceChange';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * Curated leaderboard rows — the first admin screen in the product.
 *
 * WHAT IT DOES NOT DO. It moves no money and writes no ledger entry. A row here
 * changes what a leaderboard row DISPLAYS; the account it may be attached to
 * keeps its real cash, positions and portfolio page untouched.
 *
 * The figure is the lever. A curated row is ranked against the live board on
 * the value typed into it rather than pinned to the top, so the preview beside
 * the form shows where it would actually land — a number that reads as large in
 * isolation can still sit mid-table, and finding that out after publishing is
 * the wrong time.
 */

const EMPTY = {
  name: '',
  userId: null,
  portfolioValue: '',
  changePct: '',
  trades: '',
  bestSymbol: '',
  bestReturnPct: '',
  active: true,
};

export default function Admin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'featured'],
    queryFn: () => get('/admin/featured-traders'),
  });

  const rows = data?.items ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'featured'] });
    // Every period shares the curated rows, so all three tabs go stale at once.
    qc.invalidateQueries({ queryKey: ['leaderboard'] });
  };

  const remove = useMutation({
    /** @param {string} id */
    mutationFn: (id) => del(`/admin/featured-traders/${id}`),
    onSuccess: () => {
      invalidate();
      // A row vanishing from a table is ambiguous — a filter could have done it.
      notify.t('toast.featuredRemoved');
    },
  });

  const startNew = () => {
    setEditing({ ...EMPTY });
    setOpen(true);
  };

  const startEdit = (row) => {
    setEditing({
      id: row._id,
      name: row.name,
      userId: row.userId ? String(row.userId) : null,
      // Cents are the transport unit; the form edits dollars, and the server
      // converts back at its own boundary.
      portfolioValue: (row.portfolioValueCents / 100).toFixed(2),
      changePct: String(row.changePct),
      trades: String(row.trades ?? 0),
      bestSymbol: row.bestSymbol ?? '',
      bestReturnPct: String(row.bestReturnPct ?? 0),
      active: row.active,
    });
    setOpen(true);
  };

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-bold">{t('admin.featured.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            {t('admin.featured.intro')}
          </p>
        </div>
        <Button onClick={startNew}>{t('admin.featured.add')}</Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['trader', 'value', 'change', 'trades', 'status'].map((k) => (
                <th key={k} className={th}>
                  {t(`admin.featured.col.${k}`)}
                </th>
              ))}
              <th className={`${th} text-right`}>{t('admin.featured.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className={td} colSpan={6}>
                  <span className="block h-4 w-40 animate-pulse rounded-sm bg-mist" />
                </td>
              </tr>
            )}

            {!isLoading && !rows.length && (
              <tr>
                <td className={`${td} py-10 text-center text-text-muted`} colSpan={6}>
                  {t('admin.featured.empty')}
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r._id}>
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex size-7 items-center justify-center rounded-md border border-cool-grey bg-mist text-2xs font-semibold">
                      {r.name[0]?.toUpperCase()}
                    </span>
                    <span className="font-medium">{r.name}</span>
                    {/* An override behaves differently from a standalone row —
                        it replaces an account — so the list has to say which. */}
                    {r.userId && <Badge variant="neutral">{t('admin.featured.override')}</Badge>}
                  </div>
                </td>
                <td className={`${td} font-numeric tabular-nums`}>
                  <Money value={r.portfolioValueCents} size={14} />
                </td>
                <td className={td}>
                  <PriceChange value={r.changePct} size={12} pill />
                </td>
                <td className={`${td} font-numeric tabular-nums text-text-muted`}>
                  {(r.trades ?? 0).toLocaleString('en-US')}
                </td>
                <td className={td}>
                  <Badge variant={r.active ? 'approved' : 'neutral'}>
                    {t(r.active ? 'admin.featured.live' : 'admin.featured.paused')}
                  </Badge>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(r._id)}
                    disabled={remove.isPending}
                  >
                    {t('common.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kept mounted so the dialog can animate out — unmounting on close skips
          the exit transition entirely, the lesson the trade ticket taught. */}
      <FeaturedForm
        open={open}
        draft={editing}
        onClose={() => setOpen(false)}
        onSaved={invalidate}
      />
    </div>
  );
}

const th =
  'border-b border-cool-grey px-4 py-2.5 text-left text-xs font-medium text-text-muted whitespace-nowrap';
const td = 'border-b border-cool-grey px-4 py-3 text-sm';

/* ------------------------------------------------------------------- the form */

function FeaturedForm({ open, draft, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  // The draft is the source of truth on open; local state only exists so typing
  // does not round-trip through the query cache.
  useEffect(() => {
    if (draft) setForm(draft);
    setError('');
  }, [draft]);

  const set = (k) => (e) => {
    const v = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = useMutation({
    /** @param {Record<string, any>} body */
    mutationFn: (body) =>
      form.id ? patch(`/admin/featured-traders/${form.id}`, body) : post('/admin/featured-traders', body),
    onSuccess: () => {
      onSaved();
      onClose();
      notify.t('toast.featuredSaved');
    },
    // Inline, beside the form that produced it — and `silent` so the global
    // handler does not say the same sentence again in the corner.
    onError: (err) => setError(errorMessage(err)),
    meta: { silent: true },
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    save.mutate({
      name: form.name.trim(),
      userId: form.userId || null,
      portfolioValueCents: form.portfolioValue,
      changePct: Number(form.changePct || 0),
      trades: Number(form.trades || 0),
      bestSymbol: form.bestSymbol.trim(),
      bestReturnPct: Number(form.bestReturnPct || 0),
      active: form.active,
    });
  };

  /**
   * Where this figure would actually land.
   *
   * IT COUNTED FIVE ROWS. `board` is `/leaderboard?limit=5`, so every figure
   * below fifth place reported rank 6 — a plausible number, which is why it
   * went unnoticed. Answered by the server now, against the whole board, and
   * shared with the user editor so the two screens cannot disagree about where
   * the same value lands.
   */
  const placement = useRankPreview(form.portfolioValue, {
    userId: form.userId || undefined,
    enabled: open,
  });

  /**
   * A HELD symbol carries a measured return, so it is copied across and the two
   * figures start out consistent. An unheld one has none — the field is left
   * alone rather than zeroed, since a zero renders on the board as a real
   * figure that happened to be flat. Editable either way: the percentage is the
   * thing the operator is here to set.
   */
  const pickPosition = (symbol, returnPct) =>
    setForm((f) => ({
      ...f,
      bestSymbol: symbol,
      bestReturnPct: returnPct != null ? String(returnPct) : f.bestReturnPct,
    }));

  const valid = form.name.trim() && Number(form.portfolioValue) > 0;

  return (
    <Modal open={open} onClose={onClose} title={t(form.id ? 'admin.featured.edit' : 'admin.featured.add')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TraderPicker
          value={form.userId}
          name={form.name}
          onPick={(hit) =>
            setForm((f) => ({
              ...f,
              userId: hit?.userId ?? null,
              // Picking an account prefills the name, and it stays editable —
              // the stored copy is what renders, so a later rename of the
              // account cannot rewrite a row composed by hand.
              name: hit ? hit.displayName : f.name,
            }))
          }
        />

        <Input
          label={t('admin.featured.name')}
          value={form.name}
          onChange={set('name')}
          maxLength={60}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('admin.featured.value')}
            value={form.portfolioValue}
            onChange={set('portfolioValue')}
            inputMode="decimal"
            placeholder="184250.00"
            hint={t('admin.featured.valueHint')}
            required
          />
          <Input
            label={t('admin.featured.changePct')}
            value={form.changePct}
            onChange={set('changePct')}
            inputMode="decimal"
            placeholder="12.4"
            hint={t('admin.featured.changeHint')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label={t('admin.featured.trades')}
            value={form.trades}
            onChange={set('trades')}
            inputMode="numeric"
            placeholder="312"
          />
          {/* THE SAME CONTROL /soap/users USES, not a second one that looks
              like it. It follows `form.userId`, so linking this row to an
              account makes that account's holdings lead the list with its best
              performer first; a standalone row has no holdings and simply gets
              the available half. */}
          <BestPositionField
            userId={form.userId || undefined}
            value={form.bestSymbol}
            onChange={pickPosition}
            enabled={open}
          />
          <Input
            label={t('admin.featured.bestReturn')}
            value={form.bestReturnPct}
            onChange={set('bestReturnPct')}
            inputMode="decimal"
            placeholder="61.2"
          />
        </div>

        {placement.rank && (
          <p className="m-0 rounded-md bg-mist px-3 py-2 text-xs text-text-muted">
            {placement.leads
              ? t('admin.featured.wouldLead')
              : t('admin.featured.wouldRank', {
                  rank: placement.rank,
                  total: placement.totalTraders,
                })}
          </p>
        )}

        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={set('active')}
            className="size-4 accent-gain"
          />
          {t('admin.featured.activeLabel')}
        </label>

        {error && (
          <p role="alert" className="m-0 text-sm text-loss">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ account picker */

/**
 * Optional. Left empty the row stands alone; pick an account and the row
 * REPLACES that account on the board rather than sitting beside it.
 *
 * Debounced, because it fires per keystroke against a collection that is 200
 * rows today and unbounded later — the same 300ms the markets search uses.
 */
function TraderPicker({ value, name, onPick }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 300);

  const { data } = useQuery({
    queryKey: ['admin', 'traders', debounced],
    queryFn: () => get(`/admin/traders?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length > 0,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-cool-grey bg-mist px-3 py-2.5">
        <span className="min-w-0 text-sm">
          <span className="block text-2xs text-text-muted">{t('admin.featured.overriding')}</span>
          <span className="block truncate font-medium">{name}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onPick(null)}>
          {t('common.clear')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        label={t('admin.featured.link')}
        hint={t('admin.featured.linkHint')}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('admin.featured.linkPlaceholder')}
      />
      {!!data?.items?.length && (
        <ul className="mt-1.5 max-h-40 list-none overflow-y-auto rounded-md border border-cool-grey p-1">
          {data.items.map((hit) => (
            <li key={hit.userId}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setTerm('');
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-mist"
              >
                <span className="font-medium">{hit.displayName}</span>
                <span className="font-mono text-2xs text-text-muted">{hit.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
