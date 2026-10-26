import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BONUM_BASE_URLS, BonumClient, BonumConfigError, VERSION } from '../src/index.js';
import { readEnv } from '../src/runtime.js';
import { fakeFetch, json, MERCHANT_KEY, PAYMENT_ID, paymentBody, testClient } from './helpers.js';

const base = { merchantKey: MERCHANT_KEY, environment: 'sandbox' } as const;

function configError(create: () => unknown): BonumConfigError {
  try {
    create();
  } catch (error) {
    expect(error).toBeInstanceOf(BonumConfigError);
    return error as BonumConfigError;
  }
  throw new Error('expected a BonumConfigError');
}

describe('BonumClient configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the merchant key and environment from the environment', () => {
    vi.stubEnv('BONUM_MERCHANT_KEY', ` ${MERCHANT_KEY}\n`);
    vi.stubEnv('BONUM_ENV', 'production');
    const client = new BonumClient();
    expect(client.environment).toBe('production');
    expect(client.baseUrl).toBe(BONUM_BASE_URLS.production);
  });

  it('prefers explicit options over environment variables', () => {
    vi.stubEnv('BONUM_ENV', 'production');
    const client = new BonumClient(base);
    expect(client.environment).toBe('sandbox');
    expect(client.baseUrl).toBe('https://testpsp.bonum.mn');
  });

  it('requires a merchant key and says how to provide one', () => {
    const error = configError(() => new BonumClient({ environment: 'sandbox' }));
    expect(error.code).toBe('invalid_config');
    expect(error.message).toContain('BONUM_MERCHANT_KEY');
    expect(configError(() => new BonumClient({ ...base, merchantKey: '  ' })).message).toContain(
      'Missing Bonum merchant key',
    );
  });

  it('rejects keys with inner whitespace without echoing them', () => {
    const error = configError(() => new BonumClient({ ...base, merchantKey: 'mk_test_ex ample' }));
    expect(error.message).not.toContain('mk_test_ex');
  });

  it('never guesses the environment', () => {
    expect(configError(() => new BonumClient({ merchantKey: MERCHANT_KEY })).message).toContain(
      'BONUM_ENV',
    );
    vi.stubEnv('BONUM_ENV', 'prod');
    expect(configError(() => new BonumClient({ merchantKey: MERCHANT_KEY })).message).toContain(
      "'sandbox' or 'production'",
    );
  });

  it.each([
    ['https://proxy.example.com/', 'https://proxy.example.com'],
    ['https://proxy.example.com/bonum//', 'https://proxy.example.com/bonum'],
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
  ])('accepts baseUrl %s', (baseUrl, expected) => {
    expect(new BonumClient({ ...base, baseUrl }).baseUrl).toBe(expected);
  });

  it.each([
    ['http://proxy.example.com', 'https:'],
    ['ftp://localhost', 'https:'],
    ['not a url', 'absolute URL'],
    ['https://user:pass@proxy.example.com', 'credentials'],
    ['https://proxy.example.com/?a=1', 'query string'],
    ['https://proxy.example.com/#top', 'fragment'],
  ])('rejects baseUrl %s', (baseUrl, message) => {
    expect(configError(() => new BonumClient({ ...base, baseUrl })).message).toContain(message);
  });

  it.each([
    [{ timeoutMs: 0 }, 'timeoutMs'],
    [{ timeoutMs: 1.5 }, 'timeoutMs'],
    [{ maxRetries: -1 }, 'maxRetries'],
    [{ maxRetries: 11 }, 'maxRetries'],
    [{ userAgent: 'bad\nagent' }, 'userAgent'],
    [{ userAgent: ' ' }, 'userAgent'],
    [{ fetch: 'nope' }, 'fetch'],
    [{ sleep: 1 }, 'sleep'],
    [{ random: {} }, 'random'],
  ])('rejects invalid option %o', (option, message) => {
    const options = { ...base, ...option } as unknown as ConstructorParameters<
      typeof BonumClient
    >[0];
    expect(configError(() => new BonumClient(options)).message).toContain(message);
  });

  it('rejects non-object options', () => {
    const options = 'sandbox' as unknown as ConstructorParameters<typeof BonumClient>[0];
    expect(configError(() => new BonumClient(options)).message).toContain('must be an object');
  });

  it('refuses to run in a browser unless explicitly allowed', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(configError(() => new BonumClient(base)).message).toContain('never in the browser');
    expect(new BonumClient({ ...base, dangerouslyAllowBrowser: true }).environment).toBe('sandbox');
  });

  it('uses the global fetch lazily, called as a plain function', async () => {
    const fetch = fakeFetch(json(paymentBody));
    vi.stubGlobal('fetch', fetch);
    const client = new BonumClient(base);
    await client.payments.get(PAYMENT_ID);
    expect(fetch.calls).toHaveLength(1);
  });

  it('explains when the runtime has no fetch', () => {
    vi.stubGlobal('fetch', undefined);
    expect(configError(() => new BonumClient(base)).message).toContain('No global fetch');
  });

  it('appends a custom user agent to the SDK one', async () => {
    const fetch = fakeFetch(json(paymentBody));
    const { client } = testClient(fetch, { userAgent: ' my-shop/1.4.0 ' });
    await client.payments.get(PAYMENT_ID);
    expect(fetch.calls[0]?.headers['user-agent']).toBe(`bonum-psp/${VERSION} my-shop/1.4.0`);
  });

  it('never exposes the merchant key', () => {
    const { client } = testClient(fakeFetch(json(paymentBody)));
    const views = [
      JSON.stringify(client),
      String(client),
      inspect(client, { showHidden: true, depth: Number.POSITIVE_INFINITY }),
      JSON.stringify(Object.entries(client)),
    ];
    for (const view of views) expect(view).not.toContain(MERCHANT_KEY);
  });
});

describe('readEnv', () => {
  it('treats blank values as unset', () => {
    vi.stubEnv('BONUM_TEST_VALUE', '   ');
    expect(readEnv('BONUM_TEST_VALUE')).toBeUndefined();
  });

  it('survives runtimes without process.env or with a throwing env (Deno without --allow-env)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'process');
    if (original === undefined) throw new Error('expected a process global');
    try {
      Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true });
      expect(readEnv('BONUM_ENV')).toBeUndefined();
      Object.defineProperty(globalThis, 'process', {
        value: {
          get env(): never {
            throw new Error('PermissionDenied');
          },
        },
        configurable: true,
      });
      expect(readEnv('BONUM_ENV')).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'process', original);
    }
  });
});
