import type { McpServer } from '@modelcontextprotocol/server';
import {
  BonumAuthenticationError,
  type BonumClient,
  BonumConnectionError,
  BonumNotFoundError,
  BonumTimeoutError,
  isBonumError,
} from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { VERSION } from '../version.js';
import { registerTool } from './tool.js';

const AUTH_STATES = ['ok', 'invalid_key', 'unreachable', 'error', 'not_configured'] as const;

const outputSchema = z.object({
  environment: z.enum(['sandbox', 'production']),
  baseUrl: z.string(),
  merchantKeyConfigured: z.boolean().describe('Whether the payment tools have a merchant key.'),
  webhookSecretConfigured: z.boolean().describe('Whether the webhook tools have a secret.'),
  auth: z.enum(AUTH_STATES).describe('Result of an authenticated request to Bonum.'),
  authDetail: z.string(),
  warnings: z.array(z.string()).describe('Configuration problems to fix.'),
  serverVersion: z.string(),
});

type AuthState = (typeof AUTH_STATES)[number];

/** `check_connection`: configuration and merchant-key check, without touching any payment. */
export function registerCheckConnection(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'check_connection',
    title: 'Check Bonum connection',
    description:
      'Start here. Shows which Bonum environment and base URL this server uses and which ' +
      'credentials are configured (never their values), and checks that Bonum accepts the ' +
      'merchant key, using a lookup of a random payment id that touches no real payment.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    callsBonum: true,
    async run(_input, signal) {
      const { auth, authDetail } = await checkAuth(deps.client, signal);
      const data = {
        environment: deps.environment,
        baseUrl: deps.baseUrl,
        merchantKeyConfigured: deps.client !== undefined,
        webhookSecretConfigured: deps.webhooks !== undefined,
        auth,
        authDetail,
        warnings: [...deps.warnings],
        serverVersion: VERSION,
      };
      return { summary: summarize(data), data };
    },
  });
}

async function checkAuth(
  client: BonumClient | undefined,
  signal: AbortSignal,
): Promise<{ auth: AuthState; authDetail: string }> {
  if (client === undefined) {
    return {
      auth: 'not_configured',
      authDetail: 'BONUM_MERCHANT_KEY is not set, so the payment tools are off.',
    };
  }
  try {
    // A random id proves the key and the routing without reading any real payment.
    await client.payments.get(crypto.randomUUID(), { signal });
    return { auth: 'ok', authDetail: 'Bonum accepted the merchant key.' };
  } catch (error) {
    if (error instanceof BonumNotFoundError) {
      return {
        auth: 'ok',
        authDetail: 'Bonum accepted the merchant key (404 for a random payment id, as expected).',
      };
    }
    if (error instanceof BonumAuthenticationError) {
      return {
        auth: 'invalid_key',
        authDetail:
          'Bonum rejected the merchant key (HTTP 401). Check BONUM_MERCHANT_KEY, and that BONUM_ENV ' +
          'matches the environment the key was issued for (sandbox keys do not work in production).',
      };
    }
    if (error instanceof BonumConnectionError || error instanceof BonumTimeoutError) {
      return { auth: 'unreachable', authDetail: error.message };
    }
    if (isBonumError(error)) return { auth: 'error', authDetail: error.message };
    throw error;
  }
}

function summarize(data: {
  environment: string;
  baseUrl: string;
  webhookSecretConfigured: boolean;
  authDetail: string;
  warnings: string[];
}): string {
  const secret = data.webhookSecretConfigured
    ? 'set'
    : 'not set (verify_webhook, create_test_webhook and send_test_webhook need BONUM_WEBHOOK_SECRET)';
  return [
    `Bonum ${data.environment} at ${data.baseUrl}.`,
    `Merchant key: ${data.authDetail}`,
    `Webhook secret: ${secret}.`,
    ...data.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n');
}
