import { z } from 'zod';

/** A Bonum `paymentId`: any UUID, the same check the SDK applies. */
export const paymentIdSchema: z.ZodGUID = z.guid(
  'must be a UUID, such as the paymentId Bonum returned for the payment',
);

/** An `order_id`: 1–128 characters, as Bonum allows. */
export const orderIdSchema: z.ZodString = z.string().min(1).max(128);

/** An amount the way Bonum sends it in webhooks: a decimal string in major units. */
export const amountSchema: z.ZodString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a decimal string such as "150.50"');
