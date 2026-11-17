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

export const fetchJson = async <T>(
  fetchImpl: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpstreamError(`Request to ${url} failed: ${reason}`, url);
  }

  if (!response.ok) {
    // Drain the body so the connection can be reused
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(`${url} responded ${response.status}`, url, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(`${url} returned invalid JSON`, url, response.status);
  }
};
