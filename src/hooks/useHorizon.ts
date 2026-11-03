import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  getHorizonUrl,
  DASHBOARD_API,
  STATUSPAGE_API,
  STATUSPAGE_INCIDENTS_API,
  LEDGERS_FOR_CHARTS,
  LEDGERS_IN_AVERAGE,
} from '../lib/constants';
import type { NetworkType } from '../lib/constants';
import type {
  LedgerRecord,
  OperationRecord,
  FeeStats,
  LumenSupplyV2,
  LedgerStat,
  StatusPageSummary,
  StatusPageIncidents,
  HorizonResponse,
} from '../types';

// Fetch ledgers
export const useLedgers = (network: NetworkType, limit = LEDGERS_FOR_CHARTS) => {
  const horizonUrl = getHorizonUrl(network);
  
  return useQuery({
    queryKey: ['ledgers', network, limit],
    queryFn: async (): Promise<LedgerRecord[]> => {
      const response = await fetch(
        `${horizonUrl}/ledgers?order=desc&limit=${limit}`
      );
      if (!response.ok) throw new Error('Failed to fetch ledgers');
      const data: HorizonResponse<LedgerRecord> = await response.json();
      return data._embedded.records;
    },
    refetchInterval: 5000,
  });
};

// Streaming ledgers hook
// Keeps the latest LEDGERS_IN_AVERAGE ledgers, newest first, de-duplicated by sequence
export const useLedgerStream = (network: NetworkType) => {
  const [ledgers, setLedgers] = useState<LedgerRecord[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const horizonUrl = getHorizonUrl(network);

  useEffect(() => {
    let cancelled = false;
    let closeStream: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 5000;

    setLedgers([]);
    setIsStreaming(false);

    const scheduleRetry = () => {
      if (cancelled) return;
      closeStream?.();
      closeStream = null;
      setIsStreaming(false);
      retryTimer = setTimeout(startStream, retryDelay);
      // Back off up to a minute so a rate-limited Horizon isn't hammered
      retryDelay = Math.min(retryDelay * 2, 60000);
    };

    const startStream = async () => {
      try {
        const response = await fetch(`${horizonUrl}/ledgers?order=desc&limit=${LEDGERS_IN_AVERAGE}`);
        if (!response.ok) throw new Error('Failed to fetch initial ledgers');
        const data: HorizonResponse<LedgerRecord> = await response.json();
        if (cancelled) return;

        const records = data._embedded.records;
        setLedgers(records);

        const server = new StellarSdk.Horizon.Server(horizonUrl);
        closeStream = server
          .ledgers()
          .cursor(records[0]?.paging_token ?? 'now')
          .stream({
            onmessage: (message: unknown) => {
              retryDelay = 5000;
              const ledger = message as LedgerRecord;
              setLedgers(prev => {
                if (prev.some(l => l.sequence === ledger.sequence)) return prev;
                return [ledger, ...prev]
                  .sort((a, b) => b.sequence - a.sequence)
                  .slice(0, LEDGERS_IN_AVERAGE);
              });
            },
            onerror: () => {
              console.warn('Ledger stream error');
              scheduleRetry();
            },
          });
        setIsStreaming(true);
      } catch (error) {
        console.error('Failed to start ledger stream:', error);
        scheduleRetry();
      }
    };

    startStream();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      closeStream?.();
    };
  }, [horizonUrl]);

  return { ledgers, isStreaming };
};

// Fetch recent operations
// Polled rather than streamed: a single ledger can hold hundreds of operations,
// which a Horizon stream delivers slower than the network produces them.
export const useOperations = (network: NetworkType, limit = 20) => {
  const horizonUrl = getHorizonUrl(network);

  return useQuery({
    queryKey: ['operations', network, limit],
    queryFn: async (): Promise<OperationRecord[]> => {
      const response = await fetch(
        `${horizonUrl}/operations?order=desc&limit=${limit}`
      );
      if (!response.ok) throw new Error('Failed to fetch operations');
      const data: HorizonResponse<OperationRecord> = await response.json();
      return data._embedded.records;
    },
    refetchInterval: 5000,
    staleTime: 0,
  });
};

// Fetch fee stats
export const useFeeStats = (network: NetworkType) => {
  const horizonUrl = getHorizonUrl(network);
  
  return useQuery({
    queryKey: ['feeStats', network],
    queryFn: async (): Promise<FeeStats> => {
      const response = await fetch(`${horizonUrl}/fee_stats`);
      if (!response.ok) throw new Error('Failed to fetch fee stats');
      return response.json();
    },
    refetchInterval: 5000,
  });
};

// Fetch account balance
export const useAccountBalance = (network: NetworkType, accountId: string) => {
  const horizonUrl = getHorizonUrl(network);
  
  return useQuery({
    queryKey: ['account', network, accountId],
    queryFn: async (): Promise<string> => {
      const response = await fetch(`${horizonUrl}/accounts/${accountId}`);
      if (!response.ok) {
        if (response.status === 404) return '0';
        throw new Error('Failed to fetch account');
      }
      const data = await response.json();
      const xlmBalance = data.balances.find(
        (b: { asset_type: string }) => b.asset_type === 'native'
      );
      return xlmBalance?.balance || '0';
    },
    refetchInterval: 60000, // Refresh every minute
  });
};

// Fetch lumen supply from dashboard API
export const useLumenSupply = () => {
  return useQuery({
    queryKey: ['lumenSupply'],
    queryFn: async (): Promise<LumenSupplyV2> => {
      const url = import.meta.env.DEV 
        ? '/api/dashboard/v2/lumens' 
        : `${DASHBOARD_API}/api/v2/lumens`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch lumen supply');
      return response.json();
    },
    refetchInterval: 300000, // Refresh every 5 minutes
    staleTime: 300000,
  });
};

// Fetch historical ledger data
export const useHistoricalLedgers = () => {
  return useQuery({
    queryKey: ['historicalLedgers'],
    queryFn: async (): Promise<LedgerStat[]> => {
      const url = import.meta.env.DEV 
        ? '/api/dashboard/ledgers/public' 
        : `${DASHBOARD_API}/api/ledgers/public`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch historical ledgers');
      return response.json();
    },
    refetchInterval: 3600000, // Refresh every hour
    staleTime: 3600000,
  });
};

// Fetch StatusPage data
export const useStatusPage = () => {
  return useQuery({
    queryKey: ['statusPage'],
    queryFn: async (): Promise<StatusPageSummary> => {
      // STATUSPAGE_API already handles dev vs prod URLs via proxy
      const response = await fetch(STATUSPAGE_API);
      if (!response.ok) throw new Error('Failed to fetch status');
      return response.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });
};

// Fetch StatusPage incident history (includes resolved incidents)
export const useIncidentHistory = () => {
  return useQuery({
    queryKey: ['incidentHistory'],
    queryFn: async (): Promise<StatusPageIncidents> => {
      const response = await fetch(STATUSPAGE_INCIDENTS_API);
      if (!response.ok) throw new Error('Failed to fetch incidents');
      return response.json();
    },
    refetchInterval: 300000, // Refresh every 5 minutes
  });
};

// Current time, updated every second, for live "ago" labels
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
};
