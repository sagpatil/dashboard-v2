import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LedgerFeed } from '../src/ledgerFeed.ts';
import type { LedgerRecord } from '../../shared/types.ts';
import { controllableStream, fakeFetch, json, ledgerPage, makeLedger, silentLogger, waitFor } from './helpers.ts';

const event = (ledger: unknown) => `id: x\ndata: ${JSON.stringify(ledger)}\n\n`;

describe('LedgerFeed', () => {
  it('backfills, streams from the latest cursor and notifies subscribers', async () => {
    let stream!: ReturnType<typeof controllableStream>;
    let streamCursor: string | null = null;
    const upstream = fakeFetch({
      'horizon.test/ledgers': (url, init) => {
        if (url.searchParams.get('order') === 'desc') return json({ _embedded: { records: ledgerPage(100, 5) } });
        streamCursor = url.searchParams.get('cursor');
        stream = controllableStream(init?.signal);
        return stream.response;
      },
    });

    const feed = new LedgerFeed({
      network: 'mainnet', horizonUrl: 'https://horizon.test', logger: silentLogger,
      fetchImpl: upstream.impl, bufferSize: 5,
    });
    const received: LedgerRecord[] = [];
    feed.subscribe(l => received.push(l));
    feed.start();

    await waitFor(() => feed.status().connected);
    assert.equal(streamCursor, String(100 * 4096));
    assert.deepEqual(feed.snapshot().map(l => l.sequence), [100, 99, 98, 97, 96]);

    // Horizon's greeting, a new ledger split across chunks (CRLF framing), and a duplicate
    stream.push('retry: 1000\nevent: open\ndata: "hello"\n\n');
    const text = event(makeLedger(101));
    stream.push(text.slice(0, 20));
    stream.push(text.slice(20).replace(/\n/g, '\r\n'));
    stream.push(event(makeLedger(101)));
    await waitFor(() => received.length === 1);

    assert.equal(received[0].sequence, 101);
    assert.equal('header_xdr' in received[0], false, 'records are trimmed');
    assert.deepEqual(feed.snapshot().map(l => l.sequence), [101, 100, 99, 98, 97]);
    assert.equal(feed.status().latestSequence, 101);

    await feed.stop();
    assert.equal(feed.status().connected, false);
  });

  it('reconnects from the last seen ledger when the stream ends', async () => {
    const cursors: string[] = [];
    let current!: ReturnType<typeof controllableStream>;
    const upstream = fakeFetch({
      'horizon.test/ledgers': (url, init) => {
        if (url.searchParams.get('order') === 'desc') return json({ _embedded: { records: ledgerPage(10, 3) } });
        cursors.push(url.searchParams.get('cursor')!);
        current = controllableStream(init?.signal);
        return current.response;
      },
    });
    const feed = new LedgerFeed({
      network: 'mainnet', horizonUrl: 'https://horizon.test', logger: silentLogger,
      fetchImpl: upstream.impl, bufferSize: 3, minRetryMs: 1,
    });
    feed.start();
    await waitFor(() => cursors.length === 1);
    current.push(event(makeLedger(11)));
    await waitFor(() => feed.status().latestSequence === 11);
    current.end();

    await waitFor(() => cursors.length === 2);
    assert.equal(cursors[1], String(11 * 4096));
    assert.equal(upstream.count('order=desc'), 1, 'no second backfill for a short gap');
    assert.ok(feed.status().reconnects >= 1);
    await feed.stop();
  });

  it('retries after Horizon errors and records the error', async () => {
    let attempts = 0;
    const upstream = fakeFetch({
      'horizon.test/ledgers': () => {
        attempts++;
        return new Response('rate limited', { status: 429 });
      },
    });
    const feed = new LedgerFeed({
      network: 'mainnet', horizonUrl: 'https://horizon.test', logger: silentLogger,
      fetchImpl: upstream.impl, minRetryMs: 1, maxRetryMs: 2,
    });
    feed.start();
    await waitFor(() => attempts >= 3);
    assert.match(feed.status().lastError ?? '', /429/);
    assert.equal(feed.status().connected, false);
    await feed.stop();
  });
});
