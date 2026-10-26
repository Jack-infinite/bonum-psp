import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
};

describe('package', () => {
  it('exposes the version from package.json (run `pnpm build` if this drifts)', () => {
    expect(VERSION).toBe(manifest.version);
  });

  it('has zero runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });
});
