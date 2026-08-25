import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { fundingUrl } from '../../lib/tradeIntent';
import { errorMessage } from '../../lib/apiError';
import { money, priceUsd, qty as fmtQty } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Tabs from '../ui/Tabs';

/**
 * The order ticket: choose a side and a quantity, confirm against a live total.
 *
 * Market orders only. `Order` models LIMIT too, but a limit order that sits
 * unfilled is a worse first experience than not offering one, so the sweeper
 * that fills them lands with the Wallet screen.
 *
 * THE PRICE SHOWN IS SENT WITH THE ORDER. The server rejects a fill that has
 * drifted more than MAX_SLIPPAGE_PCT from it with 409 PRICE_MOVED, which is
 * what makes this confirm step mean something — without it the total on screen
 * is decorative and the user is filled at whatever the market did in between.
 *
 * IT SENDS NANOS, not cents. Cents cannot carry a sub-dollar quote against a
 * 0.5% tolerance: EURUSD at 1.1663 rounds to 117 cents, which is already 0.32%
 * off — most of the slippage budget spent on rounding before the market has
 * moved at all.
 */
const SIDES = [
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
];

const NANOS_PER_CENT = 10_000_000;

/**
 * A QUANTITY IS ALWAYS PAIRED WITH THE SYMBOL, never with a generic noun.
 *
 * "Buy 0.0063 coins" names a category, not the thing being bought — and the
 * receipt one click later already reads "Bought 0.0063 BTC", so the ticket was
 * the odd one out. The symbol is also the identifier the rest of this screen
 * leads with (it is the h1) and the wording the ledger writes into every
 * transaction: "12 AAPL @ $214.02".
 *
 * `noun` survives for the one place a quantity is NOT beside the symbol — the
 * "Shares held" / "Units held" row label, where the symbol is already implied
 * by the panel around it — and `one` for the per-unit price, because "per
 * share" is English and "per AAPL" is not. Crypto and forex have no equivalent
 * word, so those take the symbol there too.
 */
const UNITS = {
  stocks: { oneKey: 'trade.perShare', nounKey: 'trade.sharesNoun' },
  crypto: { oneKey: null, nounKey: 'trade.unitsNoun' },
  forex: { oneKey: null, nounKey: 'trade.unitsNoun' },
};

