import type { NetworkType } from '../lib/constants';
import {
  useLedgerStream,
  useFeeStats,
  useOperations,
  useLumenSupply,
  useHistoricalLedgers,
} from '../hooks/useHorizon';
import { NetworkStatus } from './NetworkStatus';
import { FeeStats } from './FeeStats';
import { LumenSupply } from './LumenSupply';
import { RecentOperations } from './RecentOperations';
import { LedgerCloseChart } from './LedgerCloseChart';
import { TransactionsChart, SuccessfulFailedChart } from './TransactionsChart';
import { HistoricalChart } from './HistoricalChart';
import { FriendbotBalance } from './AccountBalance';

interface NetworkPanelProps {
  network: NetworkType;
  // Suffix section titles with the network name when several networks are shown
  labelSections?: boolean;
}

export function NetworkPanel({ network, labelSections = false }: NetworkPanelProps) {
  const isMainnet = network === 'mainnet';
  const networkLabel = isMainnet ? 'Live Network' : 'Test Network';
  const title = (name: string) => (labelSections ? `${name} — ${networkLabel}` : name);

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
      {/* Network Status Section */}
      <section className="dashboard-section">
        <h2 className="section-title">
          {networkLabel}
          {isStreaming && <span className="live-indicator">Live</span>}
        </h2>
        <div className="dashboard-grid">
          <NetworkStatus ledgers={ledgers} network={network} isLoading={ledgers.length === 0} />
          <FeeStats feeStats={feeStats} network={network} isLoading={feeStatsLoading} />
        </div>
      </section>

      {/* Charts Section */}
      <section className="dashboard-section">
        <h2 className="section-title">{title('Network Activity')}</h2>
        <div className="dashboard-grid">
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
        <h2 className="section-title">{title('Recent Operations')}</h2>
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
