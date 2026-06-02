import type { SupportTicketCategory } from "../api/support";
import { SUPPORT_EMAIL_ADDRESS } from "../recovery/recovery-ui";

export const DASHBOARD_SUPPORT_LABEL = "Need help?";

export const SUPPORT_TICKET_CATEGORIES: readonly {
  readonly value: SupportTicketCategory;
  readonly label: string;
}[] = [
  { value: "PAYMENT_ISSUE", label: "Payment issue" },
  { value: "TOPUP_ISSUE", label: "Top-up issue" },
  { value: "MERCHANT_SYNC_ISSUE", label: "Merchant sync issue" },
  { value: "CASHOUT_ISSUE", label: "Cashout issue" },
  { value: "ACCOUNT_RECOVERY", label: "Account recovery" },
  { value: "LOST_OR_STOLEN_PHONE", label: "Lost or stolen phone" },
  { value: "WRONG_BALANCE", label: "Wrong balance" },
  { value: "OTHER", label: "Other" },
] as const;

export const SUPPORT_SCREEN_FIELDS = ["category", "subject", "message"] as const;

export const SUPPORT_CONFIRMATION_LINES = [
  `We sent your request to Oneto Support at ${SUPPORT_EMAIL_ADDRESS}.`,
  "A confirmation email has been sent to you.",
] as const;
