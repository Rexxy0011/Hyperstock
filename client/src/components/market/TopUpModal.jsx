import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { money } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Link from '../ui/Link';

/**
 * Adding virtual capital.
 *
 * TWO OUTCOMES, and the modal has to say which one happened. Requests at or
 * below the server's instant limit land immediately; larger ones queue for
 * review. Reporting only "submitted" would leave the user staring at a balance
 * that did not move, which is indistinguishable from a failure.
 *
 * The limits come from `/wallet/limits` rather than being written here — they
 * are `env` values on the server and a hard-coded copy would drift out of step
 * with the rule actually being enforced.
 *
 * It opens over the trade ticket as well as from the portfolio. Both are native
 * `<dialog>` elements opened with `showModal()`, so the second one stacks in the
 * top layer above the first without any z-index arrangement here.
 */

/** Round amounts, so the common case is one tap rather than typing. */
const PRESETS = [500, 1_000, 2_500];

export default function TopUpModal({
  open,
  onClose,
  onFunded = undefined,
  /**
   * What the caller thinks is needed — the trade ticket passes the shortfall on
   * the buy it could not afford. Opening on $500 when the user has just been
   * told they are $1,240 short makes them do arithmetic the screen already did.
   */
  suggestCents = 0,
}) {
  const { patchUser } = useAuth();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('500');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  /** One key per OPENING, not per attempt — the same rule as an order ticket. */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { data: limits } = useQuery({
    queryKey: ['wallet', 'limits'],
    queryFn: () => get('/wallet/limits'),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!open) return;
    setAmount(suggestCents > 0 ? String(Math.round(suggestCents) / 100) : '500');
    setError(null);
    setResult(null);
    setIdempotencyKey(crypto.randomUUID());
  }, [open, suggestCents]);

  const dollars = Number.parseFloat(amount);
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
  const maxCents = limits?.maxCents ?? 500_000;
  const instantCents = limits?.instantLimitCents ?? 100_000;

  const problem = !Number.isFinite(amountCents)
    ? 'Enter an amount.'
    : amountCents < 100
      ? 'The minimum is $1.00.'
      : amountCents > maxCents
        ? `The most you can request at once is ${money(maxCents)}.`
        : null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await post('/wallet/topups', { amountCents, idempotencyKey });
      // The balance pill reads from the auth user, so patch it rather than
      // waiting for a refetch — the point of this modal is that the number
      // changes.
      patchUser({ cashBalanceCents: res.cashBalanceCents });
      setResult(res);
      queryClient.invalidateQueries({ queryKey: keys.portfolio });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      if (res.credited) onFunded?.(res.cashBalanceCents);
    } catch (err) {
      setError(err.message ?? 'Could not add funds.');
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={result.credited ? 'Funds added' : 'Request submitted'}
        footer={
          <Button variant="secondary" onClick={onClose} className="w-full">
            Done
          </Button>
        }
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex size-9 items-center justify-center rounded-full ${
              result.credited ? 'bg-green-tint text-gain' : 'bg-mist text-text-muted'
            }`}
          >
            {result.credited ? '✓' : '⏳'}
          </span>
          <div>
            <div className="text-md font-bold">
              {result.credited ? money(result.request.amountCents) : 'Awaiting review'}
            </div>
            <div className="text-xs text-text-muted">
              {result.credited
                ? `Buying power is now ${money(result.cashBalanceCents)}.`
                : (result.message ??
                  'A reviewer has to approve this before the funds land.')}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add funds"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p className="m-0 rounded-md bg-red-tint px-3 py-2 text-xs text-loss">{error}</p>
          )}
          <Button
            onClick={submit}
            loading={pending}
            disabled={Boolean(problem)}
            className="w-full"
          >
            {Number.isFinite(amountCents) && !problem
              ? `Add ${money(amountCents)}`
              : 'Add funds'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(String(p))}
            className={`cursor-pointer rounded-md border px-3 py-1.5 font-numeric text-sm tabular-nums transition-colors ${
              Number(amount) === p
                ? 'border-gain bg-green-tint text-gain'
                : 'border-cool-grey text-text-body hover:bg-mist'
            }`}
          >
            {money(p * 100)}
          </button>
        ))}
      </div>

      <label className="mt-5 block text-xs text-text-muted" htmlFor="topup-amount">
        Amount (USD)
      </label>
      <input
        id="topup-amount"
        type="number"
        min="1"
        step="1"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-cool-grey bg-white px-3 py-2.5 font-numeric text-md tabular-nums transition-colors focus:border-gain focus:outline-none"
      />

      {problem && <p className="mt-3 mb-0 text-xs text-loss">{problem}</p>}

      <p className="mt-4 mb-0 text-2xs text-text-muted">
        {/* Stated BEFORE submitting, not after. Finding out that an amount
            needed review only once the balance failed to move is the thing this
            sentence exists to prevent. */}
        Up to {money(instantCents)} is added straight away. Anything larger, to a
        maximum of {money(maxCents)}, is reviewed first. This is virtual capital -
        no real money is involved.
      </p>

      {/*
        THE TWO FUNDING PATHS ARE NAMED DIFFERENTLY ON PURPOSE.
        This one grants simulated capital instantly. `/fund` is the deposit
        flow — a real payment, a reference, a reviewer, a ledger entry. Putting
        both behind one "Add funds" button would leave the user unable to tell
        which kind of money they just received, which is the one thing a funding
        screen must never be ambiguous about.
      */}
      <p className="mt-3 mb-0 text-2xs text-text-muted">
        Funding with a real deposit instead?{' '}
        <Link to="/fund" className="text-gain underline underline-offset-2">
          Deposit crypto
        </Link>
      </p>
    </Modal>
  );
}
