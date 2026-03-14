import { getApiKey, getApiUrl } from "./config.js";

export interface ApiError {
  error?: string;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | ApiError;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Not authenticated. Run: delega login");
    process.exit(1);
  }

  let apiBase: string;
  try {
    apiBase = getApiUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Configuration error: ${msg}`);
    process.exit(1);
  }

  const url = apiBase + path;

  const headers: Record<string, string> = {
    "X-Agent-Key": apiKey,
    "Content-Type": "application/json",
  };

  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Connection error: ${msg}`);
    process.exit(1);
  }

  let data: unknown;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  return {
    ok: res.ok,
    status: res.status,
    data: data as T | ApiError,
  };
}

export async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const result = await apiRequest<T>(method, path, body);
  if (result.status === 401) {
    console.error("Authentication failed. Run: delega login");
    process.exit(1);
  }

  if (!result.ok) {
    const errData = result.data as ApiError;
    const msg = errData.error || errData.message || `Request failed (${result.status})`;
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  return result.data as T;
}
