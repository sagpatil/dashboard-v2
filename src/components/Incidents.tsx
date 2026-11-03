import { useState } from 'react';
import type { StatusPageIncident, StatusPageSummary } from '../types';
import { timeAgo } from '../lib/format';
import { ApiLink } from './ApiLink';
import { StatusHtml } from './StatusHtml';

interface IncidentsProps {
  statusPage: StatusPageSummary | undefined;
  history: StatusPageIncident[] | undefined;
  isLoading?: boolean;
}

const HISTORY_PREVIEW_COUNT = 10;

export function Incidents({ statusPage, history, isLoading }: IncidentsProps) {
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <div className="card col-span-12">
        <div className="card-header">
          <div className="card-title">Status & Incidents</div>
        </div>
        <div className="skeleton skeleton-text" style={{ marginBottom: 12 }} />
        <div className="skeleton skeleton-text" style={{ marginBottom: 12 }} />
      </div>
    );
  }

  const activeIncidents = statusPage?.incidents.filter((i) => i.status !== 'resolved') ?? [];
  const pastIncidents = (history ?? []).filter((i) => i.status === 'resolved');
  const visiblePast = showAll ? pastIncidents : pastIncidents.slice(0, HISTORY_PREVIEW_COUNT);

  return (
    <div className="card col-span-12">
      <div className="card-header">
        <div className="card-title">Status & Incidents</div>
        <ApiLink href="https://status.stellar.org" label="StatusPage" />
      </div>

      {activeIncidents.length === 0 ? (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8, 
          padding: '8px 0 16px',
          color: 'var(--color-success)'
        }}>
          <span className="status-indicator success" />
          <span>{statusPage?.status.description ?? 'All Systems Operational'}</span>
        </div>
      ) : (
        activeIncidents.map((incident) => (
          <div key={incident.id} className="incident-item">
            <div className="incident-title">
              <a href={incident.shortlink} target="_blank" rel="noopener noreferrer">
                {incident.name}
              </a>
            </div>
            <div className="incident-status">
              Status: <strong>{incident.status}</strong> • Impact: {incident.impact}
            </div>
            {incident.incident_updates.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                <StatusHtml html={incident.incident_updates[0].body} />
              </div>
            )}
            <div className="incident-time">Created {timeAgo(incident.created_at)}</div>
          </div>
        ))
      )}

      {pastIncidents.length > 0 && (
        <>
          <div className="card-title" style={{ margin: '8px 0' }}>Past Incidents</div>
          <ul className="incident-history">
            {visiblePast.map((incident) => (
              <li key={incident.id}>
                <a href={incident.shortlink} target="_blank" rel="noopener noreferrer">
                  {incident.name}
                </a>
                <span className="incident-history-time">
                  {timeAgo(incident.resolved_at ?? incident.created_at)}
                </span>
              </li>
            ))}
          </ul>
          {pastIncidents.length > HISTORY_PREVIEW_COUNT && (
            <button className="link-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${pastIncidents.length} incidents`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
