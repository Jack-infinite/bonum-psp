import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/args.js';
import { VERSION } from '../src/index.js';

describe('parseCliArgs', () => {
  it('serves MCP when no flags are given', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'serve' });
  });

  it.each([['--help'], ['-h']])('recognises %s', (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: 'help' });
  });

  it.each([['--version'], ['-v']])('recognises %s', (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: 'version' });
  });

  it('prefers --help over --version', () => {
    expect(parseCliArgs(['--version', '--help'])).toEqual({ kind: 'help' });
  });

  it('rejects unknown flags and positionals instead of starting the server', () => {
    expect(parseCliArgs(['--verbose'])).toMatchObject({ kind: 'error' });
    expect(parseCliArgs(['serve'])).toMatchObject({ kind: 'error' });
  });
});

describe('VERSION', () => {
  it('matches package.json (run `pnpm build` if this drifts)', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
