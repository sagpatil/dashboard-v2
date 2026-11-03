import type { StatusPageSummary } from '../types';
import { StatusHtml } from './StatusHtml';

interface MaintenanceBannerProps {
  statusPage: StatusPageSummary | undefined;
}

const ACTIVE_STATUSES = ['scheduled', 'in_progress', 'verifying'];

export function MaintenanceBanner({ statusPage }: MaintenanceBannerProps) {
  const maintenances = statusPage?.scheduled_maintenances.filter(
    (m) => ACTIVE_STATUSES.includes(m.status)
  ) ?? [];

  if (maintenances.length === 0) return null;

  return (
    <div className="maintenance-banner" role="status">
      {maintenances.map((maintenance) => (
        <div key={maintenance.id} className="maintenance-banner-item">
          <div className="maintenance-banner-title">
            {maintenance.status === 'scheduled' ? 'Scheduled maintenance: ' : 'Maintenance in progress: '}
            <a href={maintenance.shortlink} target="_blank" rel="noopener noreferrer">
              {maintenance.name}
            </a>
            {' — '}
            {new Date(maintenance.scheduled_for).toLocaleString(undefined, {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
          </div>
          {maintenance.incident_updates.length > 0 && (
            <div className="maintenance-banner-body">
              <StatusHtml html={maintenance.incident_updates[0].body} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
