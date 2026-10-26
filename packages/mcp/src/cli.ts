#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { HELP_TEXT, parseCliArgs } from './args.js';
import { depsFromEnv, startupNotes } from './env.js';
import { createBonumMcpServer } from './server.js';
import { VERSION } from './version.js';

// stdout carries JSON-RPC once the server runs, so every log line goes to stderr.
function log(message: string): void {
  process.stderr.write(`bonum-psp-mcp: ${message}\n`);
}

function serve(): void {
  const deps = depsFromEnv(process.env);
  for (const note of startupNotes(deps)) log(note);
  const redact = deps.redact ?? ((text: string) => text);
  const handle = serveStdio(() => createBonumMcpServer(deps), {
    onerror: (error) => log(redact(`transport error: ${error.message}`)),
  });
  const shutdown = (): void => {
    // Exit even if closing hangs; a client that sent a signal does not wait for us.
    setTimeout(() => process.exit(0), 2_000).unref();
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const command = parseCliArgs(process.argv.slice(2));

switch (command.kind) {
  case 'help':
    process.stdout.write(HELP_TEXT);
    break;
  case 'version':
    process.stdout.write(`${VERSION}\n`);
    break;
  case 'error':
    process.stderr.write(`bonum-psp-mcp: ${command.message}\n\n${HELP_TEXT}`);
    process.exitCode = 2;
    break;
  case 'serve':
    serve();
    break;
}
