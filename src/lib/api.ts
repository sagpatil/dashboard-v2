// Base URL of the dashboard API server. Empty means same origin, which is the
// case in production (the server also serves this app) and in development
// (Vite proxies /api to the server). Set VITE_API_BASE_URL at build time to
// host the frontend separately from the API.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const apiUrl = (path: string) => `${API_BASE}/api/v1${path}`;

export const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // not JSON; keep the status text
    }
    throw new Error(`GET ${path} failed: ${message}`);
  }
  return response.json() as Promise<T>;
};
