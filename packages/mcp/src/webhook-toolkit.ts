import { type BonumWebhookEvent, BonumWebhooks, type WebhookHeaders } from 'bonum-psp';
import { type SignedTestWebhook, signTestWebhook } from 'bonum-psp/testing';

/**
 * Webhook verification and test signing with the configured secret. The secret lives in a closure,
 * so the toolkit can be passed around, or even logged, without exposing it. {@link depsFromEnv}
 * builds one from `BONUM_WEBHOOK_SECRET`.
 *
 * @example
 * ```ts
 * import { depsFromEnv } from 'bonum-psp-mcp';
 * import { createTestWebhookEvent } from 'bonum-psp/testing';
 *
 * const { webhooks } = depsFromEnv({ BONUM_WEBHOOK_SECRET: 'test_webhook_secret' });
 * const body = JSON.stringify(createTestWebhookEvent());
 * const signed = await webhooks?.sign(body, Math.floor(Date.now() / 1000));
 * ```
 */
export interface WebhookToolkit {
  /** Verifies like a merchant endpoint would. `atSeconds` pins the clock, to replay old webhooks. */
  verify(rawBody: string, headers: WebhookHeaders, atSeconds?: number): Promise<BonumWebhookEvent>;
  /** Signs `body` with the configured secret, as Bonum would at `timestampSeconds`. */
  sign(body: string, timestampSeconds: number): Promise<SignedTestWebhook>;
}

/**
 * Creates the {@link WebhookToolkit} for one signing secret (non-empty, already trimmed).
 *
 * @example
 * ```ts
 * const toolkit = createWebhookToolkit('test_webhook_secret', Date.now);
 * ```
 */
export function createWebhookToolkit(secret: string, now: () => number): WebhookToolkit {
  const webhooks = new BonumWebhooks({ secret, now });
  return {
    verify(rawBody, headers, atSeconds) {
      const verifier =
        atSeconds === undefined
          ? webhooks
          : new BonumWebhooks({ secret, now: () => atSeconds * 1000 });
      return verifier.verify(rawBody, headers);
    },
    sign: (body, timestampSeconds) =>
      signTestWebhook({ payload: body, secret, timestamp: timestampSeconds }),
  };
}
