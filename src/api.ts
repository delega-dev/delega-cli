import { getApiKey, getApiUrl } from "./config.js";

export interface ApiError {
  error?: string;
  message?: string;
}

export async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Not authenticated. Run: delega login");
    process.exit(1);
  }

  const url = getApiUrl() + path;

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

  if (res.status === 401) {
    console.error("Authentication failed. Run: delega login");
    process.exit(1);
  }

  let data: unknown;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const errData = data as ApiError;
    const msg = errData.error || errData.message || `Request failed (${res.status})`;
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  return data as T;
}
