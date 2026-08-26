import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { errorMessage } from '../lib/apiError';
import notify from '../lib/toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge, { statusVariant } from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Money from '../components/market/Money';
import CopyField from '../components/ui/CopyField';

/**
 * The approvals dashboard — deposits, withdrawals and top-ups in one queue.
 *
 * All three APIs existed long before this screen and each was individually a
 * dead end without it: a `under_review` deposit, a `requested` withdrawal and a
 * `Pending` top-up could all be created and none could ever be resolved. The
 * endpoints are unchanged; what was missing was the operator.
 *
 * ONE SCREEN, THREE TABS, because it is one job. An operator opens this to
 * answer "is there anything waiting on me", and that question does not decompose
 * into three separate visits — hence the counts on the tabs, which come from one
 * `/admin/queues` call rather than three listings measured with `.length`.
 *
 * THE THREE QUEUES ARE NOT THE SAME SHAPE, and the differences are the whole
 * reason this is not a generic table:
 *
 *   - a deposit CREDITS an account, so the row has to name it;
 *   - a withdrawal SENDS money that cannot be recalled, so it must be claimed
 *     first, needs a transaction hash to approve, and the destination address is
 *     the single most important thing on the panel;
 *   - a top-up is virtual capital and needs neither.
 */

const TABS = /** @type {const} */ ([
  { key: 'deposits', countKey: 'deposits' },
  { key: 'withdrawals', countKey: 'withdrawals' },
  { key: 'topups', countKey: 'topups' },
]);

/**
 * The status each tab opens on — what is WAITING ON AN OPERATOR, which is not
 * the same as "unfinished". An `awaiting_payment` deposit is waiting on the
 * depositor and putting it here would pad the queue with rows nobody can act on.
 */
const DEFAULT_STATUS = {
  deposits: 'under_review',
  withdrawals: 'requested',
  topups: 'Pending',
};

const STATUS_OPTIONS = {
  deposits: ['under_review', 'payment_detected', 'awaiting_payment', 'approved', 'rejected', 'all'],
  withdrawals: ['requested', 'under_review', 'approved', 'rejected', 'cancelled', 'all'],
  topups: ['Pending', 'Approved', 'Declined', 'all'],
};

const LIST_URL = {
  deposits: (s) => `/admin/deposits?status=${s}`,
  withdrawals: (s) => `/admin/withdrawals?status=${s}`,
  // The top-up queue predates the /admin prefix and lives under the wallet.
  topups: (s) => `/wallet/admin/topups${s === 'all' ? '' : `?status=${s}`}`,
};

