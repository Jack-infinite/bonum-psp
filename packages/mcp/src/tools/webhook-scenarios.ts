import { createTestWebhookEvent, type SignedTestWebhook, signTestWebhook } from 'bonum-psp/testing';
import type { WebhookToolkit } from '../webhook-toolkit.js';
import type { Delivery } from './webhook-delivery.js';

/** The checks `send_test_webhook` runs, in the order `all` runs them. */
export const SCENARIOS = [
  'authorized',
  'failed',
  'duplicate',
  'invalid_signature',
  'stale_timestamp',
] as const;

/** One of {@link SCENARIOS}. */
export type Scenario = (typeof SCENARIOS)[number];

type Expected = '2xx' | '4xx';

/** What one scenario sends, and what a correct endpoint answers. */
export interface ScenarioPlan {
  scenario: Scenario;
  expected: Expected;
  /** Sent in order; `duplicate` sends the same request twice. */
  requests: readonly SignedTestWebhook[];
}

/** The verdict on one scenario. */
export interface ScenarioResult {
  scenario: Scenario;
  expected: Expected;
  statuses: (number | null)[];
  durationMs: number;
  outcome: 'pass' | 'fail' | 'warn';
  /** A webhook that must be rejected got a 2xx: anyone could fake a payment. */
  securityFailure: boolean;
  message: string;
}

/** Inputs shared by every scenario of one run. */
export interface PlanContext {
  webhooks: WebhookToolkit;
  nowSeconds: number;
  orderId?: string | undefined;
  amount?: string | undefined;
}

// Twice Bonum's 300 s window, so a correct endpoint rejects it whatever its clock skew.
const STALE_SECONDS = 600;

/** Builds the signed requests for one scenario. */
export async function planScenario(
  scenario: Scenario,
  context: PlanContext,
): Promise<ScenarioPlan> {
  const { webhooks, nowSeconds, orderId, amount } = context;
  const body = (eventType: 'AUTHORIZED' | 'FAILED'): string =>
    JSON.stringify(createTestWebhookEvent({ eventType, orderId, amount }));
  switch (scenario) {
    case 'authorized':
      return plan(scenario, '2xx', await webhooks.sign(body('AUTHORIZED'), nowSeconds));
    case 'failed':
      return plan(scenario, '2xx', await webhooks.sign(body('FAILED'), nowSeconds));
    case 'duplicate': {
      const signed = await webhooks.sign(body('AUTHORIZED'), nowSeconds);
      return plan(scenario, '2xx', signed, signed);
    }
    case 'invalid_signature': {
      // A fresh random secret: whatever the endpoint uses, this signature cannot match it.
      const secret = `wrong_secret_${crypto.randomUUID()}`;
      const payload = body('AUTHORIZED');
      return plan(
        scenario,
        '4xx',
        await signTestWebhook({ payload, secret, timestamp: nowSeconds }),
      );
    }
    case 'stale_timestamp':
      return plan(
        scenario,
        '4xx',
        await webhooks.sign(body('AUTHORIZED'), nowSeconds - STALE_SECONDS),
      );
  }
}

function plan(
  scenario: Scenario,
  expected: Expected,
  ...requests: SignedTestWebhook[]
): ScenarioPlan {
  return { scenario, expected, requests };
}

/** Compares what the endpoint answered with what a correct endpoint answers. */
export function judge(plan: ScenarioPlan, deliveries: readonly Delivery[]): ScenarioResult {
  const verdicts = deliveries.map((delivery, index) => verdict(plan, delivery, index));
  const failed = verdicts.find((item) => item.outcome === 'fail');
  const warned = verdicts.find((item) => item.outcome === 'warn');
  const worst = failed ?? warned ?? verdicts[0];
  return {
    scenario: plan.scenario,
    expected: plan.expected,
    statuses: deliveries.map((delivery) => delivery.status),
    durationMs: deliveries.reduce((total, delivery) => total + delivery.durationMs, 0),
    outcome: worst?.outcome ?? 'fail',
    securityFailure: verdicts.some((item) => item.securityFailure),
    message: worst?.message ?? 'Nothing was sent.',
  };
}

interface Verdict {
  outcome: ScenarioResult['outcome'];
  securityFailure: boolean;
  message: string;
}

function verdict({ scenario, expected }: ScenarioPlan, delivery: Delivery, index: number): Verdict {
  const { status, detail } = delivery;
  const response = detail === '' ? '' : ` Response: ${detail}`;
  if (status === null) return { outcome: 'fail', securityFailure: false, message: detail };
  if (status >= 300 && status < 400) {
    const message = `Answered ${status} (${detail}). Webhooks are not redirected: register the final URL.`;
    return { outcome: 'fail', securityFailure: false, message };
  }
  if (expected === '2xx') return expectAccepted(scenario, status, index, response);
  return expectRejected(scenario, status, response);
}

function expectAccepted(
  scenario: Scenario,
  status: number,
  index: number,
  response: string,
): Verdict {
  if (status >= 200 && status < 300) {
    return { outcome: 'pass', securityFailure: false, message: 'Accepted, as it should be.' };
  }
  const message =
    status >= 500
      ? `Answered ${status}, so Bonum would retry. Check the server logs: the event handler probably threw.`
      : index > 0
        ? `Rejected the repeated delivery with ${status}. Bonum can deliver an event more than once: ` +
          'answer 2xx for duplicates and skip the work.'
        : `Rejected a correctly signed ${scenario} webhook with ${status}. Check that the endpoint ` +
          'verifies the raw body, and uses the same secret as BONUM_WEBHOOK_SECRET.';
  return { outcome: 'fail', securityFailure: false, message: message + response };
}

function expectRejected(scenario: Scenario, status: number, response: string): Verdict {
  const problem =
    scenario === 'invalid_signature' ? 'an invalid signature' : 'a 10-minute-old timestamp';
  if (status >= 400 && status < 500) {
    return { outcome: 'pass', securityFailure: false, message: 'Rejected, as it should be.' };
  }
  if (status >= 500) {
    const message =
      `Rejected it, but with ${status}: Bonum treats 5xx as a failed delivery and retries. ` +
      'Answer 400 for webhooks that fail verification.';
    return { outcome: 'warn', securityFailure: false, message: message + response };
  }
  const message =
    `SECURITY: accepted a webhook with ${problem} (${status}). Anyone could fake a payment ` +
    'notification. Verify X-PSP-Signature and X-PSP-Timestamp before doing any work.';
  return { outcome: 'fail', securityFailure: true, message };
}
