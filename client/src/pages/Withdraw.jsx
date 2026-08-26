import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiArrowLeft, FiInfo, FiCheck } from 'react-icons/fi';
import Link from '../components/ui/Link';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Select from '../components/ui/Select';
import CoinIcon from '../components/market/CoinIcon';
import AssetMark from '../components/market/AssetMark';
import TradeModal from '../components/market/TradeModal';
import { get, post } from '../lib/api';
import { keys } from '../lib/queryClient';
import { errorMessage } from '../lib/apiError';
import { money, qty as fmtQty, dateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';

/**
 * Paying money out — the mirror of `/fund`, and the same principle underneath:
 * the database is the state and this is a view of it. `/withdraw/WDR-2026-8F92K1`
 * renders whatever the row says now, so a closed tab loses nothing.
 *
 * WHAT IS DIFFERENT IS THE ORDER OF EVENTS, and it is the whole reason this
 * screen has two stages rather than one form.
 *
 * A deposit starts with an amount because the money is coming from outside. A
 * withdrawal can only pay out CASH, and on this product most of an account is
 * usually not cash — it is positions. Asking for an amount first would mean
 * refusing most requests with "not enough buying power" and leaving the user to
 * work out for themselves that the fix is to sell something, on another screen,
 * and come back. So the holdings come first, with the sell ticket attached, and
 * the amount step is reached with the buying power the user actually has.
 *
 * The sell itself is an ORDINARY MARKET SELL through `/orders` — it fills
 * immediately and the proceeds are in buying power before this screen re-renders.
 * It is not part of the withdrawal's review: holding a sell for approval would
 * leave somebody unable to close a position while the market moved against them,
 * which is a far worse failure than waiting for a payout.
 */

/**
 * Status → badge tone and translation key. The COPY moved to the bundles; what
 * stays here is the mapping, which is structure and identical in every language.
 */
const STATUS_META = {
  requested: 'amber',
  under_review: 'amber',
  approved: 'approved',
  rejected: 'declined',
  cancelled: 'neutral',
};

const PHASE_OF = {
  requested: 0,
  under_review: 1,
  approved: 2,
  rejected: 2,
  cancelled: 2,
};
const ENDED_BADLY = ['rejected', 'cancelled'];

const assetAmount = (w) => Number(w.assetAmount ?? 0).toFixed(w.assetDecimals ?? 8);

/**
 * Does this look like an address for that chain? The server holds the
 * authoritative rule — this exists so a wrong-chain paste is caught while the
 * clipboard is still open rather than after a submit.
 */
const ADDRESS_SHAPES = {
  BITCOIN: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/,
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[a-fA-F0-9]{40}$/,
  ETHEREUM: /^0x[a-fA-F0-9]{40}$/,
  BEP20: /^0x[a-fA-F0-9]{40}$/,
  SPL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  SOLANA: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  DOGECOIN: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,39}$/,
};

// Permissive on a chain this file has not been taught about — blocking a valid
// address because the client is out of date is the worse failure of the two.
const addressShapeOk = (address, network) => {
  const shape = ADDRESS_SHAPES[String(network).toUpperCase()];
  return shape ? shape.test(address) : address.length >= 16;
};

