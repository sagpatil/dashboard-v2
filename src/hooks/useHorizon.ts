import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { LEDGERS_IN_AVERAGE } from '../lib/constants';
import type { NetworkType } from '../lib/constants';
import { apiUrl, getJson } from '../lib/api';
import type {
  AccountBalance,
  LedgerRecord,
  LedgerStreamSnapshot,
  OperationRecord,
  FeeStats,
  LumenSupplyV2,
  LedgerStat,
  StatusPageSummary,
  StatusPageIncidents,
} from '../types';

const EMPTY_LEDGERS: LedgerRecord[] = [];

// All data comes from the dashboard API server (see server/), which holds one
// connection per upstream and caches responses for every visitor.

// Live ledgers, newest first, from the server's event stream. The server sends
// its buffered ledgers on connect, so a reconnect needs no separate backfill.
export const useLedgerStream = (network: NetworkType) => {
  // Tagged with the network so switching networks never shows the old one's data
  const [state, setState] = useState<{ network: NetworkType; ledgers: LedgerRecord[]; open: boolean }>(
    { network, ledgers: [], open: false },
  );

  useEffect(() => {
    // EventSource reconnects on its own (the server sets the retry delay)
    const source = new EventSource(apiUrl(`/networks/${network}/ledgers/stream`));

    source.addEventListener('snapshot', event => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as LedgerStreamSnapshot;
      setState({ network, ledgers: snapshot.ledgers, open: true });
    });

    source.addEventListener('ledger', event => {
      const ledger = JSON.parse((event as MessageEvent<string>).data) as LedgerRecord;
      setState(prev => {
        if (prev.network !== network || prev.ledgers.some(l => l.sequence === ledger.sequence)) {
          return prev;
        }
        const ledgers = [ledger, ...prev.ledgers]
          .sort((a, b) => b.sequence - a.sequence)
          .slice(0, LEDGERS_IN_AVERAGE);
        return { ...prev, ledgers };
      });
    });

    source.onerror = () => setState(prev => (prev.network === network ? { ...prev, open: false } : prev));

    return () => source.close();
  }, [network]);

  const current = state.network === network;
  return {
    ledgers: current ? state.ledgers : EMPTY_LEDGERS,
    isStreaming: current && state.open,
  };
};

// Recent operations
export const useOperations = (network: NetworkType, limit = 20) =>
  useQuery({
    queryKey: ['operations', network, limit],
    queryFn: () => getJson<OperationRecord[]>(`/networks/${network}/operations?limit=${limit}`),
    refetchInterval: 5000,
    staleTime: 0,
  });

// Fee stats
export const useFeeStats = (network: NetworkType) =>
  useQuery({
    queryKey: ['feeStats', network],
    queryFn: () => getJson<FeeStats>(`/networks/${network}/fee-stats`),
    refetchInterval: 5000,
  });

// XLM balance of an account
export const useAccountBalance = (network: NetworkType, accountId: string) =>
  useQuery({
    queryKey: ['account', network, accountId],
    queryFn: async () =>
      (await getJson<AccountBalance>(`/networks/${network}/accounts/${accountId}/balance`)).balance,
    refetchInterval: 60000,
  });

// Lumen supply (mainnet)
export const useLumenSupply = (enabled = true) =>
  useQuery({
    queryKey: ['lumenSupply'],
    queryFn: () => getJson<LumenSupplyV2>('/lumens'),
    refetchInterval: 300000,
    staleTime: 300000,
    enabled,
  });

// Daily transaction and operation counts (mainnet)
export const useHistoricalLedgers = (enabled = true) =>
  useQuery({
    queryKey: ['historicalLedgers'],
    queryFn: () => getJson<LedgerStat[]>('/history/daily'),
    refetchInterval: 3600000,
    staleTime: 3600000,
    enabled,
  });

// StatusPage summary: overall status, active incidents and maintenances
export const useStatusPage = () =>
  useQuery({
    queryKey: ['statusPage'],
    queryFn: () => getJson<StatusPageSummary>('/status/summary'),
    refetchInterval: 60000,
  });

// StatusPage incident history (includes resolved incidents)
export const useIncidentHistory = () =>
  useQuery({
    queryKey: ['incidentHistory'],
    queryFn: () => getJson<StatusPageIncidents>('/status/incidents'),
    refetchInterval: 300000,
  });

// Current time, updated every second, for live "ago" labels
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
};
