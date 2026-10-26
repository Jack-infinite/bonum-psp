import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';
import { MERCHANT_KEY, record, SECRETS, WEBHOOK_SECRET } from './helpers.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = promisify(execFile);

// The smoke test checks the published artifact, so it needs `pnpm build` first (`pnpm check` and
// CI build before testing).
describe('built CLI (dist/cli.js)', () => {
  it('exists; run `pnpm build` first', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('prints its version and help', async () => {
    expect((await run(process.execPath, [CLI, '--version'])).stdout).toBe(`${VERSION}\n`);
    expect((await run(process.execPath, [CLI, '--help'])).stdout).toContain('Usage: bonum-psp-mcp');
    await expect(run(process.execPath, [CLI, '--nope'])).rejects.toMatchObject({ code: 2 });
  });

  it.each(['legacy', 'auto'] as const)(
    'serves 10 tools, 4 resources and 3 prompts over stdio (%s negotiation)',
    async (mode) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI],
        env: {
          ...getDefaultEnvironment(),
          BONUM_MERCHANT_KEY: MERCHANT_KEY,
          BONUM_WEBHOOK_SECRET: WEBHOOK_SECRET,
          BONUM_ENV: 'sandbox',
        },
        stderr: 'pipe',
      });
      let stderr = '';
      transport.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const client = new Client(
        { name: 'bonum-psp-mcp-smoke', version: '0.0.0' },
        { versionNegotiation: { mode } },
      );
      await client.connect(transport);
      try {
        expect(client.getServerVersion()).toMatchObject({ name: 'bonum', version: VERSION });
        expect(record(await client.listTools()).tools).toHaveLength(10);
        expect(record(await client.listResources()).resources).toHaveLength(4);
        expect(record(await client.listPrompts()).prompts).toHaveLength(3);
        const created = record(
          await client.callTool({ name: 'create_test_webhook', arguments: {} }),
        );
        expect(created.isError).toBeFalsy();
      } finally {
        await client.close();
      }
      expect(stderr).toContain('merchant key set, webhook secret set');
      for (const secret of SECRETS) expect(stderr).not.toContain(secret);
    },
  );
});