export default function Withdraw() {
  const { t } = useTranslation();
  const { reference } = useParams();
  return (
    <div className="w-full px-4 py-8 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mx-auto max-w-160">
        <Link
          to="/portfolio"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted no-underline transition-colors hover:text-text-body"
        >
          <FiArrowLeft size={14} aria-hidden="true" />
          {t('withdraw.backToPortfolio')}
        </Link>

        {reference ? <WithdrawalDetail reference={reference} /> : <StartWithdrawal />}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- starting */

function StartWithdrawal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  /** Which stage of the two. `sell` is where holdings live; `details` is the form. */
  const [stage, setStage] = useState('sell');

  const { data: methods } = useQuery({
    queryKey: ['withdrawals', 'methods'],
    queryFn: () => get('/withdrawals/methods'),
    staleTime: 300_000,
  });

  const { data: portfolio } = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => get('/portfolio'),
  });

  const { data: mine } = useQuery({
    queryKey: ['withdrawals', 'mine'],
    queryFn: () => get('/withdrawals'),
  });

  const open = (mine?.items ?? []).filter((w) =>
    ['requested', 'under_review'].includes(w.status),
  );
  // Capped for the same reason the deposit list is: an abandoned row is normal,
  // and an uncapped list pushes the form the user came for off the screen.
  const [showAllOpen, setShowAllOpen] = useState(false);
  const visibleOpen = showAllOpen ? open : open.slice(0, 3);

  const buyingPowerCents = portfolio?.summary?.buyingPowerCents ?? 0;
  const holdings = portfolio?.holdings ?? [];
  const minCents = methods?.minAmountCents ?? 0;
  const available = methods?.crypto?.available;

  if (methods && !available) {
    return (
      <Unavailable enabled={methods.crypto.enabled} support={methods.supportEmail} />
    );
  }

  return (
    <>
      <h1 className="m-0 text-xl font-bold text-void">{t('withdraw.title')}</h1>
      <p className="mt-2 mb-0 text-sm text-text-muted">
        {t('withdraw.intro')}
      </p>

      {open.length > 0 && (
        <section className="animate-rise mt-6 overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
          <h2 className="m-0 border-b border-cool-grey px-5 py-3.5 text-md font-bold text-void">
            {t('withdraw.pending')}
          </h2>
          <ul className="m-0 list-none divide-y divide-cool-grey/70 p-0">
            {visibleOpen.map((w) => (
              <li key={w.reference}>
                <Link
                  to={`/withdraw/${w.reference}`}
                  className="flex items-center gap-3 px-5 py-3 no-underline transition-colors hover:bg-hover"
                >
                  <CoinIcon symbol={w.asset} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-semibold text-void">
                      {w.reference}
                    </span>
                    <span className="block text-2xs text-text-muted">
                      {w.asset} · {w.network}
                    </span>
                  </span>
                  <span className="font-numeric text-sm font-semibold tabular-nums text-void">
                    {money(w.amountCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {open.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllOpen((v) => !v)}
              className="w-full cursor-pointer border-t border-cool-grey bg-transparent px-5 py-2.5 text-2xs text-text-muted transition-colors hover:text-void"
            >
              {showAllOpen ? t('withdraw.showFewer') : t('withdraw.showMore', { count: open.length - 3 })}
            </button>
          )}
        </section>
      )}

      <Stages stage={stage} />

      {stage === 'sell' ? (
        <SellStage
          holdings={holdings}
          buyingPowerCents={buyingPowerCents}
          minCents={minCents}
          onContinue={() => setStage('details')}
        />
      ) : (
        <DetailsStage
          methods={methods}
          buyingPowerCents={buyingPowerCents}
          defaultEmail={user?.email ?? ''}
          onBack={() => setStage('sell')}
          onCreated={(w) => {
            queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
            // The hold has already left the balance, so every surface reading
            // buying power is wrong until this lands.
            queryClient.invalidateQueries({ queryKey: keys.portfolio });
            navigate(`/withdraw/${w.reference}`);
          }}
        />
      )}
    </>
  );
}

/**
 * Two stages, shown as two — because the first one is a detour and looks like
 * one otherwise. A user with enough cash already can pass straight through it,
 * which is why the rail marks progress rather than gating on a sale having
 * happened: forcing a sell on somebody who is already liquid would be a step
 * that exists only to be satisfied.
 */
function Stages({ stage }) {
  const { t } = useTranslation();
  const at = stage === 'sell' ? 0 : 1;
  return (
    <ol className="mt-6 mb-4 flex list-none gap-2 p-0">
      {[t('withdraw.stageSell'), t('withdraw.stageDetails')].map((label, i) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span
            className={`h-1 rounded-full ${i <= at ? 'bg-gain' : 'bg-cool-grey'}`}
            aria-hidden="true"
          />
          <span className={`text-2xs ${i <= at ? 'text-void' : 'text-text-muted'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ stage one */

function SellStage({ holdings, buyingPowerCents, minCents, onContinue }) {
  const { t } = useTranslation();
  /**
   * The selection OUTLIVES the close, which is what lets the ticket animate
   * out. Clearing it on close unmounts the dialog on the same frame and the
   * exit transition never gets a chance to run — the panel just vanishes.
   */
  const [selected, setSelected] = useState(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const enough = buyingPowerCents >= minCents && minCents > 0;

  return (
    <section className="animate-rise overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cool-grey px-5 py-4">
        <h2 className="m-0 text-md font-bold text-void">{t('withdraw.available')}</h2>
        <span className="font-numeric text-lg font-bold tabular-nums text-void">
          {money(buyingPowerCents)}
        </span>
      </div>

      {holdings.length > 0 ? (
        <>
          <p className="m-0 px-5 pt-4 pb-1 text-2xs text-text-muted">
            {t('withdraw.sellHint')}
          </p>
          <ul className="m-0 list-none divide-y divide-cool-grey/70 p-0">
            {holdings.map((h) => (
              <li
                key={`${h.assetClass ?? 'stocks'}:${h.symbol}`}
                className="flex items-center gap-3 px-5 py-3"
              >
                <AssetMark symbol={h.symbol} name={h.name} logoUrl={h.logoUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-bold text-void">{h.symbol}</span>
                  <span className="block truncate text-2xs text-text-muted">
                    {fmtQty(h.shares, h.assetClass)} · {h.name}
                  </span>
                </span>
                <span className="font-numeric text-sm font-semibold tabular-nums text-void">
                  {money(h.marketValueCents)}
                </span>
                <Button
                  size="sm"
                  variant="outline-red"
                  onClick={() => {
                    setSelected(h);
                    setTicketOpen(true);
                  }}
                >
                  {t('trade.sell')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="m-0 px-5 py-6 text-center text-sm text-text-muted">
          {t('withdraw.noPositions')}
        </p>
      )}

      <div className="border-t border-cool-grey px-5 py-4">
        <Button onClick={onContinue} disabled={!enough} className="w-full">
          {t('common.continue')}
        </Button>
        {!enough && (
          <p className="mt-2 mb-0 text-center text-2xs text-text-muted">
            {/* States the gap rather than only refusing — "disabled" on its own
                leaves the reader to work out what would enable it. */}
            {t('withdraw.minimumHint', {
              min: money(minCents),
              missing: money(Math.max(0, minCents - buyingPowerCents)),
            })}
          </p>
        )}
      </div>

      {/* The same ticket the terminal and the portfolio chart open, opened
          straight onto its sell side — there is one order path in this product
          and this screen does not get a second one. */}
      {selected && (
        <TradeModal
          key={`${selected.assetClass ?? 'stocks'}:${selected.symbol}`}
          open={ticketOpen}
          onClose={() => setTicketOpen(false)}
          initialSide="SELL"
          instrument={selected}
          assetClass={selected.assetClass ?? 'stocks'}
          priceUsdCents={selected.priceUsdCents}
          priceUsdNanos={selected.priceUsdNanos}
          holding={selected}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ stage two */

function DetailsStage({ methods, buyingPowerCents, defaultEmail, onBack, onCreated }) {
  const { t } = useTranslation();
  const [assetSymbol, setAssetSymbol] = useState('');
  const [networkKey, setNetworkKey] = useState('');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);

  /**
   * One key per attempt would defeat the mechanism entirely, so it is minted
   * once for the whole ticket — the same rule the trade ticket follows.
   */
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const assets = methods?.crypto?.assets ?? [];
  const asset = assets.find((a) => a.symbol === assetSymbol) ?? null;
  // Derived, never held: a stale network cannot survive an asset change because
  // the lookup simply stops matching.
  const destination = asset?.networks.find((n) => `${n.asset}:${n.network}` === networkKey) ?? null;

  const create = useMutation({
    /** @param {{asset:string, network:string, address:string, amountCents:number, contactEmail:string, idempotencyKey:string}} body */
    mutationFn: (body) => post('/withdrawals', body),
    onSuccess: (res) => onCreated(res.withdrawal),
    onError: (err) => setError(errorMessage(err)),
  });

  const dollars = Number.parseFloat(amount);
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
  const minCents = methods?.minAmountCents ?? 0;
  const maxCents = Math.min(methods?.maxAmountCents ?? Infinity, buyingPowerCents);

  const amountProblem =
    !Number.isFinite(amountCents) || amountCents <= 0
      ? null
      : amountCents < minCents
        ? t('withdraw.belowMin', { min: money(minCents) })
        : amountCents > buyingPowerCents
          ? t('withdraw.overBalance', { available: money(buyingPowerCents) })
          : amountCents > (methods?.maxAmountCents ?? Infinity)
            ? t('withdraw.overMax', { max: money(methods.maxAmountCents) })
            : null;

  /**
   * A CHEAP SHAPE CHECK SO THE ADDRESS IS NOT CONFIRMED BLIND.
   *
   * The server owns the real rule — this is the same first character and length
   * the hint describes, which is enough to catch a wrong-chain paste (an `0x…`
   * address into a Tron payout) while the clipboard is still open. It stays
   * permissive on an unknown prefix rather than blocking a valid address the
   * client has not been taught about; the server refuses those.
   */
  const trimmedAddress = address.trim();
  const addressLooksWrong =
    Boolean(destination) &&
    trimmedAddress.length > 8 &&
    !addressShapeOk(trimmedAddress, destination.network);

  const ready =
    destination && trimmedAddress.length >= 16 && !addressLooksWrong && !amountProblem &&
    Number.isFinite(amountCents) && amountCents >= minCents && confirmed;

  return (
    <section className="animate-rise overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
      <h2 className="m-0 border-b border-cool-grey px-5 py-4 text-md font-bold text-void">
        {t('withdraw.whereTo')}
      </h2>

      <div className="flex flex-col gap-4 px-5 py-5">
        <Field label={t('withdraw.asset')} htmlFor="wdr-asset">
          <Select
            id="wdr-asset"
            value={assetSymbol}
            onChange={(v) => {
              setAssetSymbol(v);
              setNetworkKey('');
            }}
            placeholder={t('withdraw.chooseAsset')}
            options={assets.map((a) => ({
              value: a.symbol,
              label: a.name,
              sublabel: a.symbol,
              icon: <CoinIcon symbol={a.symbol} logoUrl={a.logoUrl} size={28} />,
            }))}
          />
        </Field>

        <Field label={t('withdraw.network')} htmlFor="wdr-network">
          <Select
            id="wdr-network"
            value={networkKey}
            onChange={setNetworkKey}
            disabled={!asset}
            placeholder={asset ? t('withdraw.chooseNetwork') : t('withdraw.chooseAssetFirst')}
            options={(asset?.networks ?? []).map((n) => ({
              value: `${n.asset}:${n.network}`,
              label: n.label,
              sublabel: n.differsFromGroup ? `→ ${n.asset}` : n.asset,
              icon: <CoinIcon network={n.network} logoUrl={n.logoUrl} size={28} />,
            }))}
          />
        </Field>

        {/* Above the address, not below it: the moment to learn that this
            network sends a different asset is before anything is pasted. */}
        {destination?.note && (
          <p className="m-0 flex items-start gap-2 rounded-lg bg-amber-tint px-3 py-2.5 text-2xs text-amber">
            <FiInfo size={14} className="mt-px shrink-0" aria-hidden="true" />
            <span>{destination.note}</span>
          </p>
        )}

        <Field
          label={t('withdraw.yourAddress', { asset: destination?.asset ?? '' }).replace('  ', ' ')}
          htmlFor="wdr-address"
          // Said BEFORE anything is pasted. The server rejects a malformed
          // address either way, but "starts with T and is 34 characters" is
          // only useful while there is still time to check the clipboard.
          hint={destination?.addressHint ?? ''}
        >
          <input
            id="wdr-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder={
              destination
                ? t('withdraw.pasteAddress', { network: destination.network })
                : t('withdraw.chooseNetworkFirst')
            }
            disabled={!destination}
            className={`w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-xs transition-colors focus:outline-none disabled:bg-mist disabled:text-text-muted ${
              addressLooksWrong ? 'border-loss' : 'border-cool-grey focus:border-gain'
            }`}
          />
        </Field>
        {addressLooksWrong && (
          <p className="m-0 -mt-2 text-2xs text-loss">
            {t('withdraw.addressMismatch', { network: destination.network })}{' '}
            {destination.addressHint}
          </p>
        )}

        <Field label={t('withdraw.amount')} htmlFor="wdr-amount">
          <div className="flex gap-2">
            <input
              id="wdr-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={String(Math.round(minCents / 100))}
              className="w-full rounded-lg border border-cool-grey bg-white px-3 py-2.5 font-numeric text-md tabular-nums transition-colors focus:border-gain focus:outline-none"
            />
            {/* Most of the friction in withdrawing is typing the balance back
                in by hand, and a hand-typed figure is where an off-by-one goes. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAmount(String(Math.floor(maxCents) / 100))}
              disabled={maxCents < minCents}
            >
              {t('common.max')}
            </Button>
          </div>
          <p className="mt-1.5 mb-0 text-2xs text-text-muted">
            {t('withdraw.availableMin', {
              available: money(buyingPowerCents),
              min: money(minCents),
            })}
          </p>
        </Field>

        {amountProblem && <p className="m-0 text-2xs text-loss">{amountProblem}</p>}

        <Field
          label={t('withdraw.contactEmail')}
          htmlFor="wdr-email"
          hint={t('withdraw.contactHint')}
        >
          <input
            id="wdr-email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            className="w-full rounded-lg border border-cool-grey bg-white px-3 py-2.5 text-sm transition-colors focus:border-gain focus:outline-none"
          />
        </Field>

        {/*
          THE ADDRESS IS THE ONE THING NOBODY CAN FIX AFTERWARDS.

          A deposit sent to the wrong place is our problem to trace; a payout
          sent to a wrong address the user supplied is gone, and no amount of
          reviewing catches a valid address that simply is not theirs. So the
          check is a deliberate act against the address echoed back, rather
          than a sentence above the button that reads as boilerplate.
        */}
        {destination && address.trim().length >= 16 && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-cool-grey bg-mist px-3 py-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-gain"
            />
            <span className="text-2xs text-text-body">
              {t('withdraw.confirmAddress', { network: destination.network })}
              <span className="mt-1 block font-mono break-all text-text-muted">
                {address.trim()}
              </span>
            </span>
          </label>
        )}

        {error && <p className="m-0 text-2xs text-loss">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button
            className="flex-1"
            disabled={!ready || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({
                asset: destination.asset,
                network: destination.network,
                address: address.trim(),
                amountCents,
                contactEmail: contactEmail.trim(),
                idempotencyKey,
              });
            }}
          >
            {create.isPending ? t('common.submitting') : t('withdraw.submit')}
          </Button>
        </div>

        <p className="m-0 text-center text-2xs text-text-muted">
          {t('withdraw.holdNote')}
        </p>
      </div>
    </section>
  );
}

/**
 * A LABEL BESIDE THE CONTROL, NEVER WRAPPED AROUND IT — and that is a bug fix,
 * not a style preference.
 *
 * This wrapped its children in a `<label>`, which broke both dropdowns in a way
 * that looked like a `Select` fault and was not. Clicking anything inside a
 * label forwards the activation to the label's control, so pressing an option
 * ran `commit()` (setting the value and closing the list) and then the
 * forwarded click hit the trigger button and toggled it straight back open. The
 * value was right and the list would not shut. Measured: `aria-expanded` never
 * left `true` through a full select, while the identical component on `/fund`
 * — where the label is a SIBLING with `htmlFor` — closed every time.
 *
 * So the association is by id. A `<label>` with no `htmlFor` and no control
 * inside it is inert, which is the correct default here.
 */
function Field({ label, hint = '', htmlFor = undefined, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-2xs font-medium text-text-body">
        {label}
      </label>
      {children}
      {hint && <span className="mt-1.5 block text-2xs text-text-muted">{hint}</span>}
    </div>
  );
}

function Unavailable({ enabled, support }) {
  const { t } = useTranslation();
  return (
    <section className="animate-rise rounded-xl border border-cool-grey bg-white p-6 shadow-card">
      <h1 className="m-0 text-xl font-bold text-void">{t('withdraw.unavailableTitle')}</h1>
      {/* Two different causes, named separately — collapsing them into one
          "unavailable" leaves whoever has to fix it guessing which. */}
      <p className="mt-3 mb-0 text-sm text-text-muted">
        {enabled ? t('withdraw.unavailableNoNetwork') : t('withdraw.unavailableDisabled')}
      </p>
      <Button to="/portfolio" variant="secondary" className="mt-6">
        {t('withdraw.backToPortfolio')}
      </Button>
      <p className="mt-4 mb-0 text-2xs text-text-muted">
        {t('withdraw.questions', { email: support })}
      </p>
    </section>
  );
}

/* ----------------------------------------------------------------- detail */

function WithdrawalDetail({ reference }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: withdrawal, isPending } = useQuery({
    queryKey: ['withdrawals', reference],
    queryFn: () => get(`/withdrawals/${reference}`),
    // A payout under review changes without this tab doing anything; a settled
    // one does not.
    refetchInterval: (q) =>
      ['approved', 'rejected', 'cancelled'].includes(q.state.data?.status) ? false : 15_000,
  });

  /**
   * Both terminal outcomes that hand the money back change the balance without
   * this tab having asked for anything — the same gap the deposit screen had,
   * where the card said "complete" while buying power sat on a cached answer.
   * Fires on the TRANSITION, so an already-settled row left open does not
   * refetch every fifteen seconds forever.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!['approved', 'rejected', 'cancelled'].includes(withdrawal?.status)) return;
    if (settled.current) return;
    settled.current = true;
    queryClient.invalidateQueries({ queryKey: keys.portfolio });
    queryClient.invalidateQueries({ queryKey: keys.wallet });
    queryClient.invalidateQueries({ queryKey: keys.leaderboard('all') });
  }, [withdrawal?.status, queryClient]);

  const cancel = useMutation({
    mutationFn: () => post(`/withdrawals/${reference}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      queryClient.invalidateQueries({ queryKey: keys.portfolio });
    },
  });

  if (isPending) return <DetailSkeleton />;
  if (!withdrawal) return <p className="text-sm text-text-muted">{t('withdraw.noSuchWithdrawal')}</p>;

  const tone = STATUS_META[withdrawal.status] ?? 'neutral';
  // Cast because a dynamic key widens i18next's return type past ReactNode.
  // The default is the raw status, so an unmapped state degrades to something
  // legible rather than to the key itself.
  const title = /** @type {string} */ (
    t(`withdraw.status.${withdrawal.status}`, { defaultValue: withdrawal.status })
  );
  const body = /** @type {string} */ (
    t(`withdraw.status.${withdrawal.status}Body`, { defaultValue: '' })
  );

  return (
    <section className="animate-rise overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
      <Phases status={withdrawal.status} />

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-cool-grey px-5 py-4">
        <div className="flex items-start gap-3">
          <CoinIcon symbol={withdrawal.asset} size={36} />
          <div>
            <h1 className="m-0 text-md font-bold text-void">{title}</h1>
            <p className="m-0 mt-0.5 text-2xs text-text-muted">
              {withdrawal.asset} · {withdrawal.network}
            </p>
          </div>
        </div>
        <Badge variant={tone}>{title}</Badge>
      </header>

      <div className="px-5 py-5">
        <p className="m-0 text-sm text-text-muted">{body}</p>

        <div className="mt-5 rounded-lg border border-cool-grey bg-mist px-4 py-4 text-center">
          <span className="block text-2xs text-text-muted">{t('withdraw.sending')}</span>
          {/* THE ASSET QUANTITY LEADS, as on the deposit screen and for the
              mirrored reason: the chain moves a quantity, and the dollar figure
              is the thing that was converted from. */}
          <span className="mt-1 block font-numeric text-xl font-medium tabular-nums text-void">
            {assetAmount(withdrawal)} {withdrawal.asset}
          </span>
          <span className="mt-1 block text-2xs text-text-muted">
            {t('withdraw.rate', {
              amount: money(withdrawal.amountCents),
              rate: money(Math.round(withdrawal.rateUsdNanos / 1e7)),
              asset: withdrawal.asset,
            })}
          </span>
        </div>

        {withdrawal.networkNote && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-tint px-3 py-2.5 text-2xs text-amber">
            <FiInfo size={14} className="mt-px shrink-0" aria-hidden="true" />
            <span>{withdrawal.networkNote}</span>
          </p>
        )}

        <dl className="m-0 mt-5 divide-y divide-cool-grey/70 border-t border-cool-grey">
          <Row label={t('withdraw.reference')} value={withdrawal.reference} mono />
          <Row label={t('withdraw.toAddress')} value={withdrawal.destinationAddress} mono />
          <Row label={t('withdraw.requested')} value={dateTime(withdrawal.createdAt)} />
          {withdrawal.txHash && <Row label={t('withdraw.transaction')} value={withdrawal.txHash} mono />}
          {withdrawal.rejectionReason && (
            <Row label={t('withdraw.reason')} value={withdrawal.rejectionReason} />
          )}
        </dl>

        {withdrawal.status === 'requested' && (
          <Button
            variant="secondary"
            className="mt-5 w-full"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? t('withdraw.cancelling') : t('withdraw.cancelWithdrawal')}
          </Button>
        )}

        {withdrawal.status === 'approved' && (
          <p className="mt-5 mb-0 flex items-center justify-center gap-1.5 text-2xs text-gain">
            <FiCheck size={14} aria-hidden="true" />
            {t('withdraw.sentAt', { date: dateTime(withdrawal.completedAt) })}
          </p>
        )}
      </div>

      {withdrawal.history?.length > 0 && (
        <ol className="m-0 list-none border-t border-cool-grey px-5 py-4 text-2xs text-text-muted">
          {withdrawal.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-4 py-0.5">
              <span>{String(h.to).replace(/_/g, ' ')}</span>
              <span className="font-numeric tabular-nums">{dateTime(h.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Three phases, not five states. It answers "is it me or them I am waiting on",
 * and a payout that ended badly marks the last phase in loss red so the rail can
 * say *ended here* rather than *completed*.
 */
function Phases({ status }) {
  const { t } = useTranslation();
  const at = PHASE_OF[status] ?? 0;
  const bad = ENDED_BADLY.includes(status);

  return (
    <ol className="m-0 flex list-none gap-2 border-b border-cool-grey px-5 py-4">
      {[t('withdraw.phaseRequest'), t('withdraw.phaseReview'), t('withdraw.phaseSent')].map((label, i) => {
        const done = i <= at;
        const isLast = i === at && bad;
        return (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={`h-1 rounded-full ${
                isLast ? 'bg-loss' : done ? 'bg-gain' : 'bg-cool-grey'
              }`}
              aria-hidden="true"
            />
            <span className={`text-2xs ${done ? 'text-void' : 'text-text-muted'}`}>
              {isLast ? t('withdraw.phaseEnded') : label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-2xs text-text-muted">{label}</dt>
      <dd
        className={`m-0 min-w-0 truncate text-right text-xs text-text-body ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="rounded-xl border border-cool-grey bg-white p-6 shadow-card">
      <div className="h-4 w-32 animate-pulse rounded bg-mist" />
      <div className="mt-4 h-20 animate-pulse rounded-lg bg-mist" />
      <div className="mt-4 h-32 animate-pulse rounded-lg bg-mist" />
    </div>
  );
}
