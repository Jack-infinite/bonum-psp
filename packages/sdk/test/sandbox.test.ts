import { describe, expect, it } from 'vitest';
import { BonumClient, BonumNotFoundError } from '../src/index.js';

// Opt-in: proves auth and routing against the real sandbox without touching any payment.
// Run with BONUM_SANDBOX_MERCHANT_KEY=... pnpm test
const merchantKey = process.env.BONUM_SANDBOX_MERCHANT_KEY;

describe.skipIf(merchantKey === undefined || merchantKey === '')('Bonum sandbox', () => {
  it('answers 404 for an unknown payment id, so the key and routing work', async () => {
    const bonum = new BonumClient({ merchantKey, environment: 'sandbox', maxRetries: 0 });
    await expect(bonum.payments.get(crypto.randomUUID())).rejects.toThrow(BonumNotFoundError);
  });
});
