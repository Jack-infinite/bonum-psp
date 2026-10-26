import { BONUM_BASE_URLS, BonumClient, type BonumEnvironment, type FetchFunction } from 'bonum-psp';
import { type BonumMcpServerDeps, resolveDeps } from './deps.js';
import { gatewayFromEnv } from './gateway-env.js';
import { createRedactor } from './redact.js';
import { VERSION } from './version.js';
import { createWebhookToolkit } from './webhook-toolkit.js';

/**
 * Overrides for {@link depsFromEnv}, mainly for tests.
 *
 * @example
 * ```ts
 * const deps = depsFromEnv(process.env, { fetch: (url, init) => fetch(url, init) });
 * ```
 */
export interface DepsFromEnvOptions {
  /** `fetch` for Bonum API calls and test webhooks. Defaults to the global `fetch`. */
  fetch?: FetchFunction | undefined;
  /** Current time in milliseconds. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

// Tool calls are interactive: answer within seconds instead of the SDK's 15 s × 3 attempts.
const API_SETTINGS = {
  timeoutMs: 10_000,
  maxRetries: 1,
  userAgent: `bonum-psp-mcp/${VERSION}`,
} as const;

/**
 * Builds the server's dependencies from `BONUM_MERCHANT_KEY`, `BONUM_WEBHOOK_SECRET`, `BONUM_ENV`
 * (default `sandbox`), `BONUM_BASE_URL`, `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS` and the
 * `BONUM_GATEWAY_*` variables of the invoice tools. Never throws:
 * a missing or invalid value switches the affected tools off and becomes a warning, so the server
 * always starts and can tell the user what to fix.
 *
 * @example
 * ```ts
 * import { createBonumMcpServer, depsFromEnv } from 'bonum-psp-mcp';
 *
 * const server = createBonumMcpServer(depsFromEnv(process.env));
 * ```
 */
export function depsFromEnv(env: Env, options: DepsFromEnvOptions = {}): BonumMcpServerDeps {
  const fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = options.now ?? Date.now;
  const warnings: string[] = [];
  const environment = readEnvironment(env, warnings);
  const merchantKey = readValue(env, 'BONUM_MERCHANT_KEY', warnings);
  const webhookSecret = readValue(env, 'BONUM_WEBHOOK_SECRET', warnings);
  const baseUrl = readValue(env, 'BONUM_BASE_URL', warnings);
  const client =
    merchantKey === undefined
      ? undefined
      : createClient({ merchantKey, environment, baseUrl, fetch }, warnings);
  const allowRemoteWebhookTargets = readFlag(env, warnings);
  const { secrets, ...gateway } = gatewayFromEnv(
    (name) => readValue(env, name, warnings),
    { ...API_SETTINGS, environment, fetch, now },
    warnings,
  );
  return {
    environment,
    baseUrl: client?.baseUrl ?? displayUrl(baseUrl) ?? BONUM_BASE_URLS[environment],
    client,
    webhooks: webhookSecret === undefined ? undefined : createWebhookToolkit(webhookSecret, now),
    ...gateway,
    warnings,
    allowRemoteWebhookTargets,
    fetch,
    now,
    redact: createRedactor([merchantKey, webhookSecret, ...secrets]),
  };
}

/** Lines the CLI prints to stderr at startup: what is configured (never the values) and warnings. */
export function startupNotes(input: BonumMcpServerDeps): string[] {
  const deps = resolveDeps(input);
  const notes = [
    `${VERSION} serving MCP on stdio; Bonum ${deps.environment} (${deps.baseUrl}); ` +
      `merchant key ${state(deps.client)}, webhook secret ${state(deps.webhooks)}, ` +
      `gateway credentials ${state(deps.gateway)}, gateway checksum key ${state(deps.gatewayWebhooks)}.`,
    ...deps.warnings.map((warning) => `warning: ${warning}`),
  ];
  if (deps.environment === 'production') {
    notes.push(
      'warning: BONUM_ENV=production: the payment tools read live data, create_invoice creates ' +
        'real invoices, and test webhooks are off.',
    );
  }
  return notes.map(deps.redact);
}

function state(dependency: object | undefined): string {
  return dependency === undefined ? 'not set' : 'set';
}

// MCP clients substitute `${VAR}` (Claude Code) or `${env:VAR}` (Cursor, VS Code) in their
// configs. Claude Code passes a reference to an unset variable through as literal text, which
// would otherwise become the merchant key or secret.
const UNEXPANDED_REFERENCE = /\$\{[^}]*\}/;

function readValue(env: Env, name: string, warnings: string[]): string | undefined {
  // Trimmed because MCP client configs and .env files often add stray whitespace or a newline.
  const value = env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  if (!UNEXPANDED_REFERENCE.test(value)) return value;
  warnings.push(
    `${name} is an unexpanded \${...} reference, so it is ignored: set ${name} in the ` +
      'environment that starts your MCP client.',
  );
  return undefined;
}

function readEnvironment(env: Env, warnings: string[]): BonumEnvironment {
  const value = readValue(env, 'BONUM_ENV', warnings);
  if (value === undefined || value === 'sandbox') return 'sandbox';
  if (value === 'production') return 'production';
  warnings.push('BONUM_ENV must be "sandbox" or "production"; using sandbox.');
  return 'sandbox';
}

function readFlag(env: Env, warnings: string[]): boolean {
  const value = readValue(env, 'BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS', warnings);
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  warnings.push(
    'BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS must be "true" or "false"; remote targets stay blocked.',
  );
  return false;
}

interface ClientSettings {
  merchantKey: string;
  environment: BonumEnvironment;
  baseUrl: string | undefined;
  fetch: FetchFunction;
}

function createClient(settings: ClientSettings, warnings: string[]): BonumClient | undefined {
  try {
    return new BonumClient({ ...settings, ...API_SETTINGS });
  } catch (error) {
    // SDK config errors never contain the key, so the message is safe to show.
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`BONUM_MERCHANT_KEY is set, but the payment tools are off: ${reason}`);
    return undefined;
  }
}

// Shown when no client could be built. Never the raw value: a proxy URL may carry credentials.
function displayUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!URL.canParse(raw)) return 'invalid BONUM_BASE_URL';
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
