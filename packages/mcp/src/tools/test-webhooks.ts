import type { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { amountSchema, orderIdSchema } from './schemas.js';
import { ToolError } from './tool.js';

/** Where `create_test_webhook`'s curl command points unless the caller names a URL. */
export const DEFAULT_WEBHOOK_URL = 'http://localhost:3000/webhooks/bonum';

/** Optional `orderId` input of the test-webhook tools. */
export const testOrderIdSchema: z.ZodOptional<z.ZodString> = orderIdSchema
  .optional()
  .describe('order_id for the test events. Default: a random ORD-TEST-… id.');

/** Optional `amount` input of the test-webhook tools. */
export const testAmountSchema: z.ZodOptional<z.ZodString> = amountSchema
  .optional()
  .describe('Amount as a decimal string in major units, e.g. "150.50". Default "150.50".');

/**
 * Refuses to sign test webhooks in production. A correctly signed fake AUTHORIZED event could be
 * replayed against a live endpoint while its timestamp is fresh (see docs/decisions.md, D4).
 */
export function assertSandbox(deps: ResolvedDeps): void {
  if (deps.environment !== 'production') return;
  throw new ToolError(
    'Refusing to sign test webhooks with BONUM_ENV=production: a correctly signed fake ' +
      'AUTHORIZED event could be replayed against your live endpoint. Run this server with ' +
      'BONUM_ENV=sandbox and the sandbox webhook secret to test endpoints.',
  );
}

/** The current Unix time in whole seconds, as Bonum puts it in `X-PSP-Timestamp`. */
export function nowSeconds(deps: ResolvedDeps): number {
  return Math.floor(deps.now() / 1000);
}
