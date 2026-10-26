import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // The CLI entry only wires env → serveStdio; the stdio smoke test exercises it in a child process.
      exclude: ['packages/mcp/src/cli.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'packages/sdk/src/**': { lines: 95, branches: 90 },
        'packages/mcp/src/**': { lines: 85 },
      },
    },
  },
});
