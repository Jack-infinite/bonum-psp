import { BonumWebhooks } from 'bonum-psp';
import { saveEvent } from '../../../../lib/events';

let handler: ((request: Request) => Promise<Response>) | undefined;

// Route handlers receive the untouched Request, so the raw body is available for verification.
// The handler is created on the first request rather than at import time, so `next build`
// does not need BONUM_WEBHOOK_SECRET.
export function POST(request: Request): Promise<Response> {
  handler ??= new BonumWebhooks().createHandler({
    onEvent: saveEvent,
    onError: (error) => console.error('Bonum webhook not processed:', error),
  });
  return handler(request);
}
