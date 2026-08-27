import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { del, post, put } from '../../lib/api';
import { money, pct } from '../../lib/format';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import BestPositionField from './BestPositionField';
import { useRankPreview } from '../../hooks/useRankPreview';
import notify from '../../lib/toast';

/**
 * Editing what one trader shows on the leaderboard.
 *
 * IT WRITES A CURATED ROW, NOT THE ACCOUNT. Everything typed here lands in
 * `FeaturedTrader` keyed to this user, which replaces their computed row on the
 * board and changes nothing else — their cash, positions, ledger and their own
 * portfolio screen are untouched. That separation is the entire design: an
 * operator who could edit a real balance from a table row is an operator who
 * can mint money by typo, and there would be no ledger entry to explain it.
 *
 * THE FIGURE RE-RANKS, IT DOES NOT PIN. `mergeFeatured` sorts this row against
 * the live board on the value that was typed, so a big enough number puts the
 * trader among the top and a small one drops them down the table — exactly like
 * every other row. The preview below says where it will land BEFORE saving,
 * because "type a number and find out" is a poor way to run a public board.
 *
 * @param {object} props
 * @param {Record<string, any>|null} props.trader the row from /admin/users, or
 *   null. Loosely typed: it is a JSON payload, and pinning its shape here would
 *   be a second declaration of one the server already owns.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function TraderOverrideModal({ trader, open, onClose }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const computed = trader?.computed ?? null;
  const override = trader?.override ?? null;

  const [form, setForm] = useState(blank);

  /**
   * PRE-FILLED FROM THE OVERRIDE IF THERE IS ONE, OTHERWISE FROM REALITY.
   *
   * An empty form would make every edit a fresh invention and lose the thing an
   * operator most needs — what this trader actually shows today. Seeding from
   * the computed row means the common case is nudging a real figure rather than
   * composing one, and the diff line below can say what changed.
   *
   * Keyed on the trader's id so reopening on a different row refills, and
   * `open` so reopening the SAME row discards an abandoned edit rather than
   * resuming it half-typed.
   */
  useEffect(() => {
    if (!open || !trader) return;
    const source = override ?? {
      portfolioValueCents: computed?.portfolioValueCents ?? 0,
      changePct: computed?.returnPct ?? 0,
      trades: computed?.trades ?? trader.tradeCount ?? 0,
      bestSymbol: computed?.best?.symbol ?? '',
      bestReturnPct: computed?.best?.returnPct ?? 0,
      avatarUrl: '',
    };
    setForm({
      // Dollars in the form, cents on the wire — the conversion happens once,
      // in the route's `dollarsToCents`, like every other money field here.
      value: (source.portfolioValueCents / 100).toFixed(2),
      changePct: String(source.changePct ?? 0),
      trades: String(source.trades ?? 0),
      bestSymbol: source.bestSymbol ?? '',
      bestReturnPct: String(source.bestReturnPct ?? 0),
      avatarUrl: source.avatarUrl ?? '',
    });
  }, [open, trader?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Both shared with the featured-trader editor — see the hook and the field.
  const { rank: previewRank } = useRankPreview(form.value, {
    userId: trader?.id,
    enabled: open,
  });

  /**
   * Picking a HELD position copies its real return across, so the two figures
   * start out consistent and the common case needs no second edit. An unheld
   * symbol has no measured return, so the field is left alone rather than
   * zeroed — a zero would render on the board as a real figure that happened to
   * be flat. It stays editable either way: this is a curated row.
   */
  const pickPosition = (symbol, returnPct) =>
    setForm((f) => ({
      ...f,
      bestSymbol: symbol,
      bestReturnPct: returnPct != null ? String(returnPct) : f.bestReturnPct,
    }));

  const save = useMutation({
    mutationFn: () =>
      put(`/admin/users/${trader.id}/override`, {
        portfolioValueCents: form.value,
        changePct: form.changePct,
        trades: form.trades,
        bestSymbol: form.bestSymbol,
        bestReturnPct: form.bestReturnPct,
        avatarUrl: form.avatarUrl,
      }),
    onSuccess: () => {
      // Both: the table shows the override badge, and the board the operator is
      // about to go and look at must not still be the pre-edit one.
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'rank-preview'] });
      notify.success(t('admin.override.saved'));
      onClose();
    },
    onError: (err) => notify.apiError(err),
  });

  const reset = useMutation({
    mutationFn: () => del(`/admin/users/${trader.id}/override`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'rank-preview'] });
      notify.success(t('admin.override.reset'));
      onClose();
    },
    onError: (err) => notify.apiError(err),
  });

  /**
   * Uploading a portrait.
   *
   * THE BYTES GO STRAIGHT UP AS THE REQUEST BODY, no `FormData` and no
   * multipart. There is one file and no accompanying fields, which is the case
   * multipart exists to solve and this is not — so the server needs no `multer`
   * and this needs no boundary handling.
   *
   * It uploads IMMEDIATELY rather than holding the file until Save, because the
   * response is what supplies the URL the form field stores. The upload is
   * content-addressed and harmless on its own: an image nobody saves is an
   * orphan row, not a changed leaderboard.
   */
  const upload = useMutation({
    /** @param {File} file — annotated, or `useMutation` infers the variable as `void`. */
    mutationFn: (file) =>
      post('/admin/media', file, { headers: { 'Content-Type': file.type } }),
    onSuccess: (result) => setForm((f) => ({ ...f, avatarUrl: result.url })),
    onError: (err) => notify.apiError(err),
  });

  const onFile = (e) => {
    const file = e.target.files?.[0];
    // Resetting the input is what makes re-picking the SAME file fire `change`
    // again — without it, removing a picture and choosing it once more is a
    // control that silently does nothing.
    e.target.value = '';
    if (file) upload.mutate(file);
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const busy = save.isPending || reset.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.override.title', { name: trader?.displayName || trader?.username || '' })}
      footer={
        <div className="flex w-full items-center gap-3">
          {/* Only offered when there is something to undo. A reset button on a
              trader who has never been edited claims a state that does not
              exist and would report "removed" for a no-op. */}
          {override && (
            <button
              type="button"
              disabled={busy}
              onClick={() => reset.mutate()}
              className="cursor-pointer text-sm font-medium text-loss underline underline-offset-2 disabled:opacity-45"
            >
              {t('admin.override.resetAction')}
            </button>
          )}
          <div className="ml-auto flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {t('admin.override.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* WHAT IS ACTUALLY TRUE, kept on screen while the figures are edited.
            Without it the operator is typing over a number they can no longer
            see, and the only way back to it is to cancel. */}
        <div className="rounded-md border border-cool-grey bg-mist px-3 py-2.5">
          <div className="text-2xs text-text-muted">{t('admin.override.actual')}</div>
          {computed ? (
            <div className="font-numeric text-sm tabular-nums">
              {money(computed.portfolioValueCents)} · {pct(computed.returnPct)}
            </div>
          ) : (
            <div className="text-sm text-text-muted">{t('admin.override.notRanked')}</div>
          )}
        </div>

        {/* THE PICTURE. `Avatar` is the preview as well as the renderer, so
            what is shown here is exactly what the board will show — including
            the generated mark when there is no portrait, which is what makes
            "remove" legible as a state rather than as an empty box. */}
        <div className="flex items-center gap-4">
          <Avatar
            name={trader?.displayName || trader?.username || ''}
            src={form.avatarUrl || undefined}
            size={56}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex gap-3">
              {/* A label styled as a button, because a file input cannot be
                  restyled and its native "Choose file / No file chosen" is the
                  one control on this dialog that would not look like the rest
                  of the product. */}
              <label
                className={`cursor-pointer text-sm font-medium text-void underline underline-offset-2 ${
                  upload.isPending ? 'opacity-45' : ''
                }`}
              >
                {upload.isPending
                  ? t('admin.override.uploading')
                  : t(form.avatarUrl ? 'admin.override.replacePhoto' : 'admin.override.addPhoto')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onFile}
                  disabled={upload.isPending}
                  className="hidden"
                />
              </label>

              {form.avatarUrl && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, avatarUrl: '' }))}
                  className="cursor-pointer text-sm font-medium text-loss underline underline-offset-2"
                >
                  {t('admin.override.removePhoto')}
                </button>
              )}
            </div>
            <span className="text-2xs text-text-muted">{t('admin.override.photoHint')}</span>
          </div>
        </div>

        <Input
          label={t('admin.override.value')}
          type="number"
          step="0.01"
          min="0"
          value={form.value}
          onChange={set('value')}
          hint={
            previewRank
              ? t('admin.override.willRank', { rank: previewRank })
              : t('admin.override.valueHint')
          }
        />

        <Input
          label={t('admin.override.changePct')}
          type="number"
          step="0.01"
          value={form.changePct}
          onChange={set('changePct')}
          // The cash figure beside a percentage is DERIVED on the server, never
          // typed — two independently entered numbers on one row is exactly how
          // a value and its own percentage come to disagree.
          hint={t('admin.override.changeHint')}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('admin.override.trades')}
            type="number"
            min="0"
            value={form.trades}
            onChange={set('trades')}
          />

          <BestPositionField
            userId={trader?.id}
            value={form.bestSymbol}
            onChange={pickPosition}
            enabled={open}
          />
        </div>

        <Input
          label={t('admin.override.bestReturn')}
          type="number"
          step="0.01"
          value={form.bestReturnPct}
          onChange={set('bestReturnPct')}
        />

        <p className="m-0 text-xs text-text-muted">{t('admin.override.note')}</p>
      </div>
    </Modal>
  );
}

const blank = {
  value: '0.00',
  changePct: '0',
  trades: '0',
  bestSymbol: '',
  bestReturnPct: '0',
  avatarUrl: '',
};
