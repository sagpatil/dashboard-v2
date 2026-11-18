import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import { LEDGERS_IN_AVERAGE } from '../../shared/networks.ts';
import type { NetworkType } from '../../shared/networks.ts';
import type { HorizonResponse, LedgerRecord } from '../../shared/types.ts';
import { fetchJson } from './upstream.ts';
import type { FetchFn, FetchJsonOptions } from './upstream.ts';
import { isLedger, isLedgerPage } from './validate.ts';

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'debug'>;
type Listener = (ledger: LedgerRecord) => void;

export interface LedgerFeedOptions {
  network: NetworkType;
  horizonUrl: string;
  logger: Logger;
  fetchImpl?: FetchFn;
  bufferSize?: number;
  timeoutMs?: number;
  // Restart the stream if Horizon sends nothing (not even a ledger) for this long
  stallTimeoutMs?: number;
  minRetryMs?: number;
  maxRetryMs?: number;
  // Receives the outcome of each backfill request, for metrics
  onUpstreamResult?: FetchJsonOptions['onResult'];
}

export interface LedgerFeedStatus {
  network: NetworkType;
  connected: boolean;
  bufferedLedgers: number;
  latestSequence: number | null;
  latestClosedAt: string | null;
  subscribers: number;
  reconnects: number;
  lastError: string | null;
}

// Average ledger close is ~5-6s; past this many ledgers behind it is cheaper to
// refetch the latest page than to replay the gap through the stream.
const MAX_REPLAY_SECONDS = LEDGERS_IN_AVERAGE * 6;

// Pick only the fields the dashboard uses; Horizon also sends the header XDR
// and HAL links, which roughly triple the record size.
export const trimLedger = (raw: LedgerRecord): LedgerRecord => ({
  id: raw.id,
  paging_token: raw.paging_token,
  hash: raw.hash,
  sequence: raw.sequence,
  successful_transaction_count: raw.successful_transaction_count,
  failed_transaction_count: raw.failed_transaction_count,
  operation_count: raw.operation_count,
  tx_set_operation_count: raw.tx_set_operation_count,
  closed_at: raw.closed_at,
  total_coins: raw.total_coins,
  fee_pool: raw.fee_pool,
  base_fee_in_stroops: raw.base_fee_in_stroops,
  base_reserve_in_stroops: raw.base_reserve_in_stroops,
  max_tx_set_size: raw.max_tx_set_size,
  protocol_version: raw.protocol_version,
});

// Holds a single Horizon ledger stream for one network, keeps the latest
// ledgers in memory (newest first) and fans new ledgers out to subscribers.
export class LedgerFeed {
  readonly network: NetworkType;
  private readonly horizonUrl: string;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchFn;
  private readonly bufferSize: number;
  private readonly timeoutMs: number;
  private readonly stallTimeoutMs: number;
  private readonly minRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly onUpstreamResult: FetchJsonOptions['onResult'];

  private ledgers: LedgerRecord[] = [];
  private readonly listeners = new Set<Listener>();
  private running = false;
  private connected = false;
  private reconnects = 0;
  private lastError: string | null = null;
  private lastMessageAt = 0;
  private stop$ = new AbortController();
  private stream$: AbortController | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private loop: Promise<void> | null = null;

