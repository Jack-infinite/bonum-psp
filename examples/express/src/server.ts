import {
  type ApplePayPaymentToken,
  BonumClient,
  BonumValidationError,
  isBonumError,
} from 'bonum-psp';
import { expressWebhookHandler } from 'bonum-psp/express';
import express from 'express';
import { applyWebhook, attachPayment, findOrder } from './orders.ts';

// Reads BONUM_MERCHANT_KEY, BONUM_ENV and BONUM_WEBHOOK_SECRET from the environment.
const bonum = new BonumClient();
const app = express();

// 1) The webhook route comes first and gets the raw body: a global express.json() registered
//    before it would parse the body, and the signature could no longer be checked.
app.post(
  '/webhooks/bonum',
  express.raw({ type: 'application/json' }),
  expressWebhookHandler({
    webhooks: bonum.webhooks,
    // Store, then process: keep this fast. Bonum waits at most 10 seconds for the 2xx.
    onEvent: (event) => {
      const outcome = applyWebhook(event);
      console.log(`Bonum ${event.eventType} for ${event.orderId}: ${outcome}`);
    },
    onError: (error) => console.error('Bonum webhook not processed:', error),
  }),
);

app.use(express.json());

// 2) Your app posts the Apple Pay token here. The merchant key never leaves this server.
app.post('/payments/apple-pay', async (req, res) => {
  // The SDK checks the token's shape; see its README if your app sends something else.
  const { orderId, token } = req.body as {
    orderId?: string;
    token?: ApplePayPaymentToken | string;
  };
  const order = orderId === undefined ? undefined : findOrder(orderId);
  if (order === undefined || token === undefined) {
    res.status(400).json({ error: 'Send an existing orderId and the Apple Pay token.' });
    return;
  }
  // One deadline for submit + wait, inside the ~30 s the wallet sheet stays open.
  const deadline = Date.now() + 25_000;
  const signal = AbortSignal.timeout(25_000);
  try {
    const submission = await bonum.payments.submitApplePay(
      { orderId: order.orderId, token, amount: order.amount },
      { signal, timeoutMs: 8_000 },
    );
    attachPayment(order.orderId, submission.paymentId);
    const waitMs = Math.max(1, Math.min(20_000, deadline - Date.now() - 2_000));
    const result = await bonum.payments.waitForResult(submission, { waitMs, signal });
    // PENDING means "not decided yet": show a processing state; the webhook will settle it.
    res.json({ status: result.status, failureReason: result.failureReason });
  } catch (error) {
    if (error instanceof BonumValidationError) {
      res.status(400).json({ error: 'invalid_request', field: error.field });
      return;
    }
    // Timeouts and network errors leave the outcome unknown: never tell the customer it failed.
    console.error('Bonum submission problem:', isBonumError(error) ? error.code : error);
    res.status(202).json({ status: 'PENDING' });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, (error) => {
  if (error) throw error;
  console.log(`Listening on http://localhost:${port} (Bonum ${bonum.environment})`);
});