export default function TradeModal({
  open,
  onClose,
  instrument,
  assetClass = 'stocks',
  priceUsdCents,
  priceUsdNanos,
  holding,
  /**
   * Which side the ticket opens on. A prop rather than internal state because
   * the caller may be a dedicated Buy or Sell button — landing on Buy after
   * somebody pressed Sell reads as the click having missed.
   */
  initialSide = 'BUY',
  /**
   * The quantity to open on, when the caller knows better than the default —
   * which today means one thing: the user is coming back from funding and this
   * is the order they left to pay for. Null everywhere else.
   */
  initialQuantity = null,
}) {
  const { t } = useTranslation();
  const { user, patchUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [side, setSide] = useState(initialSide);
  const [quantity, setQuantity] = useState('1');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  /**
   * One key per TICKET, not per attempt. A retry after a network wobble must
   * reuse it — that is the whole point of the unique index behind it — so it is
   * regenerated when the ticket opens and never on submit.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const whole = assetClass === 'stocks';
  const units = UNITS[assetClass] ?? UNITS.stocks;
  // Falls back to the cents figure so a caller that has not been updated still
  // prices correctly for equities, where the two are exact multiples.
  const nanos = Number(priceUsdNanos) || Number(priceUsdCents) * NANOS_PER_CENT || 0;
  /**
   * Forex is quoted to four decimals, and to two once a pair trades above ~50
   * (USDJPY at 159.12, not 159.1200). Without this the ticket showed EURUSD at
   * "$1.17" beside a total struck at 1.1664 — 420 units priced at the displayed
   * figure comes to $491.40 against the $489.89 actually charged, and the
   * arithmetic visibly fails on one small panel.
   */
  const priceDecimals = assetClass === 'forex' ? (nanos / 1e9 >= 50 ? 2 : 4) : undefined;

  useEffect(() => {
    if (!open) return;
    setSide(initialSide);
    // A default of 1 is a reasonable share order and an absurd Bitcoin one —
    // roughly eight times a starting account — so the fractional classes open
    // on a quantity the user can actually afford rather than one that greets
    // them with an error.
    setQuantity(
      initialQuantity ?? (whole ? '1' : defaultQty(nanos, user?.cashBalanceCents ?? 0)),
    );
    setError(null);
    setReceipt(null);
    setIdempotencyKey(crypto.randomUUID());
    // `nanos` moves on every poll; re-running this on it would reset the input
    // under the user's cursor mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, whole, initialSide, initialQuantity]);

  const qty = whole ? Number.parseInt(quantity, 10) : Number.parseFloat(quantity);
  const validQty =
    Number.isFinite(qty) && qty > 0 && (!whole || Number.isInteger(qty)) && (whole || qty >= 1e-8);

  // Rounded ONCE, from nanos, exactly as the server rounds the fill — so the
  // total on the ticket is the total on the receipt.
  const totalCents = validQty ? Math.round(qty * (nanos / NANOS_PER_CENT)) : 0;
  const buyingPowerCents = user?.cashBalanceCents ?? 0;
  const held = holding?.shares ?? 0;

  const problem = useMemo(() => {
    if (!validQty) {
      return whole ? t('trade.wholeShares') : t('trade.positiveQty');
    }
    if (side === 'BUY' && totalCents > buyingPowerCents) return t('trade.notEnough');
    if (side === 'SELL' && qty > held) {
      return held === 0
        ? t('trade.holdNone', { symbol: instrument.symbol })
        : t('trade.holdOnly', {
            quantity: fmtQty(held, assetClass),
            symbol: instrument.symbol,
          });
    }
    return null;
    // `t` is in here because the messages it returns ARE the value: without it a
  // language switch would leave the last validation message in the old language.
}, [validQty, whole, side, totalCents, buyingPowerCents, qty, held, instrument.symbol, assetClass, t]);

  /**
   * What is missing, rounded UP to a whole dollar.
   *
   * Offering the exact shortfall to the cent would leave the account at exactly
   * zero after the fill and the next tick of the price would put it short
   * again. A dollar of headroom costs nothing in virtual capital.
   */
  const shortfallCents =
    side === 'BUY' && validQty && totalCents > buyingPowerCents
      ? Math.ceil((totalCents - buyingPowerCents) / 100) * 100
      : 0;

  /**
   * Leave for the funding screen, carrying the order so it can be waiting on
   * the way back. The ticket is closed first — `<dialog>` in the top layer
   * outlives a route change, and a modal left open over the next page is the
   * kind of thing that only shows up on the slowest connection.
   */
  function goToDeposit() {
    const url = fundingUrl({
      path: location.pathname,
      trade: { assetClass, symbol: instrument.symbol, side, quantity },
      needCents: shortfallCents,
    });
    onClose();
    navigate(url);
  }

  /** The largest quantity this side can support, quantised to the step. */
  function fillMax() {
    if (side === 'SELL') return setQuantity(String(fmtQty(held, assetClass)));
    if (!nanos) return;
    const raw = buyingPowerCents / (nanos / NANOS_PER_CENT);
    setQuantity(whole ? String(Math.floor(raw)) : String(Math.floor(raw * 1e8) / 1e8));
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await post('/orders', {
        assetClass,
        symbol: instrument.symbol,
        side,
        quantity: qty,
        quotedPriceUsdNanos: nanos,
        idempotencyKey,
      });

      // The response carries the new balance and position, so the pill and the
      // holdings row update without waiting for a refetch to land.
      patchUser({ cashBalanceCents: result.cashBalanceCents });
      setReceipt(result);

      queryClient.invalidateQueries({ queryKey: keys.portfolio });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: keys.leaderboard('all') });
    } catch (err) {
      // Through the shared code map. PRICE_MOVED is not a failure to
      // apologise for — it is the guard doing its job — and every other code
      // now reaches the user in their own language, falling back to the
      // server's English sentence rather than to a bare code.
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (receipt) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t('trade.filled')}
        footer={
          <Button variant="secondary" onClick={onClose} className="w-full">
            {t('common.back')}
          </Button>
        }
      >
        <Receipt
          receipt={receipt}
          instrument={instrument}
          assetClass={assetClass}
          units={units}
          priceDecimals={priceDecimals}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('trade.title', { symbol: instrument.symbol })}
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p className="m-0 rounded-md bg-red-tint px-3 py-2 text-xs text-loss">{error}</p>
          )}
          {/*
            A SHORTFALL GETS AN ACTION, not just a refusal.

            "Not enough buying power" states a fact and leaves the user to work
            out that funds can be added, on another screen, and then find their
            way back to this ticket. The shortfall is the one problem here with
            a fix the user can apply, so it is offered where they hit it —
            naming the gap, prefilled with the amount, and carrying the order
            so it is waiting on the way back.

            DEPOSIT IS THE ONLY FUNDING PATH OFFERED HERE. Practice funds used
            to sit alongside it and does not any more: two buttons made the user
            choose between two kinds of money at the exact moment they were
            trying to do something else, and the instant one was capped at
            $5,000 — so on any real shortfall it was the wrong answer offered
            first. `wallet.service.js` and `/api/wallet` are untouched and still
            tested; what is gone is the UI that reached them.
          */}
          {shortfallCents > 0 ? (
            <>
              <p className="m-0 text-center text-2xs text-text-muted">
                {t('trade.shortOf', {
                  missing: money(shortfallCents),
                  total: money(totalCents),
                })}
              </p>
              <Button onClick={goToDeposit} className="w-full">
                {t('trade.depositAmount', { amount: money(shortfallCents) })}
              </Button>
              <p className="m-0 text-center text-2xs text-text-muted">
                {/* Sets the expectation before the trip rather than after it: a
                    deposit does not clear on this screen, and the order is not
                    lost while it does. */}
                {t('trade.depositNote')}
              </p>
            </>
          ) : (
            <Button
              variant={side === 'BUY' ? 'primary' : 'outline-red'}
              onClick={submit}
              loading={pending}
              disabled={Boolean(problem)}
              className="w-full"
            >
              {/* The quantity is INSIDE the sentence, not appended to a verb:
                  Ukrainian puts it in a different place from English, and a
                  concatenated label cannot express that. */}
              {validQty
                ? t(side === 'BUY' ? 'trade.submitBuy' : 'trade.submitSell', {
                    quantity: fmtQty(qty, assetClass),
                    symbol: instrument.symbol,
                  })
                : t(side === 'BUY' ? 'trade.buy' : 'trade.sell')}
            </Button>
          )}
        </div>
      }
    >
      <Tabs tabs={SIDES} value={side} onChange={setSide} className="mb-5" />

      <div className="flex items-baseline justify-between">
        <label className="block text-xs text-text-muted" htmlFor="trade-qty">
          Quantity
        </label>
        {/* Typing "0.00634" to spend a round number of dollars is the fractional
            classes' whole friction, and this removes most of it. */}
        <button
          type="button"
          onClick={fillMax}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-gain hover:underline"
        >
          Max
        </button>
      </div>
      <input
        id="trade-qty"
        type="number"
        min={whole ? '1' : '0.00000001'}
        step={whole ? '1' : 'any'}
        inputMode="decimal"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-cool-grey bg-white px-3 py-2.5 font-numeric text-md tabular-nums transition-colors focus:border-gain focus:outline-none"
      />

      <dl className="mt-5 grid grid-cols-2 gap-y-2.5 text-sm">
        {/* priceUsd, not money: a coin under a cent renders as "$0.01" through
            the cents formatter, which is not the price being agreed to. */}
        <Line label={t('trade.marketPrice')} value={priceUsd(nanos, priceDecimals)} />
        <Line label={t('trade.estimatedTotal')} value={money(totalCents)} strong />
        <Line
          label={
            side === 'BUY'
              ? t('trade.buyingPower')
              : t('trade.held', { noun: t(units.nounKey) })
          }
          value={side === 'BUY' ? money(buyingPowerCents) : fmtQty(held, assetClass)}
        />
        <Line
          label={side === 'BUY' ? t('trade.remaining') : t('trade.afterSale')}
          value={
            side === 'BUY'
              ? money(Math.max(0, buyingPowerCents - totalCents))
              : fmtQty(Math.max(0, held - (validQty ? qty : 0)), assetClass)
          }
        />
      </dl>

      {problem && <p className="mt-4 mb-0 text-xs text-loss">{problem}</p>}

      <p className="mt-4 mb-0 text-2xs text-text-muted">
        Market order, filled immediately at the price above. HyperStocks trades
        virtual capital — no real money moves.
      </p>

    </Modal>
  );
}

