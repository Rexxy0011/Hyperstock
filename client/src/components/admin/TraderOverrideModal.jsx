import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { del, post, patch, get } from '../../lib/api';
import { money, pct } from '../../lib/format';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import notify from '../../lib/toast';

export default function TraderOverrideModal({ open, onClose, trader }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [returnPct, setReturnPct] = useState('0');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [shares, setShares] = useState('1');
  
  // Seed cash is always 10,000 for new users
  const SEED_CASH = 1000000; 

  const { data: positions, refetch: refetchPositions } = useQuery({
    queryKey: ['adminPositions', trader?.id],
    queryFn: () => get(`/admin/positions?userId=${trader?.id}`),
    enabled: Boolean(trader?.id && open),
  });

  const updateCash = useMutation({
    mutationFn: (cashBalanceCents) =>
      patch(`/admin/users/${trader.id}/portfolio/cash`, { cashBalanceCents }),
    onSuccess: () => {
      notify.success("Portfolio updated");
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      onClose();
    },
    onError: (err) => notify.apiError(err),
  });

  const addPos = useMutation({
    mutationFn: (data) => post(`/admin/users/${trader.id}/portfolio/holdings`, data),
    onSuccess: () => {
      notify.success("Position added");
      refetchPositions();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  const removePos = useMutation({
    mutationFn: (symbol) => del(`/admin/users/${trader.id}/portfolio/holdings/${symbol}`),
    onSuccess: () => {
      notify.success("Position removed");
      refetchPositions();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => notify.apiError(err),
  });

  if (!trader) return null;

  const currentHoldingsValue = positions?.held?.reduce((sum, h) => sum + h.valueCents, 0) || 0;
  
  const handleSave = () => {
    // If they typed a return %, compute target portfolio value
    const targetPortfolio = SEED_CASH * (1 + (parseFloat(returnPct || 0) / 100));
    const targetCash = Math.max(0, targetPortfolio - currentHoldingsValue);
    updateCash.mutate(Math.round(targetCash));
  };

  const handleAddPosition = () => {
    if (!selectedSymbol || !shares) return;
    addPos.mutate({ symbol: selectedSymbol, shares: Number(shares) });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Portfolio: ${trader.displayName || trader.username}`}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="ml-auto flex gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} loading={updateCash.isPending}>
              Update Cash Balance
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="rounded-md border border-cool-grey bg-mist px-3 py-2.5">
          <div className="text-2xs text-text-muted">Target All-Time Return (%)</div>
          <Input 
            type="number" 
            value={returnPct} 
            onChange={(e) => setReturnPct(e.target.value)} 
            placeholder="e.g. 50"
          />
          <div className="mt-2 text-sm">
            Computed Target Portfolio Value: <strong className="tabular-nums">{money(SEED_CASH * (1 + (parseFloat(returnPct || 0) / 100)))}</strong>
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Saving will adjust the uninvested cash balance to hit this portfolio value exactly, accounting for current positions.
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-void">Manage Positions</h3>
          
          <div className="flex gap-2">
            <select 
              className="flex-1 rounded-md border border-cool-grey bg-white px-2 py-2 text-sm"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            >
              <option value="">Select Asset...</option>
              {positions?.available?.map(p => (
                <option key={p.symbol} value={p.symbol}>{p.symbol} - {p.name}</option>
              ))}
            </select>
            <Input type="number" placeholder="Shares" value={shares} onChange={(e)=>setShares(e.target.value)} />
            <Button onClick={handleAddPosition} loading={addPos.isPending} disabled={!selectedSymbol}>Add</Button>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            {positions?.held?.length === 0 && <span className="text-sm text-text-muted">No positions.</span>}
            {positions?.held?.map(h => (
              <div key={h.symbol} className="flex items-center justify-between rounded-md border border-slate/10 bg-slate/5 px-3 py-2 text-sm">
                <div>
                  <span className="font-semibold">{h.symbol}</span>
                  <span className="ml-2 text-text-muted tabular-nums">{money(h.valueCents)}</span>
                </div>
                <button 
                  onClick={() => removePos.mutate(h.symbol)}
                  className="text-xs text-loss underline hover:opacity-80"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Modal>
  );
}
