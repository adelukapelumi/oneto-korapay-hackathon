import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

@Injectable()
export class CashoutEmailService {
  private readonly logger = new Logger(CashoutEmailService.name);
  private readonly resend: Resend | null;
  private readonly userFromAddress: string;
  private readonly internalReplyToAddress: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.userFromAddress =
      this.configService.get<string>("USER_CASHOUT_FROM_ADDRESS") ??
      "Oneto Cashout Requests <cashoutrequests@getoneto.com>";
    this.internalReplyToAddress =
      this.configService.get<string>("CASHOUT_REQUESTS_EMAIL_ADDRESS") ??
      "cashoutrequests@getoneto.com";
  }

  async sendRequestReceived(input: {
    readonly merchantEmail: string;
    readonly requestId: string;
    readonly amountKobo: string;
  }): Promise<void> {
    await this.sendEmail({
      to: [input.merchantEmail],
      subject: "We received your Oneto cashout request",
      text: [
        "We received your Oneto cashout request.",
        "",
        `Request id: ${input.requestId}`,
        `Amount requested: ${input.amountKobo} kobo`,
        "",
        "Support will review and process your request.",
      ].join("\n"),
    });
  }

  async sendApproved(input: {
    readonly merchantEmail: string;
    readonly requestId: string;
    readonly amountKobo: string;
  }): Promise<void> {
    await this.sendEmail({
      to: [input.merchantEmail],
      subject: "Your Oneto cashout request has been approved",
      text: [
        "Your Oneto cashout request has been approved.",
        "",
        `Request id: ${input.requestId}`,
        `Amount requested: ${input.amountKobo} kobo`,
        "",
        "Your request is now being processed.",
      ].join("\n"),
    });
  }

  async sendCompleted(input: {
    readonly merchantEmail: string;
    readonly requestId: string;
    readonly amountKobo: string;
  }): Promise<void> {
    await this.sendEmail({
      to: [input.merchantEmail],
      subject: "Your Oneto cashout has been completed",
      text: [
        "Your Oneto cashout has been completed.",
        "",
        `Request id: ${input.requestId}`,
        `Amount requested: ${input.amountKobo} kobo`,
      ].join("\n"),
    });
  }

  private async sendEmail(input: {
    readonly to: readonly string[];
    readonly subject: string;
    readonly text: string;
  }): Promise<void> {
    if (input.to.length === 0) {
      return;
    }

    if (this.resend === null) {
      this.logger.warn("RESEND_API_KEY missing; skipping cashout email send");
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.userFromAddress,
        to: [...input.to],
        replyTo: this.internalReplyToAddress,
        subject: input.subject,
        text: input.text,
      });

      if (error) {
        this.logger.warn(`Cashout email send failed: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn(
        `Cashout email send threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
