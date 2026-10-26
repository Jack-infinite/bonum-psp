import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import { isBonumError } from 'bonum-psp';
import type { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { redactDeep } from '../redact.js';

/** A problem the user can fix. Its message becomes the text of an `isError` result. */
export class ToolError extends Error {
  override readonly name: string = 'ToolError';
}

/** What a tool returns: a short summary for people, and data matching its output schema. */
export interface ToolAnswer<Data> {
  summary: string;
  data: Data;
}

/** One MCP tool. Each lives in its own file and is registered through {@link registerTool}. */
export interface BonumTool<Input extends z.ZodObject, Output extends z.ZodObject> {
  name: string;
  title: string;
  /** Says when to use the tool; agents pick tools by this text. */
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  annotations: ToolAnnotations;
  /** Calls Bonum's API, so results carry the production warning when BONUM_ENV=production. */
  callsBonum: boolean;
  run(input: z.output<Input>, signal: AbortSignal): Promise<ToolAnswer<z.output<Output>>>;
}

const PRODUCTION_WARNING =
  '⚠️ PRODUCTION (BONUM_ENV=production): this is live payment data from Bonum.\n\n';

/**
 * Registers a tool so that every failure becomes an `isError` result with an actionable message,
 * and every output passes through `redact()`. The MCP SDK would otherwise turn a thrown error into
 * a result itself, bypassing redaction.
 */
export function registerTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  server: McpServer,
  deps: ResolvedDeps,
  tool: BonumTool<Input, Output>,
): void {
  const { name, run, callsBonum, ...config } = tool;
  // Widened to the SDK's schema type: with generic schemas its callback type would stay unresolved.
  const inputSchema: StandardSchemaWithJSON = tool.inputSchema;
  const outputSchema: StandardSchemaWithJSON = tool.outputSchema;
  const prefix = callsBonum && deps.environment === 'production' ? PRODUCTION_WARNING : '';
  const options = { ...config, inputSchema, outputSchema };
  server.registerTool(name, options, async (input, ctx): Promise<CallToolResult> => {
    try {
      // The SDK has already validated `input` against `inputSchema`.
      const { summary, data } = await run(input as z.output<Input>, ctx.mcpReq.signal);
      return {
        content: [{ type: 'text', text: deps.redact(prefix + summary) }],
        structuredContent: redactDeep(data as Record<string, unknown>, deps.redact),
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: deps.redact(prefix + errorMessage(error)) }],
        isError: true,
      };
    }
  });
}

function errorMessage(error: unknown): string {
  // SDK errors are written to say what to do next, and never contain secrets.
  if (error instanceof ToolError || isBonumError(error)) return error.message;
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Returns the payments client, or explains how to configure one. */
export function requireClient(deps: ResolvedDeps): NonNullable<ResolvedDeps['client']> {
  if (deps.client !== undefined) return deps.client;
  throw new ToolError(
    withWarnings(
      deps,
      'This tool needs a Bonum merchant key. Set BONUM_MERCHANT_KEY in the env of the "bonum" ' +
        'MCP server (in your MCP client config) and restart the server.',
    ),
  );
}

/** Returns the webhook toolkit, or explains how to configure the signing secret. */
export function requireWebhooks(deps: ResolvedDeps): NonNullable<ResolvedDeps['webhooks']> {
  if (deps.webhooks !== undefined) return deps.webhooks;
  throw new ToolError(
    withWarnings(
      deps,
      'This tool needs the webhook signing secret. Set BONUM_WEBHOOK_SECRET in the env of the ' +
        '"bonum" MCP server (in your MCP client config) and restart the server. Use the secret ' +
        'for the same environment (sandbox or production) as the webhooks you test.',
    ),
  );
}

function withWarnings(deps: ResolvedDeps, message: string): string {
  if (deps.warnings.length === 0) return message;
  return `${message}\nConfiguration warnings: ${deps.warnings.join(' ')}`;
}
