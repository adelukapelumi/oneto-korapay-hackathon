import { z } from "zod";

export const SupportTicketCategorySchema = z.enum([
  "PAYMENT_ISSUE",
  "TOPUP_ISSUE",
  "MERCHANT_SYNC_ISSUE",
  "CASHOUT_ISSUE",
  "ACCOUNT_RECOVERY",
  "LOST_OR_STOLEN_PHONE",
  "WRONG_BALANCE",
  "OTHER",
]);

export const CreateSupportTicketSchema = z
  .object({
    category: SupportTicketCategorySchema,
    subject: z.string().trim().min(3).max(120),
    message: z.string().trim().min(10).max(4000),
  })
  .strict();

export type CreateSupportTicketDto = z.infer<typeof CreateSupportTicketSchema>;
