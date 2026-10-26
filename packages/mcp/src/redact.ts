/** Replaces every configured secret in a piece of text. */
export type Redactor = (text: string) => string;

const PLACEHOLDER = '[redacted]';

/**
 * The last line of defense for tool output. No tool puts a secret in its output on purpose, but if
 * a bug or an upstream message ever does, the secret is replaced before it leaves the server.
 */
export function createRedactor(secrets: readonly (string | undefined)[]): Redactor {
  // Longest first, so a secret that contains another one is replaced as a whole.
  const values = [...new Set(secrets)]
    .filter((secret): secret is string => secret !== undefined && secret !== '')
    .sort((a, b) => b.length - a.length);
  if (values.length === 0) return (text) => text;
  return (text) => values.reduce((result, secret) => result.replaceAll(secret, PLACEHOLDER), text);
}

/** Applies `redact` to every string inside a JSON-like value. */
export function redactDeep<T>(value: T, redact: Redactor): T {
  return walk(value, redact) as T;
}

function walk(value: unknown, redact: Redactor): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, redact));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item, redact)]),
    );
  }
  return value;
}