/**
 * A starting quantity worth roughly $500, or whatever the account can cover.
 *
 * Opening a Bitcoin ticket on "1" would show a $79,000 total and an immediate
 * "not enough buying power" — technically accurate and useless. This lands on a
 * number that is affordable and roughly round.
 */
function defaultQty(nanos, cashCents) {
  if (!nanos) return '1';
  const budget = Math.min(50_000, Math.max(0, cashCents));
  const raw = budget / (nanos / NANOS_PER_CENT);
  if (!Number.isFinite(raw) || raw <= 0) return '1';
  // Two significant figures reads as a chosen number rather than a computed
  // one — 0.0063, not 0.00634117.
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return String(Number((Math.floor(raw / magnitude) * magnitude).toFixed(8)));
}

function Line({ label, value, strong = false }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd
        className={`m-0 text-right font-numeric tabular-nums ${strong ? 'font-semibold text-text-body' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}

function Receipt({ receipt, instrument, assetClass, units, priceDecimals }) {
  const { t } = useTranslation();
  const { order } = receipt;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-green-tint text-gain">
          ✓
        </span>
        <div>
          <div className="text-md font-bold">
            {order.side === 'BUY' ? t('trade.bought') : t('trade.sold')}{' '}
            {fmtQty(order.quantity, assetClass)}{' '}
            {instrument.symbol}
          </div>
          <div className="text-xs text-text-muted">
            {/* The nanos figure is what the total was computed from, so the
                receipt reproduces the arithmetic instead of approximately
                agreeing with it. */}
            at{' '}
            {priceUsd(
              order.fillPriceUsdNanos ?? order.fillPriceUsdCents * NANOS_PER_CENT,
              priceDecimals,
            )}{' '}
            {units.oneKey ? t(units.oneKey) : instrument.symbol}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
        <Line label={t('nav.total')} value={money(order.totalCents)} strong />
        <Line label={t('trade.buyingPower')} value={money(receipt.cashBalanceCents)} />
        <Line
          label="Position"
          value={
            receipt.holding
              ? `${fmtQty(receipt.holding.shares, assetClass)} ${instrument.symbol}`
              : 'Closed'
          }
        />
        {receipt.holding && (
          <Line label="Average cost" value={money(receipt.holding.avgCostCents)} />
        )}
      </dl>
    </div>
  );
}
