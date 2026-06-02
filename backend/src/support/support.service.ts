import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SupportTicketStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SupportEmailService } from "./support-email.service";
import { CreateSupportTicketDto } from "./support.schemas";

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supportEmailService: SupportEmailService,
  ) {}

  async createTicket(userId: string, input: CreateSupportTicketDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException("user_not_found");
    }

    const subject = input.subject.trim();
    const message = input.message.trim();

    try {
      const ticket = await this.prisma.supportTicket.create({
        data: {
          ticketNumber: this.generateTicketNumber(),
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          category: input.category,
          subject,
          message,
        },
      });

      await this.notifySafely("support_ticket_notification_failed", async () => {
        await this.supportEmailService.sendAdminSupportTicketNotification({
          ticketNumber: ticket.ticketNumber,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          category: ticket.category,
          subject: ticket.subject,
          message: ticket.message,
        });
        await this.supportEmailService.sendUserSupportTicketReceived({
          ticketNumber: ticket.ticketNumber,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          category: ticket.category,
          subject: ticket.subject,
          message: ticket.message,
        });
      });

      return {
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("support_ticket_number_conflict");
      }

      throw error;
    }
  }

  private generateTicketNumber(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = randomBytes(3).toString("hex").toUpperCase();
    return `SUP-${datePart}-${randomPart}`;
  }

  private async notifySafely(
    logCode: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        `${logCode}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export { SupportTicketStatus };
