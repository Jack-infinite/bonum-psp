import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { assertSandbox, nowSeconds, testAmountSchema, testOrderIdSchema } from './test-webhooks.js';
import { registerTool, requireWebhooks } from './tool.js';
import { type Delivery, deliver } from './webhook-delivery.js';
import {
  judge,
  planScenario,
  SCENARIOS,
  type Scenario,
  type ScenarioResult,
} from './webhook-scenarios.js';
import { checkTarget } from './webhook-target.js';

const inputSchema = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .describe(
      'Your webhook endpoint, e.g. http://localhost:3000/webhooks/bonum. Only localhost, ' +
        '127.0.0.1, [::1], *.localhost and *.test unless the server runs with ' +
        'BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=true.',
    ),
  scenario: z
    .enum([...SCENARIOS, 'all'])
    .default('all')
    .describe(
      'Which check to run. "all" runs every one: authorized, failed, duplicate (the same ' +
        'delivery twice), invalid_signature (signed with a wrong secret) and stale_timestamp ' +
        '(correctly signed, 10 minutes old).',
    ),
  orderId: testOrderIdSchema,
  amount: testAmountSchema,
});

const outputSchema = z.object({
  url: z.string(),
  passed: z.number().int(),
  failed: z.number().int(),
  warnings: z.number().int(),
  securityFailure: z.boolean().describe('true if a webhook that must be rejected got a 2xx.'),
  results: z.array(
    z.object({
      scenario: z.enum(SCENARIOS),
      expected: z.enum(['2xx', '4xx']),
      statuses: z
        .array(z.number().int().nullable())
        .describe('HTTP status of each request; null when no response arrived.'),
      durationMs: z.number(),
      outcome: z.enum(['pass', 'fail', 'warn']),
      securityFailure: z.boolean(),
      message: z.string(),
    }),
  ),
});

/** `send_test_webhook`: sends signed test webhooks to the developer's endpoint and grades it. */
export function registerSendTestWebhook(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'send_test_webhook',
    title: 'Send test webhooks',
    description:
      'Test a webhook endpoint the way Bonum delivers webhooks: sends signed AUTHORIZED and ' +
      'FAILED events, a duplicate delivery, a wrongly signed event and a stale one, then reports ' +
      'which answers are right (2xx for genuine events, 4xx for forged ones). Use it after ' +
      'building or changing a Bonum webhook handler, e.g. "Test my webhook at ' +
      'http://localhost:3000/webhooks/bonum".',
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callsBonum: false,
    async run({ url, scenario, orderId, amount }, signal) {
      assertSandbox(deps);
      const target = checkTarget(url, deps.allowRemoteWebhookTargets);
      const webhooks = requireWebhooks(deps);
      const scenarios: readonly Scenario[] = scenario === 'all' ? SCENARIOS : [scenario];
      const results: ScenarioResult[] = [];
      // One at a time, in order: duplicates must arrive after the original, and logs stay readable.
      for (const name of scenarios) {
        const context = { webhooks, nowSeconds: nowSeconds(deps), orderId, amount };
        const plan = await planScenario(name, context);
        const deliveries: Delivery[] = [];
        for (const request of plan.requests) {
          deliveries.push(await deliver(deps.fetch, target, request, signal));
        }
        results.push(judge(plan, deliveries));
      }
      const data = { url: target.href, ...count(results), results };
      return { summary: summarize(data), data };
    },
  });
}

function count(results: readonly ScenarioResult[]) {
  const total = (outcome: ScenarioResult['outcome']): number =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    passed: total('pass'),
    failed: total('fail'),
    warnings: total('warn'),
    securityFailure: results.some((result) => result.securityFailure),
  };
}

function summarize(data: z.output<typeof outputSchema>): string {
  const lines: string[] = [];
  const insecure = data.results.filter((result) => result.securityFailure);
  if (insecure.length > 0) {
    lines.push(
      `🚨 SECURITY FAILURE: ${data.url} accepted webhooks it must reject ` +
        `(${insecure.map((result) => result.scenario).join(', ')}). Anyone who finds the URL ` +
        'could fake a successful payment. Verify the signature and timestamp before any work.',
      '',
    );
  }
  lines.push(
    `Webhook test of ${data.url}: ${data.passed} passed, ${data.failed} failed, ` +
      `${data.warnings} warnings.`,
  );
  for (const result of data.results) {
    const statuses = result.statuses.map((status) => status ?? 'no response').join(', ');
    lines.push(
      `${result.outcome.toUpperCase()} ${result.scenario}: ${statuses} in ${result.durationMs} ms ` +
        `(expected ${result.expected}). ${result.message}`,
    );
  }
  return lines.join('\n');
}
