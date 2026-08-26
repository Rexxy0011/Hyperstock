import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { assets } from '../assets/assets';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiArrowLeft, FiCopy, FiCheck, FiInfo } from 'react-icons/fi';
import Link from '../components/ui/Link';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Select from '../components/ui/Select';
import CoinIcon from '../components/market/CoinIcon';
import { get, post } from '../lib/api';
import { keys } from '../lib/queryClient';
import { decodeTrade, safeReturnPath } from '../lib/tradeIntent';
import { errorMessage } from '../lib/apiError';
import { money, priceUsd, dateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';

/**
 * Funding, driven entirely by the deposit's own status.
 *
 * THE DATABASE IS THE STATE AND THIS IS A VIEW OF IT. A deposit is created
 * before any address is shown, so closing the tab, losing the connection or
 * coming back tomorrow loses nothing — `/fund/DEP-2026-8F92K1` renders whatever
 * the row says now. There is no wizard state held in React, and nothing here
 * needs to survive a refresh, because nothing here is the truth.
 *
 * Every screen below is a function of `deposit.status`, which is why the
 * component is a switch rather than a sequence of steps.
 */

/**
 * Status → badge tone. The COPY moved to the bundles under `fund.status.*`;
 * what stays is the mapping, which is structure and the same in every language.
 */
const STATUS_TONE = {
  awaiting_payment: 'amber',
  payment_detected: 'amber',
  under_review: 'amber',
  approved: 'approved',
  rejected: 'declined',
  expired: 'neutral',
  cancelled: 'neutral',
};

/**
 * The exact quantity, at the asset's own precision.
 *
 * `toFixed` and not a locale format: this number is meant to be COPIED INTO A
 * WALLET, and a thousands separator makes it unpasteable. Trailing zeros are
 * kept for the same reason — "1000.304000" is what the chain will carry, and
 * matching on the exact string is the whole point of quoting one.
 */
const assetAmount = (deposit) =>
  Number(deposit.assetAmount ?? 0).toFixed(deposit.assetDecimals ?? 8);

/**
 * What the QR should encode.
 *
 * BIP-21 for Bitcoin, because it is a real standard and wallets will fill in
 * the amount from it. Everything else gets the BARE ADDRESS: there is no
 * universal URI scheme for TRC20 or ERC20 tokens, and inventing one produces a
 * QR that some wallets silently fail to parse — worse than one that only
 * carries the address, which every wallet handles.
 */
function paymentUri(deposit) {
  if (deposit.network === 'BITCOIN') {
    return `bitcoin:${deposit.destinationAddress}?amount=${assetAmount(deposit)}`;
  }
  return deposit.destinationAddress;
}

export default function Fund() {
  const { t } = useTranslation();
  const { reference } = useParams();
  const [params] = useSearchParams();

  /**
   * ARRIVED FROM AN ORDER THAT COULD NOT AFFORD ITSELF.
   *
   * `back` carries the route AND the ticket to reopen, so funding stops being a
   * detour the user has to find their own way home from. Validated as a
   * same-origin path — it comes from the query string, and this is the one
   * screen where a user is most primed to trust where it sends them next.
   */
  const backTo = params.get('back') ? safeReturnPath(params.get('back')) : null;
  const needCents = Number(params.get('need')) || 0;
  const resuming = decodeTrade(new URLSearchParams((backTo ?? '').split('?')[1]).get('trade'));

  return (
    <div className="w-full px-4 py-8 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mx-auto max-w-160">
        <Link
          to={backTo ?? '/portfolio'}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted no-underline transition-colors hover:text-text-body"
        >
          <FiArrowLeft size={14} aria-hidden="true" />
          {resuming
            ? t('fund.backToYourOrder', { symbol: resuming.symbol })
            : t('withdraw.backToPortfolio')}
        </Link>

        {resuming && <ResumeBanner trade={resuming} needCents={needCents} backTo={backTo} />}

        {reference ? (
          <DepositDetail reference={reference} backTo={backTo} resuming={resuming} />
        ) : (
          <StartDeposit needCents={needCents} backTo={backTo} />
        )}
      </div>
    </div>
  );
}

/**
 * The order waiting on the other side of this screen.
 *
 * It is a banner rather than a line of text because the whole point of the trip
 * is that the user is mid-task: they came here to solve one problem and the
 * screen has to keep saying which, or funding becomes its own errand and the
 * order is quietly abandoned. It states the gap and the way back, and both stay
 * on screen through every step of the deposit.
 */
function ResumeBanner({ trade, needCents, backTo }) {
  const { t } = useTranslation();
  return (
    <section className="animate-rise mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cool-grey bg-mist px-4 py-3">
      <p className="m-0 text-2xs text-text-body">
        {t('fund.fundingToBuy')}{' '}
        <span className="font-numeric font-semibold tabular-nums">{trade.quantity}</span>{' '}
        <span className="font-mono font-semibold">{trade.symbol}</span>
        {needCents > 0 && (
          <>
            {' '}
            - <span className="font-numeric tabular-nums">{money(needCents)}</span>{' '}
            {t('fund.short')}
          </>
        )}
      </p>
      <Button size="sm" variant="secondary" to={backTo}>
        {t('fund.backToOrder')}
      </Button>
    </section>
  );
}

/* --------------------------------------------------------------- starting */

function StartDeposit({ needCents = 0, backTo = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: methods } = useQuery({
    queryKey: ['deposits', 'methods'],
    queryFn: () => get('/deposits/methods'),
    staleTime: 300_000,
  });

  // Only the deposits still worth continuing. A finished one belongs in the
  // statement, not on the screen that starts a new one.
  const { data: mine } = useQuery({
    queryKey: ['deposits', 'mine'],
    queryFn: () => get('/deposits'),
  });

  const open = (mine?.items ?? []).filter((d) =>
    ['awaiting_payment', 'payment_detected', 'under_review'].includes(d.status),
  );
  /**
   * CAPPED, because abandoning a deposit is normal.
   *
   * Anyone who opens the form and thinks better of it leaves a row behind, and
   * an uncapped list of them pushes the thing they came here to do off the
   * bottom of the screen — measured at nine, which is not a hard number to
   * reach. The newest few are the ones anybody is coming back for; the rest are
   * still reachable, just not in the way.
   */
  const [showAllOpen, setShowAllOpen] = useState(false);
  const visibleOpen = showAllOpen ? open : open.slice(0, 3);

  const [assetSymbol, setAssetSymbol] = useState('');
  const [networkKey, setNetworkKey] = useState('');
  /**
   * Prefilled from the shortfall when there is one, so the user is not asked to
   * work out their own gap to the cent on a screen that already knows it.
   */
  const [amount, setAmount] = useState(() =>
    needCents > 0 ? String(Math.ceil(needCents / 100)) : '1000',
  );
  const [error, setError] = useState(null);

  const assets = methods?.crypto?.assets ?? [];
  const asset = assets.find((a) => a.symbol === assetSymbol) ?? null;

  /**
   * The network list is derived from the chosen asset, not held separately.
   * Deriving it means a stale network can never survive an asset change — the
   * lookup below simply stops matching, and the second dropdown falls back to
   * its placeholder rather than silently keeping TRC20 selected under Solana.
   */
  const destination =
    asset?.networks.find((n) => `${n.asset}:${n.network}` === networkKey) ?? null;

  const create = useMutation({
    /** @param {{method:string, asset:string, network:string, amountCents:number, idempotencyKey:string}} body */
    mutationFn: (body) => post('/deposits', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      // The order that sent the user here has to survive this hop too, or the
      // payment screen is where the round trip quietly ends.
      const carry = backTo ? `?need=${needCents}&back=${encodeURIComponent(backTo)}` : '';
      navigate(`/fund/${res.deposit.reference}${carry}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const dollars = Number.parseFloat(amount);
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
  const cryptoAvailable = methods?.crypto?.available;

  return (
    <>
      <h1 className="m-0 text-xl font-bold text-void">{t('fund.title')}</h1>

      {open.length > 0 && (
        <section className="animate-rise mt-6 overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
          <h2 className="m-0 border-b border-cool-grey px-5 py-3.5 text-md font-bold text-void">
            {t('fund.pending')}
          </h2>
          {/* THE REASON A DEPOSIT IS A ROW AND NOT A WIZARD. Anything unfinished
              is here waiting, whatever happened to the tab it was started in. */}
          <ul className="m-0 list-none divide-y divide-cool-grey/70 p-0">
            {visibleOpen.map((d) => (
              <li key={d.reference}>
                <Link
                  to={`/fund/${d.reference}`}
                  className="flex items-center gap-3 px-5 py-4 no-underline transition-colors hover:bg-hover/50"
                >
                  <CoinIcon symbol={d.asset} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-semibold text-void">
                      {money(d.amountCents)} {d.asset}
                    </span>
                    <span className="block truncate text-2xs text-text-muted">
                      {d.network} · {d.reference} · {dateTime(d.createdAt)}
                    </span>
                  </span>
                  <Badge variant={STATUS_TONE[d.status] ?? 'neutral'}>
                    {t(`fund.status.${d.status}`, { defaultValue: d.status })}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>

          {open.length > visibleOpen.length && (
            <button
              type="button"
              onClick={() => setShowAllOpen(true)}
              className="w-full cursor-pointer border-0 border-t border-cool-grey bg-transparent px-5 py-3 text-left text-xs text-text-muted transition-colors hover:bg-hover/50 hover:text-text-body"
            >
              Show {open.length - visibleOpen.length} more
            </button>
          )}
        </section>
      )}

      <section className="animate-rise mt-6 rounded-xl border border-cool-grey bg-white p-5 shadow-card">
        <h2 className="mt-0 mb-1 text-md font-bold text-void">{t('fund.onChain')}</h2>
        <p className="mt-0 mb-5 text-xs text-text-muted">
          {t('fund.onChainLead')}
        </p>

        {!cryptoAvailable ? (
          /**
           * NO DESTINATION CONFIGURED, so there is nothing to ask for. Showing
           * the form with a blank address, or a placeholder one, is how somebody
           * sends real funds nowhere.
           */
          <div className="rounded-lg border border-cool-grey bg-mist px-4 py-4">
            <div className="text-sm font-semibold text-void">{t('fund.notEnabled')}</div>
            <p className="mt-1 mb-0 text-xs text-text-muted">
              No deposit destination is configured on this deployment, so no address can be
              issued. An operator has to set <code className="font-mono">DEPOSIT_DESTINATIONS</code>{' '}
              before this method can be used.
            </p>
          </div>
        ) : (
          <>
            <label className="block text-xs text-text-muted" htmlFor="fund-asset">
              {t('fund.chooseCrypto')}
            </label>
            <Select
              id="fund-asset"
              className="mt-1.5"
              value={assetSymbol}
              placeholder={t('fund.selectAsset')}
              onChange={(v) => {
                setAssetSymbol(v);
                // Cleared, never carried over: the networks under Solana are
                // not the networks under Tether.
                setNetworkKey('');
                setError(null);
              }}
              options={assets.map((a) => ({
                value: a.symbol,
                label: a.symbol,
                sublabel: a.name,
                icon: <CoinIcon symbol={a.symbol} logoUrl={a.logoUrl} />,
              }))}
            />

            <label className="mt-4 block text-xs text-text-muted" htmlFor="fund-network">
              {t('fund.chooseNetwork')}
            </label>
            <Select
              id="fund-network"
              className="mt-1.5"
              value={networkKey}
              disabled={!asset}
              placeholder={asset ? t('fund.chooseNetwork') : t('fund.chooseAssetFirst')}
              onChange={(v) => {
                setNetworkKey(v);
                setError(null);
              }}
              options={(asset?.networks ?? []).map((n) => ({
                value: `${n.asset}:${n.network}`,
                label: n.label,
                // The real ticker rides on the row when it differs from the
                // asset chosen — picking "Bitcoin" then BEP20 means sending
                // BTCB, and that has to be visible in the choice itself.
                sublabel: [
                  n.differsFromGroup ? `You send ${n.asset}` : null,
                  n.minAmountCents > 0 ? `Minimum ${money(n.minAmountCents)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                icon: <CoinIcon network={n.network} logoUrl={n.logoUrl} />,
              }))}
            />

            {/* Shown when CHOOSING as well as when paying: the moment to learn
                that BTCB is not Bitcoin is before the address is on screen. */}
            {destination?.note && (
              <p className="mt-3 mb-0 flex items-start gap-2.5 rounded-lg bg-amber-tint px-3 py-2.5 text-2xs text-amber">
                <FiInfo size={14} className="mt-px shrink-0" aria-hidden="true" />
                <span>{destination.note}</span>
              </p>
            )}

            <label className="mt-4 block text-xs text-text-muted" htmlFor="fund-amount">
              {t('fund.amount')}
            </label>
            <input
              id="fund-amount"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-cool-grey bg-white px-3 py-2.5 font-numeric text-md tabular-nums transition-colors focus:border-gain focus:outline-none"
            />

            {error && <p className="mt-3 mb-0 text-xs text-loss">{error}</p>}

            <Button
              className="mt-5 w-full"
              loading={create.isPending}
              disabled={!destination || !Number.isFinite(amountCents) || amountCents < 100}
              onClick={() => {
                setError(null);
                create.mutate({
                  method: 'crypto',
                  asset: destination.asset,
                  network: destination.network,
                  amountCents,
                  idempotencyKey: crypto.randomUUID(),
                });
              }}
            >
              {t('common.continue')}
            </Button>
          </>
        )}
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- detail */

/**
 * The three states a submission moves through, and they are REAL ONES.
 *
 * The server takes the deposit `awaiting_payment -> payment_detected ->
 * under_review` on this one call, so the sequence below narrates something that
 * actually happens rather than counting down for effect. That distinction
 * matters on a funding screen: a bar labelled "verifying on-chain" would be an
 * outright lie, because nothing here reads the chain — a human does, later.
 *
 * The dwell exists because the transition is otherwise instant, and an instant
 * jump from a form to "Under review" reads as though the click did nothing.
 */
const SUBMIT_STEPS = [
  { label: 'Recording your transaction', detail: 'Saving the hash against this deposit.' },
  { label: 'Payment reported', detail: 'Your transaction reference is attached.' },
  { label: 'Queued for review', detail: 'A reviewer will verify it against the network.' },
];
const STEP_MS = 2000;

function DepositDetail({ reference, backTo = null, resuming = null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [txHash, setTxHash] = useState('');
  /**
   * PRE-FILLED FROM THE ACCOUNT, not left blank.
   *
   * The address is nearly always the one already on file, so asking someone to
   * type it again is friction for its own sake — and a field people have to
   * fill is a field people leave empty, which defeats the point of asking. It
   * stays editable because the person paying is not always the person who
   * signed up.
   */
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');
  const [error, setError] = useState(null);
  /** null when idle; otherwise the index into SUBMIT_STEPS being shown. */
  const [step, setStep] = useState(null);

  const { data: deposit, isPending } = useQuery({
    queryKey: ['deposits', reference],
    queryFn: () => get(`/deposits/${reference}`),
    // Under review the answer changes without this tab doing anything, so it
    // polls; a settled deposit does not.
    refetchInterval: (q) =>
      ['approved', 'rejected', 'expired', 'cancelled'].includes(q.state.data?.status)
        ? false
        : 15_000,
  });

  const submit = useMutation({
    mutationFn: () =>
      post(`/deposits/${reference}/submit`, {
        txHash: txHash.trim(),
        contactEmail: contactEmail.trim(),
      }),
    onSuccess: () => {
      // Refetched immediately, behind the overlay, so the screen revealed at
      // the end is already the new one rather than the old one mid-update.
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setStep(0);
    },
    onError: (err) => {
      setStep(null);
      setError(errorMessage(err));
    },
  });

  // Advances the narration, then clears itself. One timer at a time, cleaned up
  // on unmount — a stray timer here would set state on a dead component.
  useEffect(() => {
    if (step === null) return;
    const id = setTimeout(
      () => setStep((i) => (i === null || i >= SUBMIT_STEPS.length - 1 ? null : i + 1)),
      STEP_MS,
    );
    return () => clearTimeout(id);
  }, [step]);

  /**
   * THE MONEY LANDS HERE, SO THE BALANCE HAS TO BE REFETCHED HERE.
   *
   * Approval happens on a reviewer's screen, not this one — the poll above is
   * how this tab finds out. Without this it found out and told nobody: the card
   * flipped to "Approved" while `keys.portfolio` sat on its cached answer, and
   * that one query feeds the nav's balance pill, the Buying power card and the
   * trade ticket's affordability check. The user would be looking at a credited
   * deposit and an uncredited balance on the same screen, with the ticket still
   * refusing an order it could now fill.
   *
   * `refetchOnWindowFocus` is off globally and `staleTime` is 10s, so nothing
   * else was going to correct it — on any page without a poll of its own it
   * would stay wrong until a reload.
   *
   * The ref makes it fire on the TRANSITION rather than on every poll of an
   * already-approved deposit, which would refetch three queries every 15s for
   * as long as the tab stayed open.
   */
  const credited = useRef(false);
  useEffect(() => {
    if (deposit?.status !== 'approved' || credited.current) return;
    credited.current = true;
    queryClient.invalidateQueries({ queryKey: keys.portfolio });
    queryClient.invalidateQueries({ queryKey: keys.wallet });
    // Cash counts toward portfolio value, so the board moved too.
    queryClient.invalidateQueries({ queryKey: keys.leaderboard('all') });
  }, [deposit?.status, queryClient]);

  const cancel = useMutation({
    mutationFn: () => post(`/deposits/${reference}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deposits'] }),
  });

  if (isPending) return <DetailSkeleton />;
  if (!deposit) return <p className="text-sm text-text-muted">{t('fund.noSuchDeposit')}</p>;

  // Covers the card entirely while the sequence runs, so the form underneath
  // cannot be edited or resubmitted mid-flight.
  if (step !== null) return <SubmitProgress step={step} deposit={deposit} />;

  const tone = STATUS_TONE[deposit.status] ?? 'neutral';
  const title = /** @type {string} */ (
    t(`fund.status.${deposit.status}`, { defaultValue: deposit.status })
  );
  const body = /** @type {string} */ (
    t(`fund.status.${deposit.status}Body`, { defaultValue: '' })
  );
  const awaiting = deposit.status === 'awaiting_payment';

  return (
    <section className="animate-rise overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
      <Steps status={deposit.status} />

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-cool-grey px-5 py-4">
        <div className="flex items-start gap-3">
          <CoinIcon symbol={deposit.asset} size={36} />
          <div>
            <h1 className="m-0 text-md font-bold text-void">{title}</h1>
            <p className="mt-1 mb-0 text-xs text-text-muted">{body}</p>
          </div>
        </div>
        <Badge variant={tone}>{title}</Badge>
      </header>

      {/*
        THE END OF THE ROUND TRIP.

        The money is in and the order that sent the user here is still unplaced,
        so this is the moment to hand them back to it — one press, ticket
        reopened, same quantity. Only on `approved`: offering it earlier would
        send them back to a ticket that still cannot afford itself, which is the
        dead end this whole flow exists to remove.
      */}
      {deposit.status === 'approved' && resuming && backTo && (
        <div className="border-b border-cool-grey px-5 py-4">
          <Button to={backTo} className="w-full">
            {t('fund.backToBuy', { quantity: resuming.quantity, symbol: resuming.symbol })}
          </Button>
        </div>
      )}

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm">
        <Row label={t('fund.creditOnApproval')} value={money(deposit.amountCents)} strong />
        <Row label={t('fund.asset')} value={deposit.asset} />
        <Row label={t('fund.network')} value={deposit.network} />
        <Row label={t('fund.reference')} value={deposit.reference} mono />
        <Row label={t('fund.opened')} value={dateTime(deposit.createdAt)} />
      </dl>

      {awaiting && (
        <div className="border-t border-cool-grey px-5 py-5">
          {/* THE AMOUNT TO SEND IS IN THE ASSET, NOT IN DOLLARS. The chain has
              no idea what $1,000 is, and the reviewer matches on the quantity —
              so that is the number given top billing, on its own surface, with
              the USD figure it was struck from underneath it. */}
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-mist px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-2xs tracking-wide text-text-muted uppercase">{t('fund.sendExactly')}</div>
              <div className="mt-1 font-numeric text-xl font-medium tabular-nums text-void">
                {assetAmount(deposit)} <span className="text-text-muted">{deposit.asset}</span>
              </div>
              <div className="mt-1 text-2xs text-text-muted">
                {/* priceUsd, not money: the rate is $0.999695 and rounding it
                    to "$1.00" removes the only thing that explains why the
                    quantity above is 1000.305094 rather than 1000. */}
                ≈ {money(deposit.amountCents)} at {priceUsd(deposit.rateUsdNanos)} per{' '}
                {deposit.asset}
              </div>
            </div>
            <Countdown expiresAt={deposit.expiresAt} />
          </div>

          {/*
            ABOVE THE ADDRESS, and AMBER RATHER THAN RED.
            It still has to be read before anything is copied — a user who
            sends on the wrong network does not get the money back. But red is
            the colour this app uses for a loss and a rejection, and borrowing
            it for a routine "check your wallet" step tells somebody about to
            deposit that something has already gone wrong. Amber is the
            caution channel; the sentence carries the weight, not the colour.
          */}
          {deposit.networkNote && (
            <p className="mt-4 mb-0 flex items-start gap-2.5 rounded-lg bg-amber-tint px-4 py-3 text-2xs text-amber">
              <FiInfo size={14} className="mt-px shrink-0" aria-hidden="true" />
              <span>{deposit.networkNote}</span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-start gap-5">
            <PaymentQr deposit={deposit} />
            <div className="min-w-56 flex-1">
              {/* No mark here. The deposit payload carries no network logo, so
                  Tron would fall back to "TRC" initials while every other chain
                  showed a vector — one inconsistent row is worse than none, and
                  the label already names the network. */}
              <div className="mb-1.5 text-xs text-text-muted">
                To this {deposit.network} address
              </div>
              <CopyField value={deposit.destinationAddress} />
              <div className="mt-3 mb-1.5 text-xs text-text-muted">{t('fund.exactAmount')}</div>
              <CopyField value={assetAmount(deposit)} />
            </div>
          </div>

          {/*
            AN ACTUAL FIELD, NOT A SENTENCE ABOUT EMAILING SOMEONE.
            The old block told the user to compose a mail to support with their
            reference in it if the amount did not match — which is a task, done
            later, from another application, by somebody who has just been told
            their money is in limbo. Capturing the address here means the
            reviewer can start that conversation instead, and it is attached to
            the deposit rather than to whatever inbox the mail landed in.
          */}
          <label className="mt-5 block text-xs text-text-muted" htmlFor="fund-email">
            {t('fund.email')}
          </label>
          <input
            id="fund-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={t('fund.emailPlaceholder')}
            className="mt-1.5 w-full rounded-lg border border-cool-grey bg-white px-3 py-2.5 text-sm transition-colors focus:border-gain focus:outline-none"
          />
          <p className="mt-1.5 mb-0 text-2xs text-text-muted">
            {t('fund.emailHint')}
          </p>

          <label className="mt-4 block text-xs text-text-muted" htmlFor="fund-hash">
            {t('fund.txHash')}
          </label>
          <input
            id="fund-hash"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            placeholder="0x…"
            className="mt-1.5 w-full rounded-lg border border-cool-grey bg-white px-3 py-2.5 font-mono text-sm transition-colors focus:border-gain focus:outline-none"
          />
          <p className="mt-1.5 mb-0 text-2xs text-text-muted">
            {t('fund.sentNote')}
          </p>
          {error && <p className="mt-2 mb-0 text-xs text-loss">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={submit.isPending}
              disabled={txHash.trim().length < 10}
              onClick={() => {
                setError(null);
                submit.mutate();
              }}
            >
              {t('fund.sentFunds')}
            </Button>
            <Button variant="secondary" onClick={() => cancel.mutate()}>
              {t('fund.cancelDeposit')}
            </Button>
          </div>
        </div>
      )}

      {deposit.status === 'under_review' && (
        <div className="border-t border-cool-grey px-5 py-6 text-center">
          <Hourglass size={40} />
          <p className="mx-auto mt-3 mb-0 max-w-80 text-xs text-text-muted">
            Nothing more to do. This page updates on its own once a reviewer has checked the
            payment.
          </p>
        </div>
      )}

      {deposit.txHash && (
        <dl className="m-0 grid grid-cols-1 gap-y-3 border-t border-cool-grey px-5 py-4 text-sm">
          <Row label={t('fund.transaction')} value={deposit.txHash} mono />
        </dl>
      )}

      {deposit.status === 'rejected' && (
        <div className="border-t border-cool-grey px-5 py-4">
          {deposit.rejectionReason && (
            <p className="m-0 text-xs text-loss">{deposit.rejectionReason}</p>
          )}
          {/* The one place a support address still belongs. A rejection is a
              dead end otherwise: the money moved, the deposit did not, and the
              screen would offer no way to argue with that. */}
          <SupportLine deposit={deposit} />
        </div>
      )}

      {/* The audit trail, shown to the user and not only to an administrator —
          it is their money and every state change is on the record. */}
      {deposit.history?.length > 0 && (
        <ol className="m-0 list-none border-t border-cool-grey px-5 py-4 text-2xs text-text-muted">
          {deposit.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-4 py-0.5">
              <span>{String(h.to).replace(/_/g, ' ')}</span>
              {/* A timestamp is figures, not a code — and this is a stacked
                  list where they read down the right edge, so it wants the
                  tabular set rather than the mono face. */}
              <span className="font-numeric tabular-nums">{dateTime(h.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The hourglass that holds, turns, holds — see the keyframes in theme.css.
 *
 * The project's own artwork rather than an icon-font glyph: it is the same
 * flat-illustration family as the Security section's marks, so a screen that
 * suddenly showed a thin line icon would read as belonging to a different app.
 * Decorative, so `alt=""` — every one of these sits beside text that already
 * says what is happening.
 */
function Hourglass({ size = 28 }) {
  return (
    <img
      src={assets.icons.hourglass}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="animate-hourglass inline-block"
    />
  );
}

/**
 * The submission narration. Covers the card while the deposit moves through the
 * states the server has already put it in.
 */
function SubmitProgress({ step, deposit }) {
  return (
    <section
      className="animate-rise rounded-xl border border-cool-grey bg-white px-6 py-10 text-center shadow-card"
      role="status"
      aria-live="polite"
    >
      <Hourglass size={44} />

      <h1 className="mt-4 mb-1 text-md font-bold text-void">{SUBMIT_STEPS[step].label}</h1>
      <p className="mx-auto mt-0 mb-6 max-w-80 text-xs text-text-muted">
        {SUBMIT_STEPS[step].detail}
      </p>

      {/* A bar per step rather than one filling bar: the steps are discrete
          states, and a continuous bar would imply a measured percentage that
          nothing here actually knows. */}
      <div className="mx-auto flex max-w-60 gap-1.5">
        {SUBMIT_STEPS.map((s, i) => (
          <span
            key={s.label}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              i <= step ? 'bg-gain' : 'bg-cool-grey'
            }`}
          />
        ))}
      </div>

      <p className="mt-6 mb-0 font-mono text-2xs text-text-muted">{deposit.reference}</p>
    </section>
  );
}

