import { getApiKey, getApiUrl, getCloudflareAccessHeaders } from "./config.js";

export interface ApiError {
  error?: string;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | ApiError;
}

function formatApiError(status: number, data: ApiError): string {
  const serverMsg = data.error || data.message;

  switch (status) {
    case 401:
      return "Authentication failed. Your API key may be invalid or expired.\n  Run: delega login";
    case 403:
      return `Permission denied.${serverMsg ? " " + serverMsg : ""}\n  Check your agent's permissions or contact your admin.`;
    case 404:
      return `Resource not found.${serverMsg ? " " + serverMsg : ""}`;
    case 409:
      return serverMsg || "Conflict — the resource already exists or was modified.";
    case 422:
      return `Invalid request.${serverMsg ? " " + serverMsg : ""}\n  Check your command arguments.`;
    case 429:
      return "Rate limited. Wait a moment and try again.";
    case 500:
    case 502:
    case 503:
    case 504:
      return `Server error (${status}).${serverMsg ? " " + serverMsg : ""}\n  The API may be temporarily unavailable. Try again shortly.`;
    default:
      return serverMsg || `Request failed with status ${status}.`;
  }
}

export function formatNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("ECONNREFUSED")) {
    return "Connection refused. Check your API URL (DELEGA_API_URL) and https://delega.dev/status";
  }
  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
    return "Could not resolve the API hostname. Check your network connection and API URL.";
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("TimeoutError")) {
    return "Connection timed out. Check your network connection and https://delega.dev/status";
  }
  if (msg.includes("CERT") || msg.includes("certificate")) {
    return `TLS certificate error: ${msg}\n  If your host requires a custom/internal CA, point NODE_EXTRA_CA_CERTS at its PEM file. Never disable certificate validation — it exposes your API key to interception.`;
  }

  return `Connection error: ${msg}`;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  let apiKey: string | undefined;
  try {
    apiKey = getApiKey();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Configuration error: ${msg}`);
    process.exit(1);
  }
  if (!apiKey) {
    console.error("Not authenticated. Run: delega login");
    process.exit(1);
  }

  let apiBase: string;
  let accessHeaders: Record<string, string>;
  try {
    apiBase = getApiUrl();
    accessHeaders = getCloudflareAccessHeaders();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Configuration error: ${msg}`);
    process.exit(1);
  }

  const url = apiBase + path;

  const headers: Record<string, string> = {
    "X-Agent-Key": apiKey,
    "Content-Type": "application/json",
    ...accessHeaders,
  };

  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    console.error(formatNetworkError(err));
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
  if (!result.ok) {
    console.error(formatApiError(result.status, result.data as ApiError));
    process.exit(1);
  }

  return result.data as T;
}
