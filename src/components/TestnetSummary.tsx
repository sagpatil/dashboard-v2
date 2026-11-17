import { useMemo } from 'react';
import BigNumber from 'bignumber.js';
import { useAccountBalance, useLedgerStream, useNow } from '../hooks/useHorizon';
import { computeLedgerStats, STATUS_CONFIG } from '../lib/ledgerStats';
import { formatNumber, formatSeconds } from '../lib/format';
import { FRIENDBOT_ACCOUNT, HORIZON_TESTNET } from '../lib/constants';
import { KpiTile } from './KpiTile';

interface TestnetSummaryProps {
  onOpen: () => void;
}

// One-row testnet overview used when both networks are shown
export function TestnetSummary({ onOpen }: TestnetSummaryProps) {
  const { ledgers, isStreaming } = useLedgerStream('testnet');
  const { data: friendbotBalance } = useAccountBalance('testnet', FRIENDBOT_ACCOUNT);
  const now = useNow();
  const stats = useMemo(() => computeLedgerStats(ledgers, now), [ledgers, now]);
  const status = stats ? STATUS_CONFIG[stats.status] : null;

  return (
    <section className="dashboard-section">
      <h2 className="section-title">
        Test Network
        {isStreaming && <span className="live-indicator">Live</span>}
      </h2>
      <div className="dashboard-grid">
        <div className="card col-span-12 kpi-card">
          {!stats || !status ? (
            <div className="kpi-grid">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton skeleton-value" />
              ))}
            </div>
          ) : (
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
                detail={`${Math.floor(stats.secondsSinceLastLedger)}s ago`}
              />
              <KpiTile
                label="Avg Close"
                value={formatSeconds(stats.avgLedgerCloseTime)}
                detail={`last ${stats.avgWindow} ledgers`}
              />
              <KpiTile label="Tx / sec" value={stats.txPerSecond.toFixed(1)} detail="successful" />
              <KpiTile
                label="Friendbot"
                value={friendbotBalance ? formatNumber(new BigNumber(friendbotBalance), 0) : '—'}
                detail={
                  <a
                    href={`${HORIZON_TESTNET}/accounts/${FRIENDBOT_ACCOUNT}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    XLM balance
                  </a>
                }
              />
              <div className="kpi-tile kpi-action">
                <button className="link-button" onClick={onOpen}>
                  Full testnet view →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
