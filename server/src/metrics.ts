// A small Prometheus text-format exporter: counters, gauges read at scrape
// time, and histograms. Enough for this server without a client library.

type Labels = Record<string, string | number>;

const escapeLabel = (value: string | number) =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const formatLabels = (labels: Labels) => {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return pairs.length ? `{${pairs.join(',')}}` : '';
};

interface Metric {
  render(): string[];
}

export class Counter implements Metric {
  private readonly values = new Map<string, number>();
  private readonly name: string;
  private readonly help: string;

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, by = 1) {
    const key = formatLabels(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.values].map(([labels, value]) => `${this.name}${labels} ${value}`),
    ];
  }
}

// A gauge whose samples are computed when scraped
export class Gauge implements Metric {
  private readonly name: string;
  private readonly help: string;
  private readonly collect: () => Array<{ labels?: Labels; value: number }>;

  constructor(name: string, help: string, collect: () => Array<{ labels?: Labels; value: number }>) {
    this.name = name;
    this.help = help;
    this.collect = collect;
  }

  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      ...this.collect().map(s => `${this.name}${formatLabels(s.labels ?? {})} ${s.value}`),
    ];
  }
}

export class Histogram implements Metric {
  private readonly series = new Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>();
  private readonly name: string;
  private readonly help: string;
  private readonly bounds: number[];

  constructor(name: string, help: string, bounds: number[]) {
    this.name = name;
    this.help = help;
    this.bounds = bounds;
  }

  observe(labels: Labels, value: number) {
    const key = formatLabels(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels, buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    series.sum += value;
    series.count++;
    this.bounds.forEach((bound, i) => {
      if (value <= bound) series.buckets[i]++;
    });
  }

  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, buckets, sum, count } of this.series.values()) {
      this.bounds.forEach((bound, i) => {
        lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: bound })} ${buckets[i]}`);
      });
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`);
    }
    return lines;
  }
}

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// The server's metrics, one set per app instance
export class Metrics {
  readonly httpRequests = new Counter(
    'http_requests_total', 'HTTP requests by route, method and status code');
  readonly httpDuration = new Histogram(
    'http_request_duration_seconds', 'HTTP request duration by route', SECONDS);
  readonly cacheRequests = new Counter(
    'cache_requests_total', 'Cache lookups by resource and result (hit, miss, stale)');
  readonly upstreamRequests = new Counter(
    'upstream_requests_total', 'Requests to upstream services by host and outcome');
  readonly upstreamDuration = new Histogram(
    'upstream_request_duration_seconds', 'Upstream request duration by host', SECONDS);
  readonly streamsRejected = new Counter(
    'event_streams_rejected_total', 'Event stream connections refused or dropped, by reason');

  private readonly metrics: Metric[] = [
    this.httpRequests, this.httpDuration, this.cacheRequests,
    this.upstreamRequests, this.upstreamDuration, this.streamsRejected,
    new Gauge('process_resident_memory_bytes', 'Resident memory size', () =>
      [{ value: process.memoryUsage.rss() }]),
    new Gauge('process_uptime_seconds', 'Process uptime', () => [{ value: Math.round(process.uptime()) }]),
  ];

  gauge(name: string, help: string, collect: () => Array<{ labels?: Labels; value: number }>) {
    this.metrics.push(new Gauge(name, help, collect));
  }

  render(): string {
    return this.metrics.flatMap(m => m.render()).join('\n') + '\n';
  }
}
