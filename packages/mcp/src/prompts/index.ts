import type { McpServer } from '@modelcontextprotocol/server';
import { registerDebugWebhook } from './debug-webhook.js';
import { registerIntegrateBonum } from './integrate-bonum.js';
import { registerReviewIntegration } from './review-integration.js';

/** Registers the three prompts. */
export function registerPrompts(server: McpServer): void {
  registerIntegrateBonum(server);
  registerDebugWebhook(server);
  registerReviewIntegration(server);
}
