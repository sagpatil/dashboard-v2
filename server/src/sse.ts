import type { FastifyReply, FastifyRequest } from 'fastify';

export interface EventStream {
  send(event: string, data: unknown): void;
  onClose(fn: () => void): void;
  close(): void;
}

export interface EventStreamLimits {
  maxClients: number;
  maxPerIp: number;
}

const HEARTBEAT_MS = 15_000;
// A client this far behind is not reading; drop it rather than buffer for it.
// EventSource reconnects and gets a fresh snapshot.
const MAX_BUFFERED_BYTES = 1024 * 1024;

export type StreamRefusal = 'server_full' | 'too_many_from_ip';

// Tracks one app's open event streams: enforces connection limits, drops
// clients that stop reading, and ends every stream on shutdown.
export class EventStreamHub {
  private readonly streams = new Set<EventStream>();
  private readonly perIp = new Map<string, number>();
  private readonly limits: EventStreamLimits;
  private readonly onDrop: (reason: string) => void;

  constructor(limits: EventStreamLimits, onDrop: (reason: string) => void = () => {}) {
    this.limits = limits;
    this.onDrop = onDrop;
  }

  get size(): number {
    return this.streams.size;
  }

  // Why a new stream from this IP must be refused, if it must
  refusal(ip: string): StreamRefusal | null {
    if (this.streams.size >= this.limits.maxClients) return 'server_full';
    if ((this.perIp.get(ip) ?? 0) >= this.limits.maxPerIp) return 'too_many_from_ip';
    return null;
  }

  closeAll() {
    for (const stream of [...this.streams]) stream.close();
  }

  // Take over the raw response and speak text/event-stream on it
  open(req: FastifyRequest, reply: FastifyReply): EventStream {
    const ip = req.ip;
    reply.hijack();
    const res = reply.raw;
    // Keep headers added by hooks (e.g. CORS, security headers)
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) res.setHeader(name, value);
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop nginx and similar proxies buffering the stream
      'X-Accel-Buffering': 'no',
    });
    // Tell EventSource how soon to reconnect after a drop
    res.write('retry: 3000\n\n');

    const closeHandlers: Array<() => void> = [];
    let closed = false;

    const write = (chunk: string) => {
      if (closed) return;
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        this.onDrop('slow_client');
        stream.close();
        return;
      }
      res.write(chunk);
    };

    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);

    const stream: EventStream = {
      send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      onClose: fn => {
        if (closed) fn();
        else closeHandlers.push(fn);
      },
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        this.streams.delete(stream);
        const remaining = (this.perIp.get(ip) ?? 1) - 1;
        if (remaining > 0) this.perIp.set(ip, remaining);
        else this.perIp.delete(ip);
        for (const fn of closeHandlers) fn();
        res.end();
      },
    };

    this.streams.add(stream);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    req.raw.on('close', () => stream.close());
    return stream;
  }
}
