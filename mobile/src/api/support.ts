import type { AxiosInstance } from "axios";
import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const SupportTicketCategorySchema = z.enum([
  "PAYMENT_ISSUE",
  "TOPUP_ISSUE",
  "MERCHANT_SYNC_ISSUE",
  "CASHOUT_ISSUE",
  "ACCOUNT_RECOVERY",
  "LOST_OR_STOLEN_PHONE",
  "WRONG_BALANCE",
  "OTHER",
]);

const CreateSupportTicketResponseSchema = z.object({
  ticketNumber: z.string().min(1),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
});

export type SupportTicketCategory = z.infer<typeof SupportTicketCategorySchema>;
export type CreateSupportTicketResponse = z.infer<
  typeof CreateSupportTicketResponseSchema
>;

export interface CreateSupportTicketInput {
  readonly category: SupportTicketCategory;
  readonly subject: string;
  readonly message: string;
}

export async function createSupportTicket(
  input: CreateSupportTicketInput,
  client: AxiosInstance = apiClient,
): Promise<CreateSupportTicketResponse> {
  try {
    const res = await client.post<unknown>("/support/tickets", input);
    const parsed = CreateSupportTicketResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw toTypedError(err);
  }
}
