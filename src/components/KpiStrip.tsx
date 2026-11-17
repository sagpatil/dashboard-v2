import { useMemo } from 'react';
import type { FeeStats, LedgerRecord } from '../types';
import { computeLedgerStats, STATUS_CONFIG } from '../lib/ledgerStats';
import { formatFee, formatNumber, formatSeconds } from '../lib/format';
import { getHorizonUrl, LEDGERS_IN_AVERAGE } from '../lib/constants';
import type { NetworkType } from '../lib/constants';
import { useNow } from '../hooks/useHorizon';
import { ApiLink } from './ApiLink';
import { KpiTile } from './KpiTile';

interface KpiStripProps {
  ledgers: LedgerRecord[];
  feeStats: FeeStats | undefined;
  network: NetworkType;
}

export function KpiStrip({ ledgers, feeStats, network }: KpiStripProps) {
  const now = useNow();
  const stats = useMemo(() => computeLedgerStats(ledgers, now), [ledgers, now]);

  if (!stats) {
    return (
      <div className="card col-span-12">
        <div className="kpi-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton skeleton-value" />
          ))}
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[stats.status];
  const capacity = feeStats ? parseFloat(feeStats.ledger_capacity_usage) : null;
  const throughputNote = `Over the last ${stats.throughputWindow} ledgers`;

  return (
    <div className="card col-span-12 kpi-card">
      <div className="kpi-grid">
        <KpiTile
          label="Status"
          value={
            <span className={`card-badge ${status.className}`}>
              <span className={`status-indicator ${status.className}`} />
              {status.label}
            </span>
          }
          detail={`Protocol ${stats.protocolVersion}`}
        />
        <KpiTile
          label="Last Ledger"
          value={<span className="mono">{formatNumber(stats.lastLedgerSequence)}</span>}
          detail={
            `${Math.floor(stats.secondsSinceLastLedger)}s ago` +
            (stats.lastLedgerDuration !== null ? ` · in ${formatSeconds(stats.lastLedgerDuration)}` : '')
          }
        />
        <KpiTile
          label="Avg Close"
          value={formatSeconds(stats.avgLedgerCloseTime)}
          detail={`last ${stats.avgWindow} ledgers`}
        />
        <KpiTile
          label="Tx / sec"
          value={stats.txPerSecond.toFixed(1)}
          detail="successful"
          title={throughputNote}
        />
        <KpiTile
          label="Ops / sec"
          value={stats.opsPerSecond.toFixed(1)}
          title={throughputNote}
        />
        <KpiTile
          label="Failed Txs"
          value={`${(stats.failedTxRate * 100).toFixed(1)}%`}
          title={throughputNote}
        />
        <KpiTile
          label="Capacity"
          value={capacity !== null ? `${Math.round(capacity * 100)}%` : '—'}
          detail="last 5 ledgers"
          tone={capacity !== null && capacity > 0.9 ? 'warning' : undefined}
        />
        <KpiTile
          label="Median Fee"
          value={feeStats ? formatFee(feeStats.fee_charged.p50) : '—'}
          detail={feeStats ? `p90 ${formatFee(feeStats.fee_charged.p90)} stroops` : undefined}
        />
      </div>
      <div className="kpi-api">
        <ApiLink href={`${getHorizonUrl(network)}/ledgers?order=desc&limit=${LEDGERS_IN_AVERAGE}`} />
      </div>
    </div>
  );
}
