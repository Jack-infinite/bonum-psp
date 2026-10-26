import { describe, expect, it } from 'vitest';
import { createRedactor, redactDeep } from '../src/redact.js';

describe('createRedactor', () => {
  it('replaces every occurrence of every secret', () => {
    const redact = createRedactor(['mk_test_example', 'test_webhook_secret']);
    expect(redact('mk_test_example and test_webhook_secret, again mk_test_example')).toBe(
      '[redacted] and [redacted], again [redacted]',
    );
  });

  it('replaces a secret that contains another one as a whole', () => {
    const redact = createRedactor(['secret', 'long_secret_value']);
    expect(redact('long_secret_value / secret')).toBe('[redacted] / [redacted]');
  });

  it('ignores missing and empty secrets', () => {
    const redact = createRedactor([undefined, '']);
    expect(redact('nothing to hide')).toBe('nothing to hide');
  });
});

describe('redactDeep', () => {
  it('redacts strings at any depth and keeps everything else', () => {
    const redact = createRedactor(['hunter2']);
    const value = { a: 'hunter2', b: [1, null, { c: 'x hunter2 y' }], d: true, e: { f: 'ok' } };
    expect(redactDeep(value, redact)).toEqual({
      a: '[redacted]',
      b: [1, null, { c: 'x [redacted] y' }],
      d: true,
      e: { f: 'ok' },
    });
  });
});
