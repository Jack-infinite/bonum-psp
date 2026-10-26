import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BonumWebhookError,
  type BonumWebhookEvent,
  BonumWebhooks,
  type FetchFunction,
} from 'bonum-psp';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTarget, isLocalHostname } from '../src/tools/webhook-target.js';
import {
  connect,
  fakeBonum,
  type TestClient,
  testDeps,
  textOf,
  WEBHOOK_SECRET,
} from './helpers.js';

type NodeHandler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => Promise<void>;

interface TestServer {
  url: string;
  close(): Promise<void>;
}

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function listen(handle: NodeHandler): Promise<TestServer> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await handle(req, res, Buffer.concat(chunks));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  cleanup.push(close);
  return { url: `http://127.0.0.1:${port}/webhooks/bonum`, close };
}

function reply(res: ServerResponse, status: number, body: unknown = { received: true }): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** A merchant endpoint built the recommended way, with its own dedupe on webhookId. */
function merchantEndpoint(options: { secret?: string; onDuplicate?: number; onInvalid?: number }) {
  const webhooks = new BonumWebhooks({ secret: options.secret ?? WEBHOOK_SECRET });
  const events: BonumWebhookEvent[] = [];
  const handler: NodeHandler = async (req, res, body) => {
    let event: BonumWebhookEvent;
    try {
      event = await webhooks.verify(body, req.headers);
    } catch (error) {
      if (!(error instanceof BonumWebhookError)) throw error;
      return reply(res, options.onInvalid ?? 400, { error: error.reason });
    }
    const duplicate = events.some((seen) => seen.webhookId === event.webhookId);
    if (!duplicate) events.push(event);
    reply(res, duplicate ? (options.onDuplicate ?? 200) : 200);
  };
  return { handler, events };
}

async function open(env: Record<string, string | undefined> = {}, fetch?: FetchFunction) {
  const mcp: TestClient = await connect(testDeps(env, fetch === undefined ? {} : { fetch }));
  cleanup.push(() => mcp.close());
  return mcp;
}

interface Report {
  passed: number;
  failed: number;
  warnings: number;
  securityFailure: boolean;
  results: { scenario: string; outcome: string; statuses: (number | null)[]; message: string }[];
}

async function run(url: string, args: Record<string, unknown> = {}, mcp?: TestClient) {
  const result = await (mcp ?? (await open())).callTool('send_test_webhook', { url, ...args });
  return { result, report: result.structuredContent as unknown as Report };
}

function outcomes(report: Report): Record<string, string> {
  return Object.fromEntries(report.results.map((item) => [item.scenario, item.outcome]));
}

