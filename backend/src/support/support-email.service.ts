import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Role, SupportTicketCategory } from "@prisma/client";
import { Resend } from "resend";
import {
  parseNotificationRecipients,
  redactSensitiveEmailText,
} from "../common/email-redaction";

type SupportTicketEmailContext = {
  readonly ticketNumber: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: Role;
  readonly category: SupportTicketCategory;
  readonly subject: string;
  readonly message: string;
};

@Injectable()
export class SupportEmailService {
  private readonly logger = new Logger(SupportEmailService.name);
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

  async sendAdminSupportTicketNotification(
    input: SupportTicketEmailContext,
  ): Promise<void> {
    const recipients = parseNotificationRecipients(
      this.configService.get<string>("ADMIN_SUPPORT_NOTIFICATION_EMAILS"),
    );
    if (recipients.length === 0) {
      return;
    }

    await this.sendEmail({
      from: this.internalFromAddress,
      to: recipients,
      replyTo: this.supportEmailAddress,
      subject: "New Oneto support request",
      text: [
        "A user submitted a support request.",
        "",
        `Ticket number: ${input.ticketNumber}`,
        `User id: ${input.userId}`,
        `User email: ${input.userEmail}`,
        `Role: ${input.userRole}`,
        `Category: ${input.category}`,
        `Subject: ${redactSensitiveEmailText(input.subject)}`,
        `Message: ${redactSensitiveEmailText(input.message)}`,
      ].join("\n"),
    });
  }

  async sendUserSupportTicketReceived(
    input: SupportTicketEmailContext,
  ): Promise<void> {
    await this.sendEmail({
      from: this.userFromAddress,
      to: [input.userEmail],
      replyTo: this.supportEmailAddress,
      subject: "We received your Oneto support request",
      text: [
        "We received your support request.",
        "",
        `Ticket number: ${input.ticketNumber}`,
        `Category: ${input.category}`,
        `Subject: ${redactSensitiveEmailText(input.subject)}`,
        "",
        "Oneto Support will review your message and reply by email.",
        "Oneto Support will never ask for your PIN or OTP.",
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
      this.logger.warn("RESEND_API_KEY missing; skipping support email send");
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
        this.logger.warn(`Support email send failed: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn(
        `Support email send threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
