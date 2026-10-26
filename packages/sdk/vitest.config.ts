import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'sdk',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
  },
});
