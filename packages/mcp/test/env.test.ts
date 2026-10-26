import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { depsFromEnv, startupNotes } from '../src/env.js';
import { MERCHANT_KEY, SECRETS, testDeps, WEBHOOK_SECRET } from './helpers.js';

describe('depsFromEnv', () => {
  it('starts with nothing configured, in sandbox', () => {
    const deps = depsFromEnv({});
    expect(deps).toMatchObject({
      environment: 'sandbox',
      baseUrl: 'https://testpsp.bonum.mn',
      client: undefined,
      webhooks: undefined,
      warnings: [],
      allowRemoteWebhookTargets: false,
    });
  });

  it('builds the client and webhook toolkit from trimmed values', () => {
    const deps = depsFromEnv({
      BONUM_MERCHANT_KEY: ` ${MERCHANT_KEY}\n`,
      BONUM_WEBHOOK_SECRET: `${WEBHOOK_SECRET}\n`,
      BONUM_ENV: 'production',
    });
    expect(deps.environment).toBe('production');
    expect(deps.baseUrl).toBe('https://psp.bonum.mn');
    expect(deps.client?.environment).toBe('production');
    expect(deps.webhooks).toBeDefined();
    expect(deps.redact?.(`key ${MERCHANT_KEY}, secret ${WEBHOOK_SECRET}`)).toBe(
      'key [redacted], secret [redacted]',
    );
  });

  it('never exposes secrets when deps are logged or serialized', () => {
    const deps = testDeps();
    const dumps = [JSON.stringify(deps), inspect(deps, { depth: 5, showHidden: true })];
    for (const dump of dumps) {
      for (const secret of SECRETS) expect(dump).not.toContain(secret);
    }
  });

  it('falls back to sandbox, with a warning, for an unknown BONUM_ENV', () => {
    const deps = depsFromEnv({ BONUM_ENV: 'Production' });
    expect(deps.environment).toBe('sandbox');
    expect(deps.warnings).toEqual(['BONUM_ENV must be "sandbox" or "production"; using sandbox.']);
  });

  it('uses BONUM_BASE_URL, and turns the payment tools off when it is invalid', () => {
    expect(testDeps({ BONUM_BASE_URL: 'https://proxy.example/bonum/' }).baseUrl).toBe(
      'https://proxy.example/bonum',
    );
    const deps = testDeps({ BONUM_BASE_URL: 'http://proxy.example' });
    expect(deps.client).toBeUndefined();
    expect(deps.warnings?.[0]).toMatch(/BONUM_MERCHANT_KEY is set, but .*https:/);
  });

  it('never shows credentials or a query from BONUM_BASE_URL', () => {
    const shown = depsFromEnv({ BONUM_BASE_URL: 'https://user:pass@proxy.example/x/?token=1' });
    expect(shown.baseUrl).toBe('https://proxy.example/x');
    expect(depsFromEnv({ BONUM_BASE_URL: 'not a url' }).baseUrl).toBe('invalid BONUM_BASE_URL');
  });

  it.each([
    ['true', true, 0],
    ['false', false, 0],
    ['', false, 0],
    ['yes', false, 1],
  ])('reads BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=%j', (value, allowed, warnings) => {
    const deps = depsFromEnv({ BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS: value });
    expect(deps.allowRemoteWebhookTargets).toBe(allowed);
    expect(deps.warnings).toHaveLength(warnings);
  });
});

describe('startupNotes', () => {
  it('says what is configured without printing it', () => {
    const notes = startupNotes(testDeps());
    expect(notes).toEqual([
      expect.stringMatching(
        /^\d+\.\d+\.\d+ serving MCP on stdio; Bonum sandbox \(https:\/\/testpsp\.bonum\.mn\); merchant key set, webhook secret set\.$/,
      ),
    ]);
  });

  it('lists warnings and warns about production', () => {
    const notes = startupNotes(depsFromEnv({ BONUM_ENV: 'production', BONUM_BASE_URL: 'nope' }));
    expect(notes[0]).toContain('merchant key not set, webhook secret not set');
    expect(notes.slice(1)).toEqual([expect.stringContaining('test webhooks are off')]);
    expect(startupNotes({ environment: 'sandbox', warnings: ['x'] })).toContain('warning: x');
  });
});
