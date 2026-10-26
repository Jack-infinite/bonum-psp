import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerTool, requireGateway } from './tool.js';

const outputSchema = z.object({
  environment: z.enum(['sandbox', 'production']).describe('The Bonum environment of this data.'),
  providers: z
    .array(z.object({ provider: z.string(), enabled: z.boolean() }))
    .describe('Payment methods and whether each is switched on for the terminal.'),
});

/** `list_payment_providers`: the payment methods the checkout page can offer. */
export function registerListPaymentProviders(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'list_payment_providers',
    title: 'List payment providers',
    description:
      'List the payment methods (QPAY, E_COMMERCE cards, WE_CHAT, …) and whether each is enabled ' +
      'for the configured Bonum Gateway terminal. Also proves the gateway credentials work.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    callsBonum: true,
    async run(_input, signal) {
      const providers = await requireGateway(deps).invoices.listProviders({ signal });
      const enabled = providers.filter((item) => item.enabled).map((item) => item.provider);
      const disabled = providers.filter((item) => !item.enabled).map((item) => item.provider);
      return {
        summary: [
          `Enabled payment methods: ${enabled.join(', ') || 'none'}.`,
          disabled.length === 0 ? '' : `Disabled: ${disabled.join(', ')}.`,
        ]
          .filter((line) => line !== '')
          .join('\n'),
        data: { environment: deps.environment, providers },
      };
    },
  });
}