/**
 * Where this deposit is, as a rail across the top of the card.
 *
 * The state machine has eight states but a person only cares about three
 * phases, so the terminals collapse into the last one. It is the cheapest way
 * to answer "is it me or them I am waiting on", which is the question somebody
 * on this screen actually has.
 */
const PHASES = ['Payment', 'Review', 'Complete'];

function phaseIndex(status) {
  if (status === 'awaiting_payment') return 0;
  if (status === 'payment_detected' || status === 'under_review') return 1;
  return 2;
}

function Steps({ status }) {
  const current = phaseIndex(status);
  const failed = ['rejected', 'expired', 'cancelled'].includes(status);

  return (
    <ol className="m-0 flex list-none items-center gap-2 border-b border-cool-grey bg-mist/60 px-5 py-3">
      {PHASES.map((label, i) => {
        const done = i < current;
        const active = i === current;
        // A failed deposit reaches the last phase without succeeding, so the
        // marker has to be able to say "ended here" rather than "completed".
        const tone = failed && active ? 'bg-loss' : done || active ? 'bg-gain' : 'bg-cool-grey';

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
            <span
              className={`text-2xs whitespace-nowrap ${
                active ? 'font-semibold text-void' : 'text-text-muted'
              }`}
            >
              {label}
            </span>
            {i < PHASES.length - 1 && (
              <span
                className={`h-px flex-1 ${done ? 'bg-gain/40' : 'bg-cool-grey'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DetailSkeleton() {
  return (
    <div className="rounded-xl border border-cool-grey bg-white p-5 shadow-card" aria-hidden="true">
      <div className="h-4 w-40 animate-pulse rounded bg-hover" />
      <div className="mt-5 h-20 animate-pulse rounded-lg bg-hover" />
      <div className="mt-4 flex gap-5">
        <div className="size-40 animate-pulse rounded-lg bg-hover" />
        <div className="flex-1 space-y-3">
          <div className="h-10 animate-pulse rounded bg-hover" />
          <div className="h-10 animate-pulse rounded bg-hover" />
        </div>
      </div>
    </div>
  );
}


function Countdown({ expiresAt }) {
  const queryClient = useQueryClient();
  const target = expiresAt ? new Date(expiresAt).getTime() : 0;
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));
  const firedRef = useRef(false);

  useEffect(() => {
    if (!target) return;
    // A ticker rather than a setTimeout chain: an interval that fires late — a
    // backgrounded tab, a sleeping laptop — still reads the real clock, so the
    // display cannot drift away from the actual deadline.
    const id = setInterval(() => setLeft(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(id);
  }, [target]);

  useEffect(() => {
    if (left > 0 || !target || firedRef.current) return;
    firedRef.current = true;
    queryClient.invalidateQueries({ queryKey: ['deposits'] });
  }, [left, target, queryClient]);

  if (!target) return null;

  const total = Math.floor(left / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  const urgent = left > 0 && left < 5 * 60_000;

  return (
    <div className="text-right">
      <div className="text-xs text-text-muted">
        {left > 0 ? 'Quote expires in' : 'Quote expired'}
      </div>
      <div
        className={`mt-1 font-numeric text-xl font-medium tabular-nums ${
          left === 0 ? 'text-text-muted' : urgent ? 'text-loss' : 'text-void'
        }`}
        // Announced only as it becomes urgent — a live region counting every
        // second would make the page unusable with a screen reader.
        aria-live={urgent ? 'polite' : 'off'}
      >
        {mm}:{ss}
      </div>
    </div>
  );
}

/**
 * The address as a QR, generated in the browser.
 *
 * Client-side because the address is already here — a round trip to render an
 * image of a string this page is holding would be a request for nothing. It is
 * drawn to a data URL rather than a canvas so it survives a re-render without
 * being redrawn, and it carries the address as its `alt` so the information is
 * not lost when images are off or the encoder fails.
 */
function PaymentQr({ deposit }) {
  const [src, setSrc] = useState(null);
  const uri = useMemo(() => paymentUri(deposit), [deposit]);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(uri, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((url) => alive && setSrc(url))
      // A failed encode must not take the payment screen with it: the address
      // is right there in copyable text either way.
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [uri]);

  if (!src) {
    return (
      <div
        className="size-40 shrink-0 rounded-lg border border-cool-grey bg-mist"
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={src}
      alt={`QR code for ${deposit.destinationAddress}`}
      width={160}
      height={160}
      className="size-40 shrink-0 rounded-lg border border-cool-grey bg-white p-1.5"
    />
  );
}

/** A mailto with the reference already in it — the one thing people forget. */
function SupportLine({ deposit }) {
  const { data: methods } = useQuery({
    queryKey: ['deposits', 'methods'],
    queryFn: () => get('/deposits/methods'),
    staleTime: 300_000,
  });

  const email = methods?.supportEmail;
  if (!email) return null;

  const subject = encodeURIComponent(`Deposit ${deposit.reference}`);
  const body = encodeURIComponent(
    `Reference: ${deposit.reference}\nAmount: ${assetAmount(deposit)} ${deposit.asset} (${deposit.network})\nTransaction hash: ${deposit.txHash ?? ''}\n\n`,
  );

  return (
    <p className="mt-2 mb-0 text-2xs text-text-muted">
      Think this is wrong?{' '}
      <a href={`mailto:${email}?subject=${subject}&body=${body}`} className="text-gain">
        Email {email}
      </a>{' '}
      - your reference and transaction are filled in for you.
    </p>
  );
}

function Row({ label, value, strong = false, mono = false }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd
        className={`m-0 truncate text-right ${mono ? 'font-mono text-xs' : ''} ${
          strong ? 'font-semibold text-text-body' : ''
        }`}
      >
        {value}
      </dd>
    </>
  );
}

function CopyField({ value }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-cool-grey bg-mist px-3 py-2.5 font-mono text-xs text-text-body">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={t('fund.copyAddress')}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-cool-grey px-3 text-xs font-medium text-text-body transition-colors hover:bg-mist"
      >
        {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
        {copied ? t('fund.copied') : t('fund.copyAddress')}
      </button>
    </div>
  );
}
