import { BonumAPIError } from '../api-errors.js';
import { GATEWAY_HINTS } from '../api-profiles.js';
import { HttpClient, type HttpProfile } from '../http.js';
import type { ResolvedTransport } from '../transport.js';
import { parseTokenGrant, type TokenGrant } from './responses.js';

const AUTH = '/bonum-gateway/ecommerce/auth';
// Renew a minute early, so a token cannot expire between the check and Bonum receiving it.
const RENEW_MARGIN_MS = 60_000;

interface Session {
  accessToken: string;
  accessRenewAt: number;
  refreshToken: string | null;
  refreshRenewAt: number;
}

/**
 * Gets and caches the gateway's bearer token. Bonum rate-limits the token endpoint and asks
 * clients to reuse tokens, so one token serves every request until it is about to expire.
 */
export class GatewayTokens {
  readonly #http: HttpClient;
  readonly #credentials: Readonly<Record<string, string>>;
  readonly #now: () => number;
  #session: Session | undefined;
  #pending: Promise<Session> | undefined;

  constructor(config: ResolvedTransport, appSecret: string, terminalId: string, now: () => number) {
    this.#http = new HttpClient(config, { headers: () => ({}), hints: GATEWAY_HINTS });
    this.#credentials = Object.freeze({
      authorization: `AppSecret ${appSecret}`,
      'x-terminal-id': terminalId,
    });
    this.#now = now;
  }

  /** A valid access token. Concurrent callers share one token request. */
  async accessToken(): Promise<string> {
    const session = this.#session;
    if (session !== undefined && this.#now() < session.accessRenewAt) return session.accessToken;
    this.#pending ??= this.#renew(session).finally(() => {
      this.#pending = undefined;
    });
    return (await this.#pending).accessToken;
  }

  /**
   * Forgets `rejected` after Bonum refused it; the refresh token stays usable. A token that was
   * already replaced is left alone, so late 401s from concurrent requests don't discard a new one.
   */
  invalidate(rejected: string): void {
    if (this.#session?.accessToken === rejected) {
      this.#session = { ...this.#session, accessRenewAt: 0 };
    }
  }

  async #renew(session: Session | undefined): Promise<Session> {
    const refreshToken = session?.refreshToken ?? null;
    if (session !== undefined && refreshToken !== null && this.#now() < session.refreshRenewAt) {
      try {
        return this.#store(
          await this.#grant('refresh', { authorization: `Bearer ${refreshToken}` }),
        );
      } catch (error) {
        // A rejected refresh token is not fatal: the app secret can still get a new one.
        if (!isRejection(error)) throw error;
      }
    }
    return this.#store(await this.#grant('create', this.#credentials));
  }

  #grant(
    action: 'create' | 'refresh',
    headers: Readonly<Record<string, string>>,
  ): Promise<TokenGrant> {
    return this.#http.request<TokenGrant>({
      method: 'GET',
      path: `${AUTH}/${action}`,
      headers,
      parse: parseTokenGrant,
      retry: true,
      hideBody: true,
    });
  }

  #store(grant: TokenGrant): Session {
    const now = this.#now();
    this.#session = {
      accessToken: grant.accessToken,
      accessRenewAt: now + renewAfter(grant.expiresInMs),
      refreshToken: grant.refreshToken,
      refreshRenewAt:
        grant.refreshExpiresInMs === null ? 0 : now + renewAfter(grant.refreshExpiresInMs),
    };
    return this.#session;
  }
}

/** The gateway profile: a bearer token from {@link GatewayTokens}, renewed once after a 401. */
export function bearerProfile(tokens: GatewayTokens): HttpProfile {
  return {
    headers: async () => ({ authorization: `Bearer ${await tokens.accessToken()}` }),
    renew: (rejected) => {
      tokens.invalidate((rejected.authorization ?? '').replace(/^Bearer /, ''));
      return true;
    },
    hints: GATEWAY_HINTS,
  };
}

// Short-lived tokens are used for at least half their life rather than renewed on every call.
function renewAfter(lifetimeMs: number): number {
  return Math.max(lifetimeMs - RENEW_MARGIN_MS, lifetimeMs / 2);
}

function isRejection(error: unknown): boolean {
  return (
    error instanceof BonumAPIError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}
