import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { parseAdminWebOrigins } from "../common/cors";
import { tryNormalizeEmail } from "../common/email";

@Injectable()
export class AdminCashoutNotificationService {
  private readonly logger = new Logger(AdminCashoutNotificationService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromAddress =
      this.configService.get<string>("RESEND_FROM_ADDRESS") ?? "oneto <noreply@oneto.ng>";
  }

  private getNotificationRecipients(): string[] {
    const configured =
      this.configService.get<string>("ADMIN_CASHOUT_NOTIFICATION_EMAILS") ?? "";
    const parsed = new Set<string>();

    for (const rawEmail of configured.split(",")) {
      const normalized = tryNormalizeEmail(rawEmail.trim());
      if (normalized) {
        parsed.add(normalized);
      }
    }

    return Array.from(parsed);
  }

  private getDashboardLink(): string | null {
    const origins = parseAdminWebOrigins(
      this.configService.get<string>("ADMIN_WEB_ORIGINS"),
    );
    if (origins.length === 0) {
      return null;
    }

    return `${origins[0]}/cashouts/pending`;
  }

  private maskAccountNumber(accountNumber: string): string {
    const last4 = accountNumber.slice(-4);
    return `******${last4}`;
  }

  async sendNewCashoutRequestNotification(input: {
    readonly cashoutId: string;
    readonly merchantUserId: string;
    readonly merchantBusinessName: string | null;
    readonly grossAmountKobo: bigint;
    readonly onetoFeeKobo: bigint;
    readonly amountToPayKobo: bigint;
    readonly cashoutBankName: string;
    readonly cashoutAccountName: string;
    readonly cashoutAccountNumber: string;
  }): Promise<void> {
    const recipients = this.getNotificationRecipients();
    if (recipients.length === 0) {
      return;
    }

    if (this.resend === null) {
      this.logger.warn(
        "ADMIN_CASHOUT_NOTIFICATION_EMAILS is set but RESEND_API_KEY is missing; skipping notification",
      );
      return;
    }

    const dashboardLink = this.getDashboardLink();
    const lines = [
      "A merchant has requested a new cashout.",
      "",
      `Merchant user id: ${input.merchantUserId}`,
      `Merchant business name: ${input.merchantBusinessName ?? "not provided"}`,
      `Gross cashout amount: ${input.grossAmountKobo.toString()} kobo`,
      `Oneto fee: ${input.onetoFeeKobo.toString()} kobo`,
      `Manual payout amount: ${input.amountToPayKobo.toString()} kobo`,
      `Bank name: ${input.cashoutBankName}`,
      `Account name: ${input.cashoutAccountName}`,
      `Account number: ${this.maskAccountNumber(input.cashoutAccountNumber)}`,
      `Cashout id: ${input.cashoutId}`,
    ];

    if (dashboardLink) {
      lines.push(`Admin dashboard: ${dashboardLink}`);
    }

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: recipients,
      subject: "New Oneto merchant cashout request",
      text: lines.join("\n"),
    });

    if (error) {
      throw new Error(`admin_cashout_notification_failed: ${error.message}`);
    }
  }
}
