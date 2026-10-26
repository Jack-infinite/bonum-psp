/** `bonum://checklists/go-live`: what to check before taking real payments. */
export const GO_LIVE_CHECKLIST: string = `# Bonum PSP V2: go-live checklist

Unofficial checklist that ships with bonum-psp-mcp. Official documentation:
https://psp.bonum.mn/v2/integration-guide.html.

## Credentials

- [ ] Production merchant key and webhook signing secret from Bonum, kept in a secret manager.
      They differ from the sandbox ones.
- [ ] \`BONUM_ENV=production\` on production servers only, set explicitly.
- [ ] The merchant key is used only on the server: not in app bundles, front-end code, logs,
      error reports or analytics.

## Payments

- [ ] The backend decides the amount; it never trusts an amount sent by the app.
- [ ] Every payment attempt uses a new \`order_id\`, and the \`paymentId\` is stored with the order.
- [ ] Orders are fulfilled only for \`AUTHORIZED\`. PENDING shows "processing", never "failed".
- [ ] The submit endpoint uses one deadline (about 25 s) for submit plus \`waitForResult()\`, and a
      timeout or network error leaves the order PENDING.
- [ ] Apple Pay and Google Pay production setup is done as described in Bonum's wallet guides.

## Webhooks

- [ ] The production webhook URL (HTTPS, valid certificate, publicly reachable) is registered with
      Bonum.
- [ ] The route reads the raw body and verifies the signature before doing any work.
- [ ] Rejected webhooks get 400; duplicates get 200; the handler answers within 10 s and does slow
      work afterwards.
- [ ] Two levels of idempotency: a unique \`webhookId\` index, and a status update per
      \`paymentId\` that only changes PENDING orders.
- [ ] \`send_test_webhook\` passed every scenario against the sandbox deployment.
- [ ] The server clock is synced with NTP: timestamps more than 300 s off are rejected.

## Operations

- [ ] A reconciliation job looks up payments still PENDING after a few minutes.
- [ ] Alerts fire for webhook 5xx responses, rejected signatures and PENDING orders older than
      expected.
- [ ] Logs keep \`paymentId\` and \`orderId\` (Bonum support asks for the paymentId) but never the
      key, the secret or wallet tokens.
- [ ] Use this MCP server with production credentials only for read-only lookups. It refuses to
      sign test webhooks when \`BONUM_ENV=production\`.
`;
