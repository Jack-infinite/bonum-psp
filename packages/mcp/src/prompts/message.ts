import type { GetPromptResult } from '@modelcontextprotocol/server';

/** A prompt result made of one user message. */
export function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}
