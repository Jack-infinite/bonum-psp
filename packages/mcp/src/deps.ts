import {
  BONUM_BASE_URLS,
  type BonumClient,
  type BonumEnvironment,
  type FetchFunction,
} from 'bonum-psp';
import type { Redactor } from './redact.js';
import type { WebhookToolkit } from './webhook-toolkit.js';

/**
 * Everything the MCP server needs. `depsFromEnv(process.env)` builds it from environment
 * variables; only `environment` is required, so tests and embedders can pass just what they use.
 *
 * @example
 * ```ts
 * const server = createBonumMcpServer({ environment: 'sandbox' }); // webhook-free, key-free
 * ```
 */
export interface BonumMcpServerDeps {
  /** The Bonum environment the payment tools talk to. */
  environment: BonumEnvironment;
  /** The API base URL `check_connection` reports. Defaults to the client's or the environment's. */
  baseUrl?: string | undefined;
  /** Client for the payment tools. Without one they explain how to set `BONUM_MERCHANT_KEY`. */
  client?: BonumClient | undefined;
  /** Verifier and signer for the webhook tools. Without one they explain `BONUM_WEBHOOK_SECRET`. */
  webhooks?: WebhookToolkit | undefined;
  /** Configuration problems, phrased for the user. `check_connection` lists them. */
  warnings?: readonly string[] | undefined;
  /** Lets `send_test_webhook` reach hosts other than localhost and `*.test`. Default `false`. */
  allowRemoteWebhookTargets?: boolean | undefined;
  /** `fetch` for test webhooks. Defaults to the global `fetch`. */
  fetch?: FetchFunction | undefined;
  /** Current time in milliseconds. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
  /** Removes secrets from text; applied to every tool output. */
  redact?: ((text: string) => string) | undefined;
}

/** {@link BonumMcpServerDeps} with every default filled in. */
export interface ResolvedDeps {
  readonly environment: BonumEnvironment;
  readonly baseUrl: string;
  readonly client: BonumClient | undefined;
  readonly webhooks: WebhookToolkit | undefined;
  readonly warnings: readonly string[];
  readonly allowRemoteWebhookTargets: boolean;
  readonly fetch: FetchFunction;
  readonly now: () => number;
  readonly redact: Redactor;
}

/** Fills in the defaults of {@link BonumMcpServerDeps}. */
export function resolveDeps(deps: BonumMcpServerDeps): ResolvedDeps {
  return {
    environment: deps.environment,
    baseUrl: deps.baseUrl ?? deps.client?.baseUrl ?? BONUM_BASE_URLS[deps.environment],
    client: deps.client,
    webhooks: deps.webhooks,
    warnings: deps.warnings ?? [],
    allowRemoteWebhookTargets: deps.allowRemoteWebhookTargets ?? false,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    now: deps.now ?? Date.now,
    redact: deps.redact ?? ((text) => text),
  };
}