  constructor(options: LedgerFeedOptions) {
    this.network = options.network;
    this.horizonUrl = options.horizonUrl;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.bufferSize = options.bufferSize ?? LEDGERS_IN_AVERAGE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.stallTimeoutMs = options.stallTimeoutMs ?? 60_000;
    this.minRetryMs = options.minRetryMs ?? 1_000;
    this.maxRetryMs = options.maxRetryMs ?? 60_000;
    this.onUpstreamResult = options.onUpstreamResult;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stop$ = new AbortController();
    this.watchdog = setInterval(() => this.checkStalled(), Math.min(this.stallTimeoutMs, 10_000));
    this.watchdog.unref();
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.watchdog) clearInterval(this.watchdog);
    this.stop$.abort();
    this.stream$?.abort();
    await this.loop;
    this.connected = false;
  }

  // Latest ledgers, newest first
  snapshot(limit = this.bufferSize): LedgerRecord[] {
    return this.ledgers.slice(0, limit);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): LedgerFeedStatus {
    const latest = this.ledgers[0];
    return {
      network: this.network,
      connected: this.connected,
      bufferedLedgers: this.ledgers.length,
      latestSequence: latest?.sequence ?? null,
      latestClosedAt: latest?.closed_at ?? null,
      subscribers: this.listeners.size,
      reconnects: this.reconnects,
      lastError: this.lastError,
    };
  }

  // Exposed for tests; adds a ledger as if it had arrived on the stream
  ingest(raw: LedgerRecord): boolean {
    const ledger = trimLedger(raw);
    if (this.ledgers.some(l => l.sequence === ledger.sequence)) return false;

    this.ledgers = [ledger, ...this.ledgers]
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, this.bufferSize);
    // Only announce ledgers that made it into the window
    if (!this.ledgers.includes(ledger)) return false;

    for (const listener of this.listeners) {
      try {
        listener(ledger);
      } catch (error) {
        this.logger.warn({ err: error, network: this.network }, 'ledger listener failed');
      }
    }
    return true;
  }

  private async run(): Promise<void> {
    let delay = this.minRetryMs;
    while (this.running) {
      try {
        if (this.needsBackfill()) await this.backfill();
        await this.stream();
        // Horizon ends streams on its own from time to time; reconnect promptly
        delay = this.minRetryMs;
      } catch (error) {
        if (!this.running) break;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn({ network: this.network, err: this.lastError }, 'ledger feed error');
      }
      this.connected = false;
      if (!this.running) break;

      this.reconnects++;
      try {
        // Jitter keeps several instances from retrying in step
        const jittered = delay * (0.75 + Math.random() * 0.5);
        await sleep(jittered, undefined, { signal: this.stop$.signal });
      } catch {
        break; // stopped while waiting
      }
      delay = Math.min(delay * 2, this.maxRetryMs);
    }
  }

  private needsBackfill(): boolean {
    const latest = this.ledgers[0];
    if (!latest) return true;
    return (Date.now() - Date.parse(latest.closed_at)) / 1000 > MAX_REPLAY_SECONDS;
  }

  private async backfill(): Promise<void> {
    const url = `${this.horizonUrl}/ledgers?order=desc&limit=${this.bufferSize}`;
    const page = await fetchJson<HorizonResponse<LedgerRecord>>(this.fetchImpl, url, {
      timeoutMs: this.timeoutMs,
      validate: isLedgerPage,
      onResult: this.onUpstreamResult,
    });
    this.ledgers = page._embedded.records
      .map(trimLedger)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, this.bufferSize);
    this.logger.info(
      { network: this.network, latest: this.ledgers[0]?.sequence },
      'ledger feed backfilled',
    );
  }

  private async stream(): Promise<void> {
    const cursor = this.ledgers[0]?.paging_token ?? 'now';
    const url = `${this.horizonUrl}/ledgers?order=asc&cursor=${encodeURIComponent(cursor)}`;
    const stream$ = new AbortController();
    this.stream$ = stream$;
    this.lastMessageAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.any([stream$.signal, this.stop$.signal]),
      });
    } catch (error) {
      this.stream$ = null;
      throw error;
    }
    if (!response.ok || !response.body) {
      this.stream$ = null;
      await response.body?.cancel().catch(() => {});
      throw new Error(`ledger stream responded ${response.status}`);
    }

    this.connected = true;
    this.lastError = null;
    this.logger.info({ network: this.network, cursor }, 'ledger stream connected');

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        this.lastMessageAt = Date.now();
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          this.handleEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
      }
    } catch (error) {
      // An abort from the watchdog means "reconnect", not a failure
      if (stream$.signal.aborted && this.running) {
        throw new Error('ledger stream stalled', { cause: error });
      }
      throw error;
    } finally {
      this.stream$ = null;
    }
  }

  private handleEvent(block: string) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    // Horizon sends "hello" / "byebye" strings as well as ledger objects
    if (isLedger(payload)) {
      this.ingest(payload as LedgerRecord);
    } else if (payload && typeof payload === 'object') {
      this.logger.warn({ network: this.network }, 'ignored a malformed ledger from the stream');
    }
  }

  private checkStalled() {
    // Covers both a silent open stream and a request that never got headers
    if (!this.stream$ || this.stream$.signal.aborted) return;
    if (Date.now() - this.lastMessageAt > this.stallTimeoutMs) {
      this.logger.warn({ network: this.network }, 'ledger stream stalled; reconnecting');
      this.stream$?.abort();
    }
  }
}
