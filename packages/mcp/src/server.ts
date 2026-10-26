import { McpServer } from '@modelcontextprotocol/server';
import { type BonumMcpServerDeps, resolveDeps } from './deps.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';
import { VERSION } from './version.js';

const INSTRUCTIONS = `Unofficial tools for Bonum PSP V2: Apple Pay and Google Pay payments through Bonum (Mongolia), where the bank's answer arrives asynchronously by webhook.

- check_connection: start here. Shows the environment and which credentials are configured, and checks the merchant key.
- get_payment / get_payment_by_order_id: the current state of a payment. Only AUTHORIZED is safe to fulfil; PENDING is not a failure.
- wait_for_payment_result: waits up to 28 s for the bank's answer to a PENDING payment.
- verify_webhook: checks a captured webhook body and headers against the signing secret and explains failures.
- create_test_webhook / send_test_webhook: signed sample webhooks to test the developer's endpoint (sandbox only; local hosts by default).

Guides: bonum://guides/integration, bonum://guides/webhooks, bonum://reference/api, bonum://checklists/go-live. Credentials come only from the server's environment; never ask the user to paste a merchant key or secret.`;

/**
 * Creates the Bonum MCP server: 7 tools, 4 resources and 3 prompts. A pure factory, so one set of
 * deps can serve many connections (stdio, or HTTP via the MCP SDK's handlers).
 *
 * @example
 * ```ts
 * import { createBonumMcpServer, depsFromEnv } from 'bonum-psp-mcp';
 * import { serveStdio } from '@modelcontextprotocol/server/stdio';
 *
 * const deps = depsFromEnv(process.env);
 * serveStdio(() => createBonumMcpServer(deps));
 * ```
 */
export function createBonumMcpServer(deps: BonumMcpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'bonum', title: 'Bonum PSP (unofficial)', version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, resolveDeps(deps));
  registerResources(server);
  registerPrompts(server);
  return server;
}
