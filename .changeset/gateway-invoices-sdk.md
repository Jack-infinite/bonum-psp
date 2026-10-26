---
"bonum-psp": minor
---

Add Bonum Gateway invoices: `BonumGatewayClient` creates invoices with a hosted checkout link (QPay, cards, WeChat Pay and more) through `gateway.invoices.create()`, lists the enabled payment methods with `listProviders()`, and manages the access token for you. `BonumGatewayWebhooks` verifies invoice webhooks by their `X-Checksum-V2` header, and `bonum-psp/testing` gains `createTestInvoiceWebhook()` and `signTestGatewayWebhook()`.
