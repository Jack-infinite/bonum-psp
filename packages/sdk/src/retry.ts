const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

/** Rate limiting and transient server errors are worth another attempt; other statuses are not. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Delay before retry number `attempt` (0-based): Bonum's `Retry-After` when it sent one (capped),
 * otherwise exponential backoff with full jitter so many clients do not retry in lockstep.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  random: () => number,
): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** Parses `Retry-After` (delay in seconds or an HTTP date) into milliseconds, or `null`. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

/** Waits `ms` milliseconds; rejects with the signal's reason as soon as it aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
