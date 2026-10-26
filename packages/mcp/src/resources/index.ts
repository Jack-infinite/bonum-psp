import type { McpServer } from '@modelcontextprotocol/server';
import { API_REFERENCE } from './api-reference.js';
import { GO_LIVE_CHECKLIST } from './go-live-checklist.js';
import { INTEGRATION_GUIDE } from './integration-guide.js';
import { WEBHOOK_GUIDE } from './webhook-guide.js';

interface Guide {
  name: string;
  uri: string;
  title: string;
  description: string;
  text: string;
}

const GUIDES: readonly Guide[] = [
  {
    name: 'integration-guide',
    uri: 'bonum://guides/integration',
    title: 'Bonum V2 integration guide',
    description:
      'The V2 payment flow: server-side merchant key, Apple Pay and Google Pay with ' +
      'waitForResult(), order ids, reconciliation.',
    text: INTEGRATION_GUIDE,
  },
  {
    name: 'webhook-guide',
    uri: 'bonum://guides/webhooks',
    title: 'Bonum V2 webhook guide',
    description:
      'Signature verification, the raw body per framework, two-level idempotency, the retry ' +
      'schedule, and local testing with send_test_webhook.',
    text: WEBHOOK_GUIDE,
  },
  {
    name: 'api-reference',
    uri: 'bonum://reference/api',
    title: 'Bonum V2 API quick reference',
    description: 'Endpoints, request and response fields, statuses and errors.',
    text: API_REFERENCE,
  },
  {
    name: 'go-live-checklist',
    uri: 'bonum://checklists/go-live',
    title: 'Bonum go-live checklist',
    description: 'What to check before taking real payments.',
    text: GO_LIVE_CHECKLIST,
  },
];

/** Registers the four guides as static Markdown resources. */
export function registerResources(server: McpServer): void {
  for (const { name, uri, title, description, text } of GUIDES) {
    server.registerResource(name, uri, { title, description, mimeType: 'text/markdown' }, () => ({
      contents: [{ uri, mimeType: 'text/markdown', text }],
    }));
  }
}
