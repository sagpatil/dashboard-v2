import { useState } from 'react';
import type { NetworkView } from './lib/constants';
import { useStatusPage, useIncidentHistory } from './hooks/useHorizon';
import { NetworkPanel } from './components/NetworkPanel';
import { TestnetSummary } from './components/TestnetSummary';
import { Incidents } from './components/Incidents';
import { MaintenanceBanner } from './components/MaintenanceBanner';

const NETWORK_VIEWS: Array<{ value: NetworkView; label: string }> = [
  { value: 'both', label: 'Both' },
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'testnet', label: 'Testnet' },
];

function App() {
  const [view, setView] = useState<NetworkView>('both');
  
  // StatusPage
  const { data: statusPage, isLoading: statusLoading } = useStatusPage();
  const { data: incidentHistory } = useIncidentHistory();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="16" fill="var(--color-accent)"/>
            <path d="M22.5 10.5L9.5 16.5L22.5 22.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.5 10.5L22.5 16.5L9.5 22.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="app-header-title">Stellar Dashboard</span>
        </div>
        
        <div className="app-header-nav">
          <nav className="app-header-links">
            <a href="https://www.stellar.org/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            <a href="https://www.stellar.org/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            <a href="https://github.com/accordeiro/dashboard-v2" target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
          <div className="network-toggle">
            {NETWORK_VIEWS.map(({ value, label }) => (
              <button
                key={value}
                className={view === value ? 'active' : ''}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <MaintenanceBanner statusPage={statusPage} />

      <main className="app-main">
        {view !== 'testnet' && (
          <NetworkPanel network="mainnet">
            {view === 'both' && <TestnetSummary onOpen={() => setView('testnet')} />}
          </NetworkPanel>
        )}
        {view === 'testnet' && <NetworkPanel network="testnet" />}

        {/* Network Nodes Link */}
        <section className="dashboard-section">
          <h2 className="section-title">Network Nodes</h2>
          <div className="dashboard-grid">
            <div className="card col-span-12">
              <div className="card-header">
                <div className="card-title">Node Explorer</div>
              </div>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                Explore the Stellar network topology and validator nodes.
              </p>
              <a 
                href="https://stellarbeat.io" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'inline-block',
                  padding: '8px 16px',
                  background: 'var(--color-accent)',
                  color: 'white',
                  borderRadius: 6,
                  fontWeight: 500,
                  fontSize: 14,
                }}
              >
                View on Stellarbeat.io →
              </a>
            </div>
          </div>
        </section>

        {/* Status & Incidents */}
        <section className="dashboard-section">
          <h2 className="section-title">Status & Incidents</h2>
          <div className="dashboard-grid">
            <Incidents
              statusPage={statusPage}
              history={incidentHistory?.incidents}
              isLoading={statusLoading}
            />
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <div>
          <a href="https://stellar.org" target="_blank" rel="noopener noreferrer">Stellar.org</a>
          <a href="https://developers.stellar.org" target="_blank" rel="noopener noreferrer">Developers</a>
          <a href="https://github.com/stellar" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://horizon.stellar.org" target="_blank" rel="noopener noreferrer">Horizon API</a>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          Live data from the Stellar Network
        </div>
      </footer>
    </div>
  );
}

export default App;
