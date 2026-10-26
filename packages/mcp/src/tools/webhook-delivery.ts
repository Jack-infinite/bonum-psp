import type { FetchFunction } from 'bonum-psp';
import type { SignedTestWebhook } from 'bonum-psp/testing';

/** Bonum's limit: an endpoint that has not answered after 10 s counts as a failed delivery. */
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_DETAIL_LENGTH = 200;

/** What happened when one test webhook was sent. */
export interface Delivery {
  /** The HTTP status, or `null` when no response arrived. */
  status: number | null;
  durationMs: number;
  /** The start of the response body, the redirect target, or why there was no response. */
  detail: string;
}

/** POSTs one signed test webhook, the way Bonum would deliver it. */
export async function deliver(
  fetch: FetchFunction,
  url: URL,
  request: SignedTestWebhook,
  signal: AbortSignal,
): Promise<Delivery> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      // Following a redirect would re-send the signed body to a host the user never named.
      redirect: 'manual',
      signal: AbortSignal.any([signal, timeout]),
    });
    const body = await response.text();
    const location = response.headers.get('location');
    const redirect = response.status >= 300 && response.status < 400 && location !== null;
    const detail = redirect ? `redirects to ${location}` : oneLine(body);
    return { status: response.status, durationMs: elapsed(started), detail };
  } catch (error) {
    // The tool call itself was cancelled: stop instead of reporting a failed scenario.
    signal.throwIfAborted();
    return { status: null, durationMs: elapsed(started), detail: failure(error, url, timeout) };
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_DETAIL_LENGTH ? `${line.slice(0, MAX_DETAIL_LENGTH)}…` : line;
}

function failure(error: unknown, url: URL, timeout: AbortSignal): string {
  if (timeout.aborted) {
    return (
      'No answer within 10 s. Bonum counts that as a failed delivery and retries: answer 2xx ' +
      'right away and do slow work afterwards.'
    );
  }
  const code = errorCode(error);
  if (code === 'ECONNREFUSED') return `Connection refused at ${url.host}. Is your server running?`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Host ${url.hostname} was not found.`;
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return `Request failed: ${cause instanceof Error ? cause.message : String(cause)}`;
}

// Node's fetch reports network errors as TypeError('fetch failed') with the socket error as
// `cause`; with several addresses (IPv4 and IPv6 for localhost) the cause is an AggregateError.
function errorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  const first = cause instanceof AggregateError ? cause.errors[0] : undefined;
  return codeOf(cause) ?? codeOf(first);
}

function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  return typeof value.code === 'string' ? value.code : undefined;
}
