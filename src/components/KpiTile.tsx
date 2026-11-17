import type { ReactNode } from 'react';

interface KpiTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  title?: string;
  tone?: 'warning' | 'error';
}

export function KpiTile({ label, value, detail, title, tone }: KpiTileProps) {
  return (
    <div className="kpi-tile" title={title}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ?? ''}`}>{value}</div>
      {detail && <div className="kpi-detail">{detail}</div>}
    </div>
  );
}
