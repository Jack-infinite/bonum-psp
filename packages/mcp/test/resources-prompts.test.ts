import type { GetPromptResult } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, record, type TestClient, testDeps } from './helpers.js';

let mcp: TestClient | undefined;

afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
});

async function open(): Promise<TestClient> {
  mcp = await connect(testDeps());
  return mcp;
}

function promptText(result: GetPromptResult): string {
  const content = result.messages[0]?.content;
  return content?.type === 'text' ? content.text : '';
}

describe('resources', () => {
  it('serves four Markdown guides that link to the official docs', async () => {
    const { client } = await open();
    const { resources } = record(await client.listResources());
    expect(resources.map((resource) => resource.uri)).toEqual([
      'bonum://guides/integration',
      'bonum://guides/webhooks',
      'bonum://reference/api',
      'bonum://checklists/go-live',
    ]);
    for (const resource of resources) {
      expect(resource.mimeType).toBe('text/markdown');
      expect(resource.description).toBeTruthy();
      const { contents } = record(await client.readResource({ uri: resource.uri }));
      const text = contents[0] && 'text' in contents[0] ? contents[0].text : '';
      expect(text, resource.uri).toMatch(/^# Bonum PSP V2: /);
      expect(text, resource.uri).toContain('Unofficial');
      expect(text, resource.uri).toMatch(/https:\/\/psp\.bonum\.mn\/v2\/[a-z-]+\.html/);
    }
  });
});

describe('prompts', () => {
  it('lists three prompts with their arguments', async () => {
    const { client } = await open();
    const { prompts } = record(await client.listPrompts());
    expect(Object.fromEntries(prompts.map((prompt) => [prompt.name, prompt.arguments]))).toEqual({
      integrate_bonum: [
        expect.objectContaining({ name: 'framework', required: false }),
        expect.objectContaining({ name: 'wallets', required: false }),
      ],
      debug_webhook: [expect.objectContaining({ name: 'symptom', required: false })],
      review_bonum_integration: undefined,
    });
  });

  it('tailors integrate_bonum to the framework and wallets', async () => {
    const { client } = await open();
    const express = promptText(
      record(
        await client.getPrompt({
          name: 'integrate_bonum',
          arguments: { framework: 'express', wallets: 'apple' },
        }),
      ),
    );
    expect(express).toContain('express.raw');
    expect(express).toContain('submitApplePay');
    expect(express).not.toContain('submitGooglePay');
    expect(express).toContain('send_test_webhook');

    const nextjs = promptText(
      record(
        await client.getPrompt({
          name: 'integrate_bonum',
          arguments: { framework: 'nextjs', wallets: 'google' },
        }),
      ),
    );
    expect(nextjs).toContain('app/api/webhooks/bonum/route.ts');
    expect(nextjs).not.toContain('submitApplePay');

    const defaults = promptText(record(await client.getPrompt({ name: 'integrate_bonum' })));
    expect(defaults).toContain('Detect the framework');
    expect(defaults).toContain('submitApplePay');
    expect(defaults).toContain('submitGooglePay');
  });

  it('rejects unknown framework values', async () => {
    const { client } = await open();
    await expect(
      client.getPrompt({ name: 'integrate_bonum', arguments: { framework: 'rails' } }),
    ).rejects.toThrow();
  });

  it('puts the symptom into debug_webhook', async () => {
    const { client } = await open();
    const text = promptText(
      record(
        await client.getPrompt({
          name: 'debug_webhook',
          arguments: { symptom: 'every webhook gets 400 signature_mismatch' },
        }),
      ),
    );
    expect(text).toContain('Symptom: every webhook gets 400 signature_mismatch');
    expect(text).toContain('verify_webhook');
    const fallback = promptText(record(await client.getPrompt({ name: 'debug_webhook' })));
    expect(fallback).toContain('Symptom: Bonum webhooks are not accepted');
  });

  it('gives review_bonum_integration the full audit checklist', async () => {
    const { client } = await open();
    const text = promptText(record(await client.getPrompt({ name: 'review_bonum_integration' })));
    expect(text).toContain('12. Logs never contain');
    expect(text).toContain('Idempotency, level 2');
    expect(text).toContain('bonum://checklists/go-live');
  });
});
