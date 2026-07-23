/** Encode one untrusted value for use as exactly one URL path segment. */
export function pathSegment(value: string | number): string {
  const raw = String(value);
  // URL implementations normalize literal dot segments even though
  // encodeURIComponent leaves them unchanged.
  if (raw === "" || raw === "." || raw === "..") {
    throw new Error(`Refusing to build an API path from unsafe id: ${JSON.stringify(raw)}`);
  }
  return encodeURIComponent(raw);
}
