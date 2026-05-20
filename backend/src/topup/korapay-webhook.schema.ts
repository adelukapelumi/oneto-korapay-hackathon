import { z } from 'zod';

// Korapay webhook payload schema. Defines the minimum fields we read.
// Keep .passthrough() so unknown fields from Korapay don't break parsing —
// we only care about validating fields we actually consume.
export const KorapayWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string().min(1),
    amount: z.union([z.number().nonnegative(), z.string().min(1)]),
    status: z.string().optional(),
    customer: z.object({
      email: z.string().email(),
    }).optional(),
  }).passthrough(),
}).passthrough();

export type KorapayWebhookPayload = z.infer<typeof KorapayWebhookSchema>;
