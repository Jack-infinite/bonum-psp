import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every public export needs TSDoc with an @example (see AGENTS.md). Checked on the sources, so a
// missing doc fails the test run instead of slipping into a release.
const src = new URL('../src/', import.meta.url);
const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('.ts'),
);
const entryPoints = files.filter((file) => /^(index|express|testing)\.ts$/.test(file));

function exportedNames(file: string): string[] {
  const source = readFileSync(new URL(file, src), 'utf8');
  return [...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .filter((name) => name !== ''),
  );
}

const declarations = files.flatMap((file) => {
  const source = readFileSync(new URL(file, src), 'utf8');
  const pattern =
    /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*export (?:declare )?(?:abstract )?(?:async )?(?:class|function|const|interface|type) (\w+)/g;
  return [...source.matchAll(pattern)].map((match) => ({
    file,
    name: match[2],
    doc: match[1] ?? '',
  }));
});

describe('public API docs', () => {
  const names = [...new Set(entryPoints.flatMap(exportedNames))];

  it('finds the public exports', () => {
    expect(names.length).toBeGreaterThan(20);
  });

  it.each(names)('%s has TSDoc with an @example', (name) => {
    const found = declarations.filter((declaration) => declaration.name === name);
    expect(found, `no declaration found for ${name}`).not.toHaveLength(0);
    for (const { file, doc } of found) {
      expect(doc, `${name} in ${file}`).toMatch(/@example/);
    }
  });
});
