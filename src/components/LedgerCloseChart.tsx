import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { LedgerRecord } from '../types';
import { LEDGERS_FOR_CHARTS, getHorizonUrl } from '../lib/constants';
import type { NetworkType } from '../lib/constants';
import { ApiLink } from './ApiLink';

interface LedgerCloseChartProps {
  ledgers: LedgerRecord[];
  network: NetworkType;
  isLoading?: boolean;
}

export function LedgerCloseChart({ ledgers, network, isLoading }: LedgerCloseChartProps) {
  const chartData = useMemo(() => {
    if (ledgers.length < 2) return [];
    
    // Calculate close times between consecutive ledgers
    const data = [];
    // One extra ledger gives LEDGERS_FOR_CHARTS close-time intervals.
    // Reverse to show oldest to newest (left to right)
    const sortedLedgers = ledgers.slice(0, LEDGERS_FOR_CHARTS + 1).reverse();
    
    for (let i = 1; i < sortedLedgers.length; i++) {
      const current = new Date(sortedLedgers[i].closed_at);
      const previous = new Date(sortedLedgers[i - 1].closed_at);
      const closeTime = (current.getTime() - previous.getTime()) / 1000;
      
      data.push({
        sequence: sortedLedgers[i].sequence,
        closeTime: Math.max(0, closeTime), // Ensure non-negative
        label: `#${sortedLedgers[i].sequence}`,
      });
    }
    
    return data;
  }, [ledgers]);

  if (isLoading || chartData.length === 0) {
    return (
      <div className="card col-span-6">
        <div className="card-header">
          <div className="card-title">Ledger Close Times</div>
        </div>
        <div className="chart-container">
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    );
  }

  const getBarColor = (closeTime: number) => {
    if (closeTime <= 5) return 'var(--color-success)';
    if (closeTime <= 10) return 'var(--color-warning)';
    return 'var(--color-error)';
  };

  return (
    <div className="card col-span-6">
      <div className="card-header">
        <div className="card-title">Last {chartData.length} Ledgers Close Times</div>
        <ApiLink href={`${getHorizonUrl(network)}/ledgers?order=desc&limit=${LEDGERS_FOR_CHARTS}`} />
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis 
              dataKey="sequence" 
              tick={false}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
            />
            <YAxis 
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              tickFormatter={(value) => `${value}s`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--color-text-primary)' }}
              formatter={(value) => [`${Number(value).toFixed(2)}s`, 'Close Time']}
              labelFormatter={(label) => `Ledger #${label}`}
            />
            <Bar dataKey="closeTime" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.closeTime)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
