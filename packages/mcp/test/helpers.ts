import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { type CallToolResult, createMcpHandler } from '@modelcontextprotocol/server';
import type { FetchFunction } from 'bonum-psp';
import type { BonumMcpServerDeps } from '../src/deps.js';
import { type DepsFromEnvOptions, depsFromEnv } from '../src/env.js';
import { createBonumMcpServer } from '../src/server.js';

/**
 * Obviously fake credentials: never put a real key or secret in a test. They differ from the
 * placeholders the guides and prompts recommend (mk_test_example, test_webhook_secret), so the
 * secret scan in setup.ts cannot mistake documentation for a leak.
 */
export const MERCHANT_KEY = 'mk_test_mcp_suite';
export const WEBHOOK_SECRET = 'test_secret_mcp_suite';
export const SECRETS: readonly string[] = [MERCHANT_KEY, WEBHOOK_SECRET];

export const PAYMENT_ID = '3f0c5d2e-8b1a-4c6f-9e7d-2a1b0c9d8e7f';
export const ORDER_ID = 'ORD-1001';
export const NOW_MS = 1_793_000_000_000;

export const paymentBody = {
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  amount: '150.50',
  currency: 'MNT',
  walletType: 'APPLE_PAY',
  status: 'AUTHORIZED',
  providerReference: 'BANK-REF-0001',
  failureReason: null,
  createdAt: '2026-10-26T04:00:00.000Z',
  updatedAt: '2026-10-26T04:00:02.000Z',
};

const transcript: string[] = [];

/** Returns and clears every MCP response recorded since the last call (see setup.ts). */
export function drainTranscript(): string[] {
  return transcript.splice(0);
}

/** Records an MCP response for the secret scan and returns it. */
export function record<T>(value: T): T {
  transcript.push(JSON.stringify(value));
  return value;
}

/** Deps as the CLI builds them, with fake credentials unless `env` says otherwise. */
export function testDeps(
  env: Record<string, string | undefined> = {},
  options: DepsFromEnvOptions = {},
): BonumMcpServerDeps {
  return depsFromEnv(
    { BONUM_MERCHANT_KEY: MERCHANT_KEY, BONUM_WEBHOOK_SECRET: WEBHOOK_SECRET, ...env },
    options,
  );
}

export interface TestClient {
  client: Client;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Connects an MCP client to the server in-process, over the 2026-07-28 HTTP transport. */
export async function connect(deps: BonumMcpServerDeps): Promise<TestClient> {
  const handler = createMcpHandler(() => createBonumMcpServer(deps));
  const client = new Client(
    { name: 'bonum-psp-mcp-tests', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return {
    client,
    callTool: async (name, args = {}) =>
      record((await client.callTool({ name, arguments: args })) as CallToolResult),
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

/** The text of a tool result's first content block. */
export function textOf(result: CallToolResult): string {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : '';
}

export interface BonumCall {
  url: URL;
  method: string;
  headers: Headers;
}

/** A fake Bonum API: answers every request with `reply` and records what was asked. */
export function fakeBonum(reply: (call: BonumCall) => Response | Promise<Response>): {
  fetch: FetchFunction;
  calls: BonumCall[];
} {
  const calls: BonumCall[] = [];
  const fetch: FetchFunction = async (url, init) => {
    const call = {
      url: new URL(url),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
    };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

/** A JSON response, the way Bonum sends one. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