export default function Approvals() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState('deposits');
  const [status, setStatus] = useState(DEFAULT_STATUS.deposits);
  const [action, setAction] = useState(/** @type {any} */ (null));
  const [open, setOpen] = useState(false);

  const { data: counts } = useQuery({
    queryKey: ['admin', 'queues'],
    queryFn: () => get('/admin/queues'),
    refetchInterval: 30_000,
  });

  /**
   * Tells an operator with this screen open that work ARRIVED, rather than
   * leaving them to notice a badge tick up in their peripheral vision.
   *
   * ON THE INCREASE ONLY, and seeded silently on the first reading — the same
   * rule `MarketNotices` follows. A toast fired on the current total would greet
   * every visit with "13 requests waiting", which is the state of the queue and
   * not news; and a fall is the operator's own approval landing, which already
   * has its own confirmation.
   */
  const lastTotal = useRef(/** @type {number | null} */ (null));
  useEffect(() => {
    const total = counts?.total;
    if (typeof total !== 'number') return;
    const prev = lastTotal.current;
    lastTotal.current = total;
    if (prev === null || total <= prev) return;
    notify.info(t('notices.queueArrived', { count: total - prev }), { id: 'admin-queue' });
  }, [counts?.total, t]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'queue', tab, status],
    queryFn: () => get(LIST_URL[tab](status)),
  });

  const rows = data?.items ?? [];

  const switchTab = (next) => {
    setTab(next);
    setStatus(DEFAULT_STATUS[next]);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'queue'] });
    qc.invalidateQueries({ queryKey: ['admin', 'queues'] });
    // Approving either kind moves cash, so anything showing a balance is stale.
    qc.invalidateQueries({ queryKey: ['portfolio'] });
    qc.invalidateQueries({ queryKey: ['leaderboard'] });
  };

  const start = (row, kind) => {
    setAction({ row, kind, tab });
    setOpen(true);
  };

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-6">
        <h1 className="m-0 text-xl font-bold">{t('admin.approvals.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">{t('admin.approvals.intro')}</p>
      </div>

      {/* Tabs carry their own outstanding count, so the answer to "is there
          anything waiting" is visible without opening each one. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((tb) => {
          const n = counts?.[tb.countKey] ?? 0;
          const on = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => switchTab(tb.key)}
              aria-current={on ? 'true' : undefined}
              className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors ${
                on
                  ? 'border-transparent bg-ink text-text-on-deep'
                  : 'border-cool-grey bg-white text-text-body hover:bg-mist'
              }`}
            >
              {t(`admin.approvals.tab.${tb.key}`)}
              {n > 0 && (
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 font-numeric text-2xs font-semibold tabular-nums ${
                    on ? 'bg-white/15 text-text-on-deep' : 'bg-loss text-white'
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted">{t('admin.approvals.filter')}</span>
        {STATUS_OPTIONS[tab].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              status === s
                ? 'border-void bg-void text-white'
                : 'border-cool-grey bg-white text-text-muted hover:bg-mist'
            }`}
          >
            {t(`admin.approvals.status.${s}`, { defaultValue: s })}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-cool-grey bg-white shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['trader', 'reference', 'amount', 'detail', 'created', 'status'].map((k) => (
                <th key={k} className={th}>
                  {t(`admin.approvals.col.${k}`)}
                </th>
              ))}
              <th className={`${th} text-right`}>{t('admin.approvals.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className={td} colSpan={7}>
                  <span className="block h-4 w-40 animate-pulse rounded-sm bg-mist" />
                </td>
              </tr>
            )}
            {!isLoading && !rows.length && (
              <tr>
                <td className={`${td} py-10 text-center text-text-muted`} colSpan={7}>
                  {t('admin.approvals.empty')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <QueueRow key={r.id} row={r} tab={tab} onAction={start} />
            ))}
          </tbody>
        </table>
      </div>

      <ReviewModal open={open} action={action} onClose={() => setOpen(false)} onDone={invalidate} />
    </div>
  );
}

const th =
  'border-b border-cool-grey px-4 py-2.5 text-left text-xs font-medium text-text-muted whitespace-nowrap';
const td = 'border-b border-cool-grey px-4 py-3 text-sm align-top';

/* --------------------------------------------------------------------- rows */

function QueueRow({ row, tab, onAction }) {
  const { t } = useTranslation();
  const trader = row.trader;

  return (
    <tr>
      <td className={td}>
        {/* A queue that does not say whose money it is cannot be worked, and
            approving a deposit credits this exact account. */}
        {trader ? (
          <>
            <div className="font-medium">{trader.displayName}</div>
            <div className="text-2xs text-text-muted">{trader.email}</div>
          </>
        ) : (
          <span className="text-text-muted">-</span>
        )}
      </td>

      <td className={`${td} font-mono text-xs`}>{row.reference ?? row.id.slice(-8)}</td>

      <td className={td}>
        <Money value={row.amountCents} size={14} className="font-medium" />
        {row.assetAmount != null && (
          <div className="font-mono text-2xs text-text-muted">
            {row.assetAmount} {row.asset}
          </div>
        )}
      </td>

      <td className={`${td} max-w-70`}>
        <Detail row={row} tab={tab} />
      </td>

      <td className={`${td} whitespace-nowrap text-xs text-text-muted`}>
        {new Date(row.createdAt).toLocaleString()}
      </td>

      <td className={td}>
        <Badge variant={statusVariant(row.status)}>
          {t(`admin.approvals.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      </td>

      <td className={`${td} text-right whitespace-nowrap`}>
        <Actions row={row} tab={tab} onAction={onAction} />
      </td>
    </tr>
  );
}

function Detail({ row, tab }) {
  const { t } = useTranslation();

  if (tab === 'topups') {
    return row.reason ? (
      <span className="text-xs text-text-muted">{row.reason}</span>
    ) : (
      <span className="text-text-muted">-</span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 text-xs text-text-muted">
      <span>{row.network}</span>
      {/* The address is what an operator actually sends to, so it is on the row
          rather than one click away. Broken to fit without forcing the table
          wider than the viewport. */}
      {tab === 'withdrawals' && row.destinationAddress && (
        <CopyField value={row.destinationAddress} label={t('admin.approvals.sendTo')} />
      )}
      {tab === 'deposits' && row.txHash && (
        <span className="font-mono break-all">{row.txHash}</span>
      )}
      {row.contactEmail && <span>{row.contactEmail}</span>}
      {row.rejectionReason && (
        <span className="text-loss">
          {t('admin.approvals.reason')}: {row.rejectionReason}
        </span>
      )}
    </div>
  );
}

function Actions({ row, tab, onAction }) {
  const { t } = useTranslation();

  if (tab === 'topups') {
    if (row.status !== 'Pending') return <span className="text-2xs text-text-muted">-</span>;
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'approve')}>
          {t('admin.approvals.approve')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'decline')}>
          {t('admin.approvals.decline')}
        </Button>
      </>
    );
  }

  if (tab === 'deposits') {
    if (row.status !== 'under_review') return <span className="text-2xs text-text-muted">-</span>;
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'approve')}>
          {t('admin.approvals.approve')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'reject')}>
          {t('admin.approvals.reject')}
        </Button>
      </>
    );
  }

  /**
   * CLAIM BEFORE CONFIRM. `requested` offers only Claim, because the service's
   * compare-and-set on that transition is what stops two operators working the
   * same row from both sending the funds. Offering Approve here would put the
   * button in front of a call that is going to be refused.
   */
  if (row.status === 'requested') {
    return (
      <Button variant="ghost" size="sm" onClick={() => onAction(row, 'claim')}>
        {t('admin.approvals.claim')}
      </Button>
    );
  }
  if (row.status === 'under_review') {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'approve')}>
          {t('admin.approvals.markSent')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAction(row, 'reject')}>
          {t('admin.approvals.reject')}
        </Button>
      </>
    );
  }
  return <span className="text-2xs text-text-muted">-</span>;
}

/* -------------------------------------------------------------------- modal */

/** Which endpoint each (tab, action) pair posts to, and what it needs. */
function endpointFor({ tab, row, kind }) {
  if (tab === 'topups') {
    return { url: `/wallet/admin/topups/${row.id}`, body: (f) => ({ approve: kind === 'approve', note: f.note }) };
  }
  const base = tab === 'deposits' ? '/admin/deposits' : '/admin/withdrawals';
  const ref = row.reference;

  if (kind === 'claim') return { url: `${base}/${ref}/claim`, body: () => ({}) };
  if (kind === 'reject') return { url: `${base}/${ref}/reject`, body: (f) => ({ reason: f.reason }) };
  return {
    url: `${base}/${ref}/approve`,
    // A withdrawal approval requires evidence a transfer happened; a deposit
    // approval does not, because the hash is already on the row.
    body: (f) => (tab === 'withdrawals' ? { txHash: f.txHash, note: f.note } : { note: f.note }),
  };
}

function ReviewModal({ open, action, onClose, onDone }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ note: '', reason: '', txHash: '' });
  const [error, setError] = useState('');

  const kind = action?.kind;
  const tab = action?.tab;
  const row = action?.row;

  const needsReason = kind === 'reject' || kind === 'decline';
  const needsHash = kind === 'approve' && tab === 'withdrawals';

  const run = useMutation({
    mutationFn: async () => {
      const { url, body } = endpointFor({ tab, row, kind });
      return post(url, body(form));
    },
    onSuccess: () => {
      onDone();
      onClose();
      setForm({ note: '', reason: '', txHash: '' });
      /**
       * The confirmation names what actually happened, because the three
       * outcomes are not interchangeable: approving a deposit or a top-up MOVES
       * MONEY into an account, while approving a payout only records that an
       * operator sent it by hand. "Saved" for all three would flatten the one
       * distinction an operator most needs to keep straight.
       */
      const key =
        kind === 'approve' && tab === 'withdrawals'
          ? 'toast.payoutApproved'
          : `toast.${kind === 'approve' ? 'approved' : kind === 'claim' ? 'claimed' : kind === 'decline' ? 'declined' : 'rejected'}`;
      notify.t(key);
    },
    onError: (err) => setError(errorMessage(err)),
    // Inline in the dialog, which stays open on failure so the input survives.
    meta: { silent: true },
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    run.mutate();
  };

  const valid = (!needsReason || form.reason.trim()) && (!needsHash || form.txHash.trim().length >= 10);

  return (
    <Modal open={open} onClose={onClose} title={t(`admin.approvals.confirm.${kind ?? 'approve'}`)}>
      {row && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Restated inside the dialog: the row that was clicked scrolls out of
              view behind it, and this is the last screen before money moves. */}
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-mist px-3 py-2.5 text-sm">
            <dt className="text-text-muted">{t('admin.approvals.col.trader')}</dt>
            <dd className="m-0 font-medium">{row.trader?.displayName ?? '-'}</dd>
            <dt className="text-text-muted">{t('admin.approvals.col.amount')}</dt>
            <dd className="m-0">
              <Money value={row.amountCents} size={14} />
              {row.assetAmount != null && (
                <span className="ml-2 font-mono text-2xs text-text-muted">
                  {row.assetAmount} {row.asset}
                </span>
              )}
            </dd>
            {row.destinationAddress && (
              <>
                <dt className="text-text-muted">{t('admin.approvals.sendTo')}</dt>
                {/* COPYABLE, because this is the string that has to reach a
                    wallet by hand. Re-typing 42 characters of base58, or
                    dragging a selection across a `break-all` wrap and hoping it
                    took the whole thing, are both how money goes to the wrong
                    address. */}
                <dd className="m-0">
                  <CopyField value={row.destinationAddress} label={t('admin.approvals.sendTo')} />
                </dd>
              </>
            )}
          </dl>

          {needsHash && (
            <Input
              label={t('admin.approvals.txHash')}
              hint={t('admin.approvals.txHashHint')}
              value={form.txHash}
              onChange={(e) => setForm((f) => ({ ...f, txHash: e.target.value }))}
              required
            />
          )}

          {needsReason ? (
            <Input
              label={t('admin.approvals.reason')}
              as="textarea"
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              hint={t('admin.approvals.reasonHint')}
              required
            />
          ) : (
            <Input
              label={t('admin.approvals.note')}
              as="textarea"
              rows={2}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          )}

          {error && (
            <p role="alert" className="m-0 text-sm text-loss">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={needsReason ? 'outline-red' : 'primary'}
              disabled={!valid || run.isPending}
            >
              {run.isPending ? t('common.submitting') : t(`admin.approvals.${kind ?? 'approve'}`)}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
