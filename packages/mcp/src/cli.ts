#!/usr/bin/env node
import { HELP_TEXT, parseCliArgs } from './args.js';
import { VERSION } from './version.js';

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
    process.stderr.write('bonum-psp-mcp: the MCP server is not implemented yet.\n');
    process.exitCode = 1;
    break;
}
