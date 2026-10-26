// Tests must never pick up a developer's real Bonum credentials from the shell.
for (const name of ['BONUM_MERCHANT_KEY', 'BONUM_WEBHOOK_SECRET', 'BONUM_ENV', 'BONUM_BASE_URL']) {
  delete process.env[name];
}
