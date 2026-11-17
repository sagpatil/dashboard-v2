import type { FastifyReply, FastifyRequest } from 'fastify';

export interface EventStream {
  send(event: string, data: unknown): void;
  onClose(fn: () => void): void;
  close(): void;
}

const HEARTBEAT_MS = 15_000;

// Open streams, so a shutting-down server can end them instead of waiting
const openStreams = new Set<EventStream>();

export const closeAllEventStreams = () => {
  for (const stream of openStreams) stream.close();
};

export const openEventStreamCount = () => openStreams.size;

// Take over the raw response and speak text/event-stream on it
export const openEventStream = (req: FastifyRequest, reply: FastifyReply): EventStream => {
  reply.hijack();
  const res = reply.raw;
  // Keep headers added by hooks (e.g. CORS)
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

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  const stream: EventStream = {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(fn) {
      if (closed) fn();
      else closeHandlers.push(fn);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      openStreams.delete(stream);
      for (const fn of closeHandlers) fn();
      res.end();
    },
  };

  openStreams.add(stream);
  req.raw.on('close', () => stream.close());
  return stream;
};
