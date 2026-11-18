export type FetchFn = typeof fetch;

// A failed call to a third-party API (Horizon, dashboard.stellar.org, StatusPage)
export class UpstreamError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.url = url;
    this.status = status;
  }
}

export interface FetchJsonOptions {
  timeoutMs: number;
  // Returns false if the body is not the expected shape
  validate?: (body: unknown) => boolean;
  // Told how each request went: 'ok', 'http_<status>', 'network_error' or 'invalid_response'
  onResult?: (host: string, outcome: string, seconds: number) => void;
}

export const fetchJson = async <T>(
  fetchImpl: FetchFn,
  url: string,
  options: FetchJsonOptions,
): Promise<T> => {
  const started = performance.now();
  const host = new URL(url).host;
  const report = (outcome: string) =>
    options.onResult?.(host, outcome, (performance.now() - started) / 1000);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    report('network_error');
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpstreamError(`Request to ${url} failed: ${reason}`, url);
  }

  if (!response.ok) {
    report(`http_${response.status}`);
    // Drain the body so the connection can be reused
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(`${url} responded ${response.status}`, url, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    report('invalid_response');
    throw new UpstreamError(`${url} returned invalid JSON`, url, response.status);
  }
  if (options.validate && !options.validate(body)) {
    report('invalid_response');
    throw new UpstreamError(`${url} returned an unexpected response shape`, url, response.status);
  }

  report('ok');
  return body as T;
};
