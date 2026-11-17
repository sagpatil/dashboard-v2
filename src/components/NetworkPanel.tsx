import type { ReactNode } from 'react';
import type { NetworkType } from '../lib/constants';
import {
  useLedgerStream,
  useFeeStats,
  useOperations,
  useLumenSupply,
  useHistoricalLedgers,
} from '../hooks/useHorizon';
import { KpiStrip } from './KpiStrip';
import { FeeStats } from './FeeStats';
import { LumenSupply } from './LumenSupply';
import { RecentOperations } from './RecentOperations';
import { LedgerCloseChart } from './LedgerCloseChart';
import { TransactionsChart, SuccessfulFailedChart } from './TransactionsChart';
import { HistoricalChart } from './HistoricalChart';
import { FriendbotBalance } from './AccountBalance';

interface NetworkPanelProps {
  network: NetworkType;
  // Rendered right after the headline section, e.g. another network's summary
  children?: ReactNode;
}

export function NetworkPanel({ network, children }: NetworkPanelProps) {
  const isMainnet = network === 'mainnet';
  const networkLabel = isMainnet ? 'Live Network' : 'Test Network';

  // Ledger streaming
  const { ledgers, isStreaming } = useLedgerStream(network);

  // Fee stats
  const { data: feeStats, isLoading: feeStatsLoading } = useFeeStats(network);

  // Recent operations
  const { data: operations = [], isLoading: operationsLoading } = useOperations(network, 20);

  // Lumen supply and historical data are mainnet only
  const { data: lumenSupply, isLoading: lumenSupplyLoading } = useLumenSupply();
  const { data: historicalLedgers, isLoading: historicalLoading } = useHistoricalLedgers();

  return (
    <>
      {/* Headline numbers */}
      <section className="dashboard-section">
        <h2 className="section-title">
          {networkLabel}
          {isStreaming && <span className="live-indicator">Live</span>}
        </h2>
        <div className="dashboard-grid">
          <KpiStrip ledgers={ledgers} feeStats={feeStats} network={network} />
        </div>
      </section>

      {children}

      {/* Charts Section */}
      <section className="dashboard-section">
        <h2 className="section-title">Network Activity</h2>
        <div className="dashboard-grid">
          <FeeStats feeStats={feeStats} network={network} isLoading={feeStatsLoading} />
          <LedgerCloseChart ledgers={ledgers} network={network} isLoading={ledgers.length === 0} />
          <TransactionsChart ledgers={ledgers} network={network} isLoading={ledgers.length === 0} />
          <SuccessfulFailedChart ledgers={ledgers} network={network} isLoading={ledgers.length === 0} />
          {isMainnet && (
            <HistoricalChart data={historicalLedgers} isLoading={historicalLoading} />
          )}
        </div>
      </section>

      {isMainnet && (
        <section className="dashboard-section">
          <h2 className="section-title">Lumen Supply</h2>
          <div className="dashboard-grid">
            <LumenSupply supply={lumenSupply} isLoading={lumenSupplyLoading} />
          </div>
        </section>
      )}

      {!isMainnet && (
        <section className="dashboard-section">
          <h2 className="section-title">Testnet Accounts</h2>
          <div className="dashboard-grid">
            <FriendbotBalance />
          </div>
        </section>
      )}

      {/* Recent Operations Section */}
      <section className="dashboard-section">
        <h2 className="section-title">Recent Operations</h2>
        <div className="dashboard-grid">
          <RecentOperations 
            operations={operations} 
            network={network}
            isLoading={operationsLoading} 
          />
        </div>
      </section>
    </>
  );
}
