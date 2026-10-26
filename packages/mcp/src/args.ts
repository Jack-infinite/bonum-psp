import { parseArgs } from 'node:util';

/** What the `bonum-psp-mcp` binary was asked to do. */
export type CliCommand =
  | { kind: 'serve' }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

/** Usage text printed by `bonum-psp-mcp --help`. */
export const HELP_TEXT: string = `Usage: bonum-psp-mcp [--help] [--version]

Runs the Bonum PSP V2 MCP server over stdio. MCP clients (Claude Code, Codex,
Cursor, Claude Desktop, ...) start it for you; you rarely run it by hand.

Environment variables:
  BONUM_MERCHANT_KEY                       merchant API key (payment lookup tools)
  BONUM_WEBHOOK_SECRET                     webhook signing secret (webhook tools)
  BONUM_ENV                                sandbox (default) or production
  BONUM_BASE_URL                           optional API base URL override (e.g. a proxy)
  BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS   true to let send_test_webhook reach non-local hosts

Docs: https://github.com/Jack-infinite/bonum-psp/tree/main/packages/mcp#readme
`;

/**
 * Parses the CLI flags. Anything other than `--help` / `--version` is an error, so a typo
 * never silently starts the server.
 */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) return { kind: 'help' };
    if (values.version === true) return { kind: 'version' };
    return { kind: 'serve' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
