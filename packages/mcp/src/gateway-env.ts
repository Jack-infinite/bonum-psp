import {
  type BonumEnvironment,
  BonumGatewayClient,
  BonumGatewayWebhooks,
  type FetchFunction,
} from 'bonum-psp';

/** The gateway (invoice) part of the server's dependencies, plus the secrets to redact. */
export interface GatewayEnv {
  gateway: BonumGatewayClient | undefined;
  gatewayWebhooks: BonumGatewayWebhooks | undefined;
  secrets: (string | undefined)[];
}

/** Settings shared with the PSP client. */
export interface GatewaySettings {
  environment: BonumEnvironment;
  fetch: FetchFunction;
  now: () => number;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
}

/**
 * Builds the invoice tools' dependencies from `BONUM_GATEWAY_APP_SECRET`,
 * `BONUM_GATEWAY_TERMINAL_ID`, `BONUM_GATEWAY_CHECKSUM_KEY` and `BONUM_GATEWAY_BASE_URL`.
 * Never throws: problems become warnings and switch off only the affected tools.
 */
export function gatewayFromEnv(
  read: (name: string) => string | undefined,
  settings: GatewaySettings,
  warnings: string[],
): GatewayEnv {
  const appSecret = read('BONUM_GATEWAY_APP_SECRET');
  const terminalId = read('BONUM_GATEWAY_TERMINAL_ID');
  const checksumKey = read('BONUM_GATEWAY_CHECKSUM_KEY');
  const baseUrl = read('BONUM_GATEWAY_BASE_URL');
  return {
    gateway: createGateway(appSecret, terminalId, baseUrl, settings, warnings),
    gatewayWebhooks:
      checksumKey === undefined ? undefined : new BonumGatewayWebhooks({ checksumKey }),
    secrets: [appSecret, checksumKey],
  };
}

function createGateway(
  appSecret: string | undefined,
  terminalId: string | undefined,
  baseUrl: string | undefined,
  settings: GatewaySettings,
  warnings: string[],
): BonumGatewayClient | undefined {
  if (appSecret === undefined && terminalId === undefined) return undefined;
  if (appSecret === undefined || terminalId === undefined) {
    const missing =
      appSecret === undefined ? 'BONUM_GATEWAY_APP_SECRET' : 'BONUM_GATEWAY_TERMINAL_ID';
    warnings.push(`The invoice tools need both gateway credentials; ${missing} is not set.`);
    return undefined;
  }
  try {
    return new BonumGatewayClient({ ...settings, appSecret, terminalId, baseUrl });
  } catch (error) {
    // SDK config errors never contain the secret, so the message is safe to show.
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`BONUM_GATEWAY_APP_SECRET is set, but the invoice tools are off: ${reason}`);
    return undefined;
  }
}
