import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { post, patch, get } from '../../lib/api';
import { money, pct } from '../../lib/format';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import Badge, { statusVariant } from '../ui/Badge';
import SegmentedControl from '../ui/SegmentedControl';
import Icon from '../ui/Icon';
import notify from '../../lib/toast';

const SEED_CASH_CENTS = 1_000_000; // $10,000 standard base

const QUICK_FUNDS = [1000, 5000, 10000, 50000, 100000, 1000000];

export default function TraderOverrideModal({ open, onClose, trader }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  // Active tab in modal
  const [activeTab, setActiveTab] = useState('trade'); // 'trade' | 'funds' | 'performance'

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState('');

  // Performance Target state
  const [returnPct, setReturnPct] = useState('0');

  // Trade Ticket state
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'stocks' | 'crypto' | 'forex'
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [shares, setShares] = useState('1');

  // Add Funds state
  const [fundAmount, setFundAmount] = useState('');

  // Reset/sync state when a different trader is opened
  useEffect(() => {
    if (open && trader) {
      setAvatarUrl(trader.avatarUrl || trader.image || '');
      const initialReturn = trader.computed?.returnPct ?? 0;
      setReturnPct(String(initialReturn));
      setSelectedSymbol('');
      setShares('1');
      setFundAmount('');
      setActiveTab('trade');
    }
  }, [open, trader?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Query live user holdings and available instrument universe
  const { data: positions, refetch: refetchPositions } = useQuery({
    queryKey: ['adminPositions', trader?.id],
    queryFn: () => get(`/admin/positions?userId=${trader?.id}`),
    enabled: Boolean(trader?.id && open),
  });

  const heldList = useMemo(() => positions?.held ?? [], [positions?.held]);
  const availableList = useMemo(() => positions?.available ?? [], [positions?.available]);

  // Combine held and available for asset picker
  const allAssets = useMemo(() => {
    const map = new Map();
    for (const p of heldList) {
      map.set(p.symbol, { ...p, held: true });
    }
    for (const p of availableList) {
      if (!map.has(p.symbol)) {
        map.set(p.symbol, { ...p, held: false });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [heldList, availableList]);

  // Filtered asset options
  const filteredAssets = useMemo(() => {
    if (categoryFilter === 'all') return allAssets;
    return allAssets.filter((a) => (a.assetClass || 'stocks').toLowerCase() === categoryFilter);
  }, [allAssets, categoryFilter]);

  // Currently selected asset info
  const selectedAsset = useMemo(() => {
    return allAssets.find((a) => a.symbol === selectedSymbol) ?? null;
  }, [allAssets, selectedSymbol]);

  // Selected asset held units (if user already owns it)
  const userHeldPosition = useMemo(() => {
    return heldList.find((h) => h.symbol === selectedSymbol) ?? null;
  }, [heldList, selectedSymbol]);

  // Live financial metrics
  const currentHoldingsValue = useMemo(() => {
    return heldList.reduce((sum, h) => sum + (h.valueCents || 0), 0);
  }, [heldList]);

  const currentCash = trader?.cashBalanceCents ?? 0;
  const currentPortfolioValue = currentCash + currentHoldingsValue;
  const liveReturnPct =
    currentPortfolioValue > SEED_CASH_CENTS
      ? ((currentPortfolioValue - SEED_CASH_CENTS) / SEED_CASH_CENTS) * 100
      : trader?.computed?.returnPct ?? 0;

  // Estimated order total for the trade ticket
  const orderPriceCents = selectedAsset?.priceCents || selectedAsset?.priceUsdCents || 0;
  const numQty = parseFloat(shares) || 0;
  const estTotalCents = Math.round(numQty * orderPriceCents);
  const isOverBudget = activeTab === 'trade' && estTotalCents > currentCash;

  // MUTATIONS

  // 1. Upload Avatar
  const uploadAvatarMutation = useMutation({
    mutationFn: async (file) => {
      if (!file) return null;
      if (file.size > 600 * 1024) {
        throw new Error('Images must be 600KB or smaller.');
      }
      const data = await post('/admin/media', file, {
        headers: { 'Content-Type': file.type },
      });
      await patch(`/admin/users/${trader.id}/avatar`, { image: data.url });
      return data.url;
    },
    onSuccess: (url) => {
      setAvatarUrl(url);
      notify.success('Avatar updated successfully');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  // 2. Remove Avatar
  const removeAvatarMutation = useMutation({
    mutationFn: async () => {
      await patch(`/admin/users/${trader.id}/avatar`, { image: null });
    },
    onSuccess: () => {
      setAvatarUrl('');
      notify.success('Avatar removed');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  // 3. Add Funds (Virtual Capital)
  const addFundsMutation = useMutation({
    mutationFn: (amountDollars) =>
      post(`/admin/users/${trader.id}/portfolio/funds`, {
        amountCents: Math.round(Number(amountDollars) * 100),
      }),
    onSuccess: () => {
      notify.success(`Added ${money(Math.round(Number(fundAmount) * 100))} to buying power`);
      setFundAmount('');
      refetchPositions();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  // 4. Place Live Market Order (Buy/Sell)
  const placeTrade = useMutation({
    mutationFn: (data) => post(`/admin/users/${trader.id}/portfolio/orders`, data),
    onSuccess: (data) => {
      notify.success(`Order filled: ${data.side} ${data.quantity} ${data.symbol}`);
      setShares('1');
      refetchPositions();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  // 5. Update Cash / Performance Target
  const updateCash = useMutation({
    mutationFn: (cashBalanceCents) =>
      patch(`/admin/users/${trader.id}/portfolio/cash`, { cashBalanceCents }),
    onSuccess: () => {
      notify.success('Portfolio return target updated');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      refetchPositions();
    },
    onError: (err) => notify.apiError(err),
  });

  if (!trader) return null;

  // File picker handler
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAvatarMutation.mutate(file);
    e.target.value = '';
  };

  // Add Funds handler
  const handleAddFunds = (amount = fundAmount) => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      notify.error('Please enter a valid positive dollar amount');
      return;
    }
    addFundsMutation.mutate(parsed);
  };

  // Trade Execution handler
  const handleTrade = (side) => {
    if (!selectedSymbol) {
      notify.error('Please select an instrument to trade');
      return;
    }
    const q = parseFloat(shares);
    if (!q || q <= 0) {
      notify.error('Please specify a positive quantity');
      return;
    }
    if (selectedAsset?.assetClass === 'stocks' && !Number.isInteger(q)) {
      notify.error('Equities must be traded in whole units of shares');
      return;
    }
    placeTrade.mutate({ symbol: selectedSymbol, side, quantity: q });
  };

  // Performance Target handler
  const targetPortfolio = Math.round(SEED_CASH_CENTS * (1 + parseFloat(returnPct || 0) / 100));
  const targetCash = Math.max(0, targetPortfolio - currentHoldingsValue);
  const cashDelta = targetCash - currentCash;

  const handleApplyPerformance = () => {
    updateCash.mutate(Math.round(targetCash));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Manage User: ${trader.displayName || trader.username}`}
      className="w-[min(46rem,calc(100vw-2rem))] max-h-[92vh] overflow-y-auto"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-2xs text-text-muted">
            All actions immediately update live orders, ledger records, and rankings.
          </span>
          <Button variant="secondary" onClick={onClose} size="sm">
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* PROFILE HEADER & AVATAR MANAGEMENT */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cool-grey bg-mist/60 p-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar
                name={trader.username}
                src={avatarUrl || undefined}
                size={60}
                className="ring-2 ring-cool-grey shadow-sm"
              />
              {uploadAvatarMutation.isPending && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink/60 text-white text-xs font-medium">
                  ...
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-void text-base">
                  {trader.displayName || trader.username}
                </span>
                <Badge variant={statusVariant(trader.status)}>{trader.status}</Badge>
                {trader.role === 'admin' && <Badge variant="amber">Admin</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-text-muted font-mono">{trader.email}</div>
              <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
                <span>@{trader.username}</span>
                <span>•</span>
                <span>{trader.tradeCount} lifetime trades</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploadAvatarMutation.isPending}
            >
              <Icon name="plus" size={14} className="mr-1.5" />
              {avatarUrl ? 'Change Photo' : 'Upload Photo'}
            </Button>
            {Boolean(avatarUrl) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removeAvatarMutation.mutate()}
                loading={removeAvatarMutation.isPending}
                className="text-loss border-loss/30 hover:bg-loss/10"
              >
                <Icon name="trash" size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* LIVE METRICS STRIP */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-cool-grey bg-white p-3 shadow-card">
            <div className="text-2xs text-text-muted">Portfolio Value</div>
            <div className="mt-0.5 font-numeric text-base font-semibold tabular-nums text-void">
              {money(currentPortfolioValue)}
            </div>
          </div>
          <div className="rounded-lg border border-cool-grey bg-white p-3 shadow-card">
            <div className="text-2xs text-text-muted">Buying Power (Cash)</div>
            <div className="mt-0.5 font-numeric text-base font-semibold tabular-nums text-gain">
              {money(currentCash)}
            </div>
          </div>
          <div className="rounded-lg border border-cool-grey bg-white p-3 shadow-card">
            <div className="text-2xs text-text-muted">Active Holdings</div>
            <div className="mt-0.5 font-numeric text-base font-semibold tabular-nums text-void">
              {money(currentHoldingsValue)}
            </div>
          </div>
          <div className="rounded-lg border border-cool-grey bg-white p-3 shadow-card">
            <div className="text-2xs text-text-muted">All-Time Return</div>
            <div
              className={`mt-0.5 font-numeric text-base font-semibold tabular-nums ${
                liveReturnPct >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {pct(liveReturnPct)}
            </div>
          </div>
        </div>

        {/* TAB CONTROLS */}
        <SegmentedControl
          size="sm"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'trade', label: 'Trade Assets' },
            { value: 'funds', label: 'Add Funds' },
            { value: 'performance', label: 'Return Target' },
          ]}
          className="w-full justify-center"
        />

        {/* TAB 1: ASSET TRADING (BUY & SELL) */}
        {activeTab === 'trade' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-cool-grey bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cool-grey/60 pb-3 mb-3">
                <span className="text-sm font-semibold text-void">Live Order Ticket</span>
                <div className="flex gap-1.5 text-2xs">
                  {['all', 'stocks', 'crypto', 'forex'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-md font-medium uppercase transition-colors ${
                        categoryFilter === cat
                          ? 'bg-ink text-white'
                          : 'bg-mist text-text-muted hover:text-text-body'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Instrument Picker & Qty */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-2xs font-medium text-text-muted">
                    Tradable Instrument
                  </label>
                  <select
                    className="w-full rounded-md border border-cool-grey bg-white px-3 py-2 text-sm text-text-body focus:border-void focus:outline-none"
                    value={selectedSymbol}
                    onChange={(e) => {
                      const sym = e.target.value;
                      setSelectedSymbol(sym);
                      const asset = allAssets.find((a) => a.symbol === sym);
                      if (asset?.assetClass === 'stocks') {
                        setShares('1');
                      } else {
                        setShares('0.1');
                      }
                    }}
                  >
                    <option value="">Choose stock, crypto, or forex...</option>
                    {filteredAssets.map((p) => {
                      const tag = (p.assetClass || 'stocks').toUpperCase();
                      const ownedText = p.held ? ' [HELD]' : '';
                      return (
                        <option key={p.symbol} value={p.symbol}>
                          [{tag}] {p.symbol} — {p.name} {ownedText}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-2xs font-medium text-text-muted">
                    Quantity / Units
                  </label>
                  <Input
                    type="number"
                    step={selectedAsset?.assetClass === 'stocks' ? '1' : 'any'}
                    min={selectedAsset?.assetClass === 'stocks' ? '1' : '0.0001'}
                    placeholder={selectedAsset?.assetClass === 'stocks' ? 'e.g. 10' : 'e.g. 0.25'}
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                  />
                </div>
              </div>

              {/* Selected Instrument Live Preview Strip */}
              {selectedAsset && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold text-void">{selectedAsset.symbol}</span>
                    <span className="ml-1.5 text-text-muted">({selectedAsset.name})</span>
                    <span className="ml-2 font-mono text-gain font-semibold">
                      {money(orderPriceCents)}
                    </span>
                  </div>
                  <div className="text-text-muted">
                    {userHeldPosition ? (
                      <span>
                        Currently holding:{' '}
                        <strong className="text-void">
                          {userHeldPosition.shares} units ({money(userHeldPosition.valueCents)})
                        </strong>
                      </span>
                    ) : (
                      <span>No existing position</span>
                    )}
                  </div>
                </div>
              )}

              {/* Order Estimate & Buy/Sell Action Buttons */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cool-grey/60 pt-3">
                <div className="text-xs">
                  <span className="text-text-muted">Estimated Order Total: </span>
                  <strong className="font-numeric text-sm font-semibold tabular-nums text-void">
                    {money(estTotalCents)}
                  </strong>
                  {isOverBudget && (
                    <span className="ml-2 text-amber text-2xs">
                      (Exceeds buying power — add funds first)
                    </span>
                  )}
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    onClick={() => handleTrade('BUY')}
                    loading={placeTrade.isPending}
                    disabled={!selectedSymbol || numQty <= 0}
                    className="flex-1 sm:flex-initial bg-gain hover:bg-gain/90 text-white font-semibold border-transparent"
                  >
                    Buy {selectedSymbol || 'Asset'}
                  </Button>
                  <Button
                    onClick={() => handleTrade('SELL')}
                    loading={placeTrade.isPending}
                    disabled={!selectedSymbol || numQty <= 0}
                    variant="secondary"
                    className="flex-1 sm:flex-initial border-loss text-loss hover:bg-loss/10 font-semibold"
                  >
                    Sell {selectedSymbol || 'Asset'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Current Open Positions Table */}
            <div className="rounded-xl border border-cool-grey bg-white p-4 shadow-card">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-cool-grey/60">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Current Open Positions ({heldList.length})
                </h3>
                <span className="text-xs font-numeric font-medium tabular-nums text-void">
                  Total: {money(currentHoldingsValue)}
                </span>
              </div>

              {heldList.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  No active holdings. Choose an asset above to place a BUY order.
                </div>
              ) : (
                <div className="divide-y divide-cool-grey/60 max-h-56 overflow-y-auto">
                  {heldList.map((h) => (
                    <div
                      key={h.symbol}
                      className="flex items-center justify-between py-2.5 px-1 text-xs hover:bg-mist/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex size-7 items-center justify-center rounded-md bg-mist font-semibold text-void">
                          {h.symbol.slice(0, 3)}
                        </span>
                        <div>
                          <div className="font-semibold text-void">{h.symbol}</div>
                          <div className="text-2xs text-text-muted">
                            {h.shares} units · {h.assetClass || 'stocks'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-numeric font-semibold tabular-nums text-void">
                            {money(h.valueCents)}
                          </div>
                          <div
                            className={`font-numeric text-2xs tabular-nums ${
                              (h.returnPct ?? 0) >= 0 ? 'text-gain' : 'text-loss'
                            }`}
                          >
                            {pct(h.returnPct ?? 0)}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSymbol(h.symbol);
                            setShares(String(h.shares));
                          }}
                          className="rounded border border-cool-grey px-2.5 py-1 text-2xs font-medium text-void hover:bg-mist transition-colors cursor-pointer"
                        >
                          Trade
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ADD FUNDS & BUYING POWER */}
        {activeTab === 'funds' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-cool-grey bg-white p-5 shadow-card">
              <div className="flex items-center justify-between border-b border-cool-grey/60 pb-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-void">Deposit Virtual Capital</h3>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Credit buying power directly to this account with no upper limit.
                  </p>
                </div>
                <Badge variant="approved">Unlimited</Badge>
              </div>

              {/* Quick Chip Shortcuts */}
              <label className="block text-2xs font-medium text-text-muted mb-2">
                Quick Selection (USD)
              </label>
              <div className="flex flex-wrap gap-2 mb-4">
                {QUICK_FUNDS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setFundAmount(String(amt))}
                    className="rounded-lg border border-cool-grey bg-mist px-3 py-1.5 text-xs font-semibold text-void hover:border-void hover:bg-white transition-all cursor-pointer"
                  >
                    +${amt >= 1000000 ? `${amt / 1000000}M` : `${amt / 1000}k`}
                  </button>
                ))}
              </div>

              {/* Amount Input */}
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-2xs font-medium text-text-muted mb-1">
                    Amount to Deposit ($ USD)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 25000"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => handleAddFunds()}
                  loading={addFundsMutation.isPending}
                  disabled={!fundAmount || parseFloat(fundAmount) <= 0}
                  className="bg-gain hover:bg-gain/90 text-white font-semibold whitespace-nowrap"
                >
                  <Icon name="plus" size={16} className="mr-1.5" />
                  Add to Buying Power
                </Button>
              </div>

              {/* Preview Notice */}
              {Boolean(parseFloat(fundAmount || 0)) && (
                <div className="mt-4 rounded-lg bg-green-tint/50 border border-gain/20 p-3 text-xs text-gain">
                  New Buying Power after deposit:{' '}
                  <strong>
                    {money(currentCash + Math.round(parseFloat(fundAmount) * 100))}
                  </strong>{' '}
                  (ready for immediate stock, crypto, or commodity trading).
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: RETURN TARGET & CALIBRATION */}
        {activeTab === 'performance' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-cool-grey bg-white p-5 shadow-card">
              <div className="border-b border-cool-grey/60 pb-3 mb-4">
                <h3 className="text-sm font-semibold text-void">Calibrate All-Time Return</h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  Set a specific all-time return percentage. The platform balances uninvested cash
                  against active holdings so the user ranks accurately on the leaderboard.
                </p>
              </div>

              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-2xs font-medium text-text-muted mb-1">
                    Target All-Time Return (%)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={returnPct}
                    onChange={(e) => setReturnPct(e.target.value)}
                    placeholder="e.g. 45.0"
                  />
                </div>
                <Button
                  onClick={handleApplyPerformance}
                  loading={updateCash.isPending}
                  className="whitespace-nowrap"
                >
                  Apply Return Target
                </Button>
              </div>

              {/* Live Arithmetic Breakdown Card */}
              <div className="mt-5 rounded-xl border border-cool-grey bg-mist p-4">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                  Accounting & Rebalancing Breakdown
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-text-muted">Base Contributed Capital:</span>
                    <div className="font-semibold text-void">{money(SEED_CASH_CENTS)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Current Portfolio Value:</span>
                    <div className="font-semibold text-void">{money(currentPortfolioValue)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Computed Target Portfolio:</span>
                    <div className="font-semibold text-gain font-numeric">
                      {money(targetPortfolio)} ({pct(parseFloat(returnPct || 0))})
                    </div>
                  </div>
                  <div>
                    <span className="text-text-muted">Cash Adjustment Required:</span>
                    <div
                      className={`font-semibold font-numeric ${
                        cashDelta >= 0 ? 'text-gain' : 'text-loss'
                      }`}
                    >
                      {cashDelta >= 0 ? `+${money(cashDelta)}` : money(cashDelta)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
