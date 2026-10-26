import { afterEach, expect } from 'vitest';
import { drainTranscript, SECRETS } from './helpers.js';

// Tests must never pick up a developer's real Bonum credentials from the shell.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('BONUM_')) delete process.env[name];
}

// Every MCP response a test received is scanned: no output may ever contain a secret.
afterEach(() => {
  for (const entry of drainTranscript()) {
    for (const secret of SECRETS) expect(entry).not.toContain(secret);
  }
});
