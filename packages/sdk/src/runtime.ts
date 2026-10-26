import { BonumConfigError } from './errors.js';

/**
 * Reads an environment variable without crashing where `process` does not exist (Workers, Deno
 * without `--allow-env`). Blank values count as unset.
 */
export function readEnv(name: string): string | undefined {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    const value = env?.[name]?.trim();
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Refuses to run in a browser: the merchant key and webhook secret must stay on the server. */
export function assertServerRuntime(dangerouslyAllowBrowser: unknown): void {
  if (dangerouslyAllowBrowser === true) return;
  if ('window' in globalThis && 'document' in globalThis) {
    throw new BonumConfigError(
      'bonum-psp must run on your server, never in the browser: the merchant key would be exposed. ' +
        'Send the wallet token from the page to your backend and call Bonum from there. ' +
        '(dangerouslyAllowBrowser: true exists only for browser-like test environments.)',
    );
  }
}