describe('send_test_webhook', () => {
  it('passes every scenario against a correct endpoint', async () => {
    const endpoint = merchantEndpoint({});
    const server = await listen(endpoint.handler);
    const { result, report } = await run(server.url, { orderId: 'ORD-42', amount: '10.00' });
    expect(result.isError).toBeFalsy();
    expect(report).toMatchObject({ passed: 5, failed: 0, warnings: 0, securityFailure: false });
    expect(report.results.map((item) => item.statuses)).toEqual([
      [200],
      [200],
      [200, 200],
      [400],
      [400],
    ]);
    expect(endpoint.events.map((event) => event.eventType)).toEqual([
      'AUTHORIZED',
      'FAILED',
      'AUTHORIZED',
    ]);
    for (const event of endpoint.events)
      expect(event).toMatchObject({ orderId: 'ORD-42', amount: '10.00' });
    expect(textOf(result)).toContain('5 passed, 0 failed, 0 warnings');
  });

  it('flags an endpoint that accepts everything as a security failure', async () => {
    const server = await listen(async (_req, res) => reply(res, 200));
    const { result, report } = await run(server.url);
    expect(report.securityFailure).toBe(true);
    expect(outcomes(report)).toEqual({
      authorized: 'pass',
      failed: 'pass',
      duplicate: 'pass',
      invalid_signature: 'fail',
      stale_timestamp: 'fail',
    });
    expect(textOf(result)).toMatch(/^🚨 SECURITY FAILURE/);
  });

  it('warns when forged webhooks get a 5xx instead of a 4xx', async () => {
    const server = await listen(merchantEndpoint({ onInvalid: 500 }).handler);
    const { report } = await run(server.url);
    expect(report).toMatchObject({ passed: 3, failed: 0, warnings: 2, securityFailure: false });
    expect(report.results[3]?.message).toContain('Answer 400');
  });

  it('fails an endpoint that rejects a repeated delivery', async () => {
    const server = await listen(merchantEndpoint({ onDuplicate: 409 }).handler);
    const { report } = await run(server.url, { scenario: 'duplicate' });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ outcome: 'fail', statuses: [200, 409] });
    expect(report.results[0]?.message).toContain('Rejected the repeated delivery with 409');
  });

  it('shows the endpoint answer when a genuine webhook is rejected', async () => {
    const server = await listen(merchantEndpoint({ secret: 'some_other_secret' }).handler);
    const { report } = await run(server.url, { scenario: 'authorized' });
    expect(report.results[0]?.outcome).toBe('fail');
    expect(report.results[0]?.message).toContain('Response: {"error":"signature_mismatch"}');
  });

  it('reports 5xx answers to genuine webhooks', async () => {
    const server = await listen(async (_req, res) => reply(res, 503, { error: 'down' }));
    const { report } = await run(server.url, { scenario: 'failed' });
    expect(report.results[0]?.message).toContain('Answered 503, so Bonum would retry');
  });

  it('does not follow redirects', async () => {
    let redirected = 0;
    const target = await listen(async (_req, res) => {
      redirected += 1;
      reply(res, 200);
    });
    const server = await listen(async (_req, res) => {
      res.writeHead(307, { location: target.url }).end();
    });
    const { report } = await run(server.url, { scenario: 'authorized' });
    expect(report.results[0]?.message).toContain(`redirects to ${target.url}`);
    expect(redirected).toBe(0);
  });

  it('asks whether the server is running when nothing listens', async () => {
    const server = await listen(async (_req, res) => reply(res, 200));
    await server.close();
    const { report } = await run(server.url, { scenario: 'authorized' });
    expect(report.results[0]).toMatchObject({ outcome: 'fail', statuses: [null] });
    expect(report.results[0]?.message).toContain('Is your server running?');
  });

  it.each([
    [
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      'Host shop.example.com was not found.',
    ],
    [new Error('other side closed'), 'Request failed: other side closed'],
  ])('explains other network errors (%s)', async (cause, message) => {
    const bonum = fakeBonum(() => Promise.reject(new TypeError('fetch failed', { cause })));
    const mcp = await open({ BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS: 'true' }, bonum.fetch);
    const url = 'https://shop.example.com/webhooks/bonum';
    const { report } = await run(url, { scenario: 'authorized' }, mcp);
    expect(report.results[0]).toMatchObject({ outcome: 'fail', statuses: [null] });
    expect(report.results[0]?.message).toContain(message);
  });

  it('refuses remote targets unless they are allowed', async () => {
    const bonum = fakeBonum(() => new Response('{}', { status: 200 }));
    const blocked = await run(
      'https://shop.example.com/webhooks/bonum',
      {},
      await open({}, bonum.fetch),
    );
    expect(blocked.result.isError).toBe(true);
    expect(textOf(blocked.result)).toContain('Refusing to send test webhooks to shop.example.com');
    expect(bonum.calls).toHaveLength(0);

    const allowed = await open({ BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS: 'true' }, bonum.fetch);
    const { report } = await run('https://shop.example.com/webhooks/bonum', {}, allowed);
    expect(report.securityFailure).toBe(true);
    expect(bonum.calls).toHaveLength(6);
  });

  it('refuses to sign in production, and explains a missing secret', async () => {
    const production = await run(
      'http://localhost:3000/x',
      {},
      await open({ BONUM_ENV: 'production' }),
    );
    expect(textOf(production.result)).toContain('Refusing to sign test webhooks');
    const noSecret = await run(
      'http://localhost:3000/x',
      {},
      await open({ BONUM_WEBHOOK_SECRET: undefined }),
    );
    expect(textOf(noSecret.result)).toContain('Set BONUM_WEBHOOK_SECRET');
  });

  it('rejects URLs that are not plain http(s)', async () => {
    const mcp = await open();
    for (const url of ['file:///etc/passwd', 'http://user:pass@localhost/x', 'not a url']) {
      const { result } = await run(url, {}, mcp);
      expect(result.isError, url).toBe(true);
    }
  });
});

describe('webhook targets', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'shop.localhost', 'shop.test'])(
    'allows %s',
    (host) => {
      expect(isLocalHostname(new URL(`http://${host}:3000/`).hostname)).toBe(true);
    },
  );

  it.each(['example.com', 'localhost.example.com', '127.0.0.2', '0.0.0.0', 'test.example'])(
    'blocks %s',
    (host) => {
      expect(isLocalHostname(new URL(`http://${host}/`).hostname)).toBe(false);
    },
  );

  it('normalizes the URL and allows remote hosts on request', () => {
    expect(checkTarget('HTTP://LOCALHOST:3000/hook', false).href).toBe(
      'http://localhost:3000/hook',
    );
    expect(checkTarget('https://shop.example.com/hook', true).hostname).toBe('shop.example.com');
  });
});
