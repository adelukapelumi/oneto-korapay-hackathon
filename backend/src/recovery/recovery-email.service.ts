import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KeyRecoveryReason, KeyRecoveryRiskType, Role } from "@prisma/client";
import { Resend } from "resend";
import {
  parseNotificationRecipients,
  redactSensitiveEmailText,
  toKeySuffix,
} from "../common/email-redaction";

type RecoveryEmailContext = {
  readonly requestId: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: Role;
  readonly reason: KeyRecoveryReason;
  readonly riskType: KeyRecoveryRiskType;
  readonly oldKeyPublicKey: string;
  readonly requestedNewPublicKey: string;
  readonly approximateBalanceKobo?: string | null;
  readonly lastMerchantText?: string | null;
  readonly lastTopupAmountKobo?: string | null;
  readonly userNotes?: string | null;
};

@Injectable()
export class RecoveryEmailService {
  private readonly logger = new Logger(RecoveryEmailService.name);
  private readonly resend: Resend | null;
  private readonly internalFromAddress: string;
  private readonly userFromAddress: string;
  private readonly supportEmailAddress: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.internalFromAddress =
      this.configService.get<string>("RESEND_FROM_ADDRESS") ??
      "Oneto Notifications <no-reply@getoneto.com>";
    this.userFromAddress =
      this.configService.get<string>("USER_SUPPORT_FROM_ADDRESS") ??
      "Oneto Support <support@getoneto.com>";
    this.supportEmailAddress =
      this.configService.get<string>("SUPPORT_EMAIL_ADDRESS") ?? "support@getoneto.com";
  }

  async sendAdminNewRecoveryRequestNotification(
    input: RecoveryEmailContext,
  ): Promise<void> {
    const recipients = parseNotificationRecipients(
      this.configService.get<string>("ADMIN_RECOVERY_NOTIFICATION_EMAILS"),
    );
    if (recipients.length === 0) {
      return;
    }

    const urgencyPrefix =
      input.reason === KeyRecoveryReason.STOLEN_PHONE ||
      input.riskType === KeyRecoveryRiskType.COMPROMISED_DEVICE
        ? "Urgent: "
        : "";

    await this.sendEmail({
      from: this.internalFromAddress,
      to: recipients,
      replyTo: this.supportEmailAddress,
      subject: `${urgencyPrefix}New Oneto recovery request`,
      text: [
        "A user submitted a recovery request.",
        "",
        `Request id: ${input.requestId}`,
        `User id: ${input.userId}`,
        `User email: ${input.userEmail}`,
        `Role: ${input.userRole}`,
        `Risk type: ${input.riskType}`,
        `Reason: ${input.reason}`,
        `Old key suffix: ${toKeySuffix(input.oldKeyPublicKey)}`,
        `Requested new key suffix: ${toKeySuffix(input.requestedNewPublicKey)}`,
        input.approximateBalanceKobo
          ? `Approximate balance: ${input.approximateBalanceKobo} kobo`
          : null,
        input.lastMerchantText
          ? `Last merchant: ${redactSensitiveEmailText(input.lastMerchantText)}`
          : null,
        input.lastTopupAmountKobo
          ? `Last top-up amount: ${input.lastTopupAmountKobo} kobo`
          : null,
        input.userNotes
          ? `User notes: ${redactSensitiveEmailText(input.userNotes)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  async sendUserRecoveryRequestReceived(input: RecoveryEmailContext): Promise<void> {
    await this.sendEmail({
      from: this.userFromAddress,
      to: [input.userEmail],
      replyTo: this.supportEmailAddress,
      subject: "We received your Oneto recovery request",
      text: [
        "We received your request to move your Oneto account to this device.",
        "",
        `Request id: ${input.requestId}`,
        `Reason: ${input.reason}`,
        `New device key suffix: ${toKeySuffix(input.requestedNewPublicKey)}`,
        "",
        "Oneto Support will review your request and email you when your account is active on this device.",
        "Oneto Support will never ask for your PIN or OTP.",
      ].join("\n"),
    });
  }

  async sendUserRecoveryApproved(input: RecoveryEmailContext): Promise<void> {
    await this.sendEmail({
      from: this.userFromAddress,
      to: [input.userEmail],
      replyTo: this.supportEmailAddress,
      subject: "Your Oneto account is now active on this device",
      text: [
        "Your recovery request has been approved.",
        "",
        `Request id: ${input.requestId}`,
        `New device key suffix: ${toKeySuffix(input.requestedNewPublicKey)}`,
        "",
        "You can now return to Oneto on this phone and complete activation.",
      ].join("\n"),
    });
  }

  async sendUserRecoveryRejected(input: RecoveryEmailContext): Promise<void> {
    const highRiskNote =
      input.reason === KeyRecoveryReason.STOLEN_PHONE ||
      input.riskType === KeyRecoveryRiskType.COMPROMISED_DEVICE
        ? "Because this was reported as stolen or compromised, support will review it manually before that old device can be trusted again."
        : "Support can review the case again if you still need help.";

    await this.sendEmail({
      from: this.userFromAddress,
      to: [input.userEmail],
      replyTo: this.supportEmailAddress,
      subject: "We could not approve your Oneto recovery request",
      text: [
        "We reviewed your recovery request but could not safely approve it yet.",
        "",
        `Request id: ${input.requestId}`,
        "",
        highRiskNote,
        "",
        "Reply to this email or contact Oneto Support if you need another review.",
      ].join("\n"),
    });
  }

  private async sendEmail(input: {
    readonly from: string;
    readonly to: readonly string[];
    readonly replyTo?: string;
    readonly subject: string;
    readonly text: string;
  }): Promise<void> {
    if (input.to.length === 0) {
      return;
    }

    if (this.resend === null) {
      this.logger.warn(
        "RESEND_API_KEY missing; skipping recovery email send",
      );
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: input.from,
        to: [...input.to],
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
      });

      if (error) {
        this.logger.warn(`Recovery email send failed: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn(
        `Recovery email send threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
