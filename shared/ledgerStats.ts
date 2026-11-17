import type { LedgerRecord, NetworkStatus } from './types.ts';
import { LEDGERS_FOR_CHARTS, LEDGERS_IN_AVERAGE } from './networks.ts';

export interface LedgerStats extends NetworkStatus {
  txPerSecond: number;
  opsPerSecond: number;
  failedTxRate: number;
  // Number of ledgers the throughput figures are measured over
  throughputWindow: number;
  avgWindow: number;
}

const secondsBetween = (later: LedgerRecord, earlier: LedgerRecord) =>
  (new Date(later.closed_at).getTime() - new Date(earlier.closed_at).getTime()) / 1000;

// Derive status and throughput figures from ledgers ordered newest first
export const computeLedgerStats = (ledgers: LedgerRecord[], now: number): LedgerStats | null => {
  if (!ledgers.length) return null;

  const latest = ledgers[0];
  const secondsSinceLastLedger = Math.max(0, (now - new Date(latest.closed_at).getTime()) / 1000);
  const lastLedgerDuration = ledgers.length > 1 ? secondsBetween(latest, ledgers[1]) : null;

  const avgLedgers = ledgers.slice(0, LEDGERS_IN_AVERAGE);
  const avgLedgerCloseTime = avgLedgers.length > 1
    ? secondsBetween(avgLedgers[0], avgLedgers[avgLedgers.length - 1]) / (avgLedgers.length - 1)
    : 5;

  // Each ledger's transactions happened in the interval since the previous
  // ledger, so N ledgers span N - 1 intervals: count the newest N - 1.
  const window = ledgers.slice(0, LEDGERS_FOR_CHARTS + 1);
  const counted = window.slice(0, -1);
  const span = window.length > 1 ? secondsBetween(window[0], window[window.length - 1]) : 0;
  const successfulTxs = counted.reduce((sum, l) => sum + l.successful_transaction_count, 0);
  const failedTxs = counted.reduce((sum, l) => sum + l.failed_transaction_count, 0);
  const operations = counted.reduce((sum, l) => sum + l.operation_count, 0);
  const totalTxs = successfulTxs + failedTxs;

  let status: NetworkStatus['status'] = 'operational';
  if (secondsSinceLastLedger > 60) status = 'down';
  else if (secondsSinceLastLedger > 20) status = 'very_slow';
  else if (secondsSinceLastLedger > 10) status = 'slow';

  return {
    status,
    protocolVersion: latest.protocol_version,
    lastLedgerSequence: latest.sequence,
    lastLedgerCloseTime: latest.closed_at,
    avgLedgerCloseTime,
    secondsSinceLastLedger,
    lastLedgerDuration,
    txPerSecond: span > 0 ? successfulTxs / span : 0,
    opsPerSecond: span > 0 ? operations / span : 0,
    failedTxRate: totalTxs > 0 ? failedTxs / totalTxs : 0,
    throughputWindow: counted.length,
    avgWindow: avgLedgers.length,
  };
};

export const STATUS_CONFIG: Record<NetworkStatus['status'], { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'success' },
  slow: { label: 'Slow', className: 'warning' },
  very_slow: { label: 'Very Slow', className: 'warning' },
  down: { label: 'Down', className: 'error' },
};
