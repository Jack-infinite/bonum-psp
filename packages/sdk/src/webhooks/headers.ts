/**
 * Request headers as the Fetch API (`Headers`) or Node.js (`req.headers`) provide them. Lookups are
 * case-insensitive; for repeated headers the first value wins.
 *
 * @example
 * ```ts
 * const headers: WebhookHeaders = req.headers; // Express / node:http
 * const fetchHeaders: WebhookHeaders = request.headers; // Next.js, Hono, Workers
 * ```
 */
export type WebhookHeaders =
  | Headers
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/** Reads one header from either shape, ignoring case. */
export function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  if (isFetchHeaders(headers)) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const first = typeof value === 'string' ? value : value?.[0];
    if (first !== undefined) return first;
  }
  return undefined;
}

// Duck-typed rather than `instanceof Headers`: frameworks sometimes ship their own Headers class.
function isFetchHeaders(headers: WebhookHeaders): headers is Headers {
  return typeof (headers as Partial<Headers>).get === 'function';
}
