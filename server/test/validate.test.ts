import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAccount, isDailyHistory, isLedger, isLedgerPage, isStatusSummary } from '../src/validate.ts';
import { Metrics } from '../src/metrics.ts';
import { makeLedger } from './helpers.ts';

describe('upstream response checks', () => {
  it('accepts well-formed ledgers and rejects broken ones', () => {
    assert.ok(isLedger(makeLedger(1)));
    assert.ok(isLedgerPage({ _embedded: { records: [makeLedger(1), makeLedger(2)] } }));
    assert.ok(!isLedger({ ...makeLedger(1), closed_at: 'yesterday-ish' }));
    assert.ok(!isLedger({ ...makeLedger(1), sequence: '1' }));
    assert.ok(!isLedger('hello'));
    assert.ok(!isLedgerPage({ _embedded: {} }));
    assert.ok(!isLedgerPage({ status: 503, title: 'Service Unavailable' }));
  });

  it('checks balances, history and status', () => {
    assert.ok(isAccount({ balances: [{ asset_type: 'native', balance: '1.5' }] }));
    assert.ok(!isAccount({ balances: [{ asset_type: 'native', balance: 'lots' }] }));
    assert.ok(isDailyHistory([{ date: '11-16', transaction_count: 5, operation_count: '9' }]));
    assert.ok(!isDailyHistory({ error: 'x' }));
    assert.ok(!isStatusSummary({ status: { indicator: 'none' } }));
  });
});

describe('Metrics', () => {
  it('renders Prometheus text with escaped labels and cumulative buckets', () => {
    const metrics = new Metrics();
    metrics.httpRequests.inc({ route: '/a "b"', method: 'GET', status: 200 });
    metrics.httpDuration.observe({ route: '/a' }, 0.02);
    metrics.httpDuration.observe({ route: '/a' }, 3);
    const text = metrics.render();
    assert.match(text, /# TYPE http_requests_total counter/);
    assert.match(text, /http_requests_total\{route="\/a \\"b\\"",method="GET",status="200"\} 1/);
    assert.match(text, /http_request_duration_seconds_bucket\{route="\/a",le="0.025"\} 1/);
    assert.match(text, /http_request_duration_seconds_bucket\{route="\/a",le="5"\} 2/);
    assert.match(text, /http_request_duration_seconds_count\{route="\/a"\} 2/);
    assert.ok(text.endsWith('\n'));
  });
});
