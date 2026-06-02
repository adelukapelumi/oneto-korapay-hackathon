import { NotFoundException } from "@nestjs/common";
import {
  Role,
  Status,
  SupportTicketCategory,
  SupportTicketStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupportEmailService } from "./support-email.service";
import { SupportService } from "./support.service";

describe("SupportService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    supportTicket: {
      create: jest.fn(),
    },
  } as unknown as PrismaService & {
    user: { findUnique: jest.Mock };
    supportTicket: { create: jest.Mock };
  };

  const supportEmailService = {
    sendAdminSupportTicketNotification: jest.fn(),
    sendUserSupportTicketReceived: jest.fn(),
  } as unknown as jest.Mocked<SupportEmailService>;

  let service: SupportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupportService(prisma, supportEmailService);
    prisma.user.findUnique.mockResolvedValue({
      id: "u_123",
      email: "student@stu.cu.edu.ng",
      role: Role.STUDENT,
      status: Status.ACTIVE,
    });
    prisma.supportTicket.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ticket_1",
        ticketNumber: data.ticketNumber,
        status: SupportTicketStatus.OPEN,
        category: data.category,
        subject: data.subject,
        message: data.message,
      }),
    );
    supportEmailService.sendAdminSupportTicketNotification.mockResolvedValue(undefined);
    supportEmailService.sendUserSupportTicketReceived.mockResolvedValue(undefined);
  });

  it("creates a support ticket and returns its ticket number and status", async () => {
    const result = await service.createTicket("u_123", {
      category: SupportTicketCategory.ACCOUNT_RECOVERY,
      subject: "Need help moving devices",
      message: "I changed phones and need help activating this new one.",
    });

    expect(result.status).toBe(SupportTicketStatus.OPEN);
    expect(result.ticketNumber).toMatch(/^SUP-\d{8}-[A-F0-9]{6}$/);
    expect(prisma.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u_123",
        userEmail: "student@stu.cu.edu.ng",
        userRole: Role.STUDENT,
        category: SupportTicketCategory.ACCOUNT_RECOVERY,
        subject: "Need help moving devices",
      }),
    });
  });

  it("sends both admin and user support emails after ticket creation", async () => {
    await service.createTicket("u_123", {
      category: SupportTicketCategory.PAYMENT_ISSUE,
      subject: "Merchant could not sync",
      message: "A merchant scanned my payment but said it did not sync yet.",
    });

    expect(supportEmailService.sendAdminSupportTicketNotification).toHaveBeenCalledTimes(1);
    expect(supportEmailService.sendUserSupportTicketReceived).toHaveBeenCalledTimes(1);
  });

  it("does not fail ticket creation when support email delivery throws", async () => {
    supportEmailService.sendAdminSupportTicketNotification.mockRejectedValueOnce(
      new Error("mail_down"),
    );

    await expect(
      service.createTicket("u_123", {
        category: SupportTicketCategory.OTHER,
        subject: "General help needed",
        message: "Please help me with a general support question on the app.",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: SupportTicketStatus.OPEN,
      }),
    );
  });

  it("retries ticket number collisions before succeeding", async () => {
    prisma.supportTicket.create
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ticket_retry",
        ticketNumber: data.ticketNumber,
        status: SupportTicketStatus.OPEN,
        category: data.category,
        subject: data.subject,
        message: data.message,
      }));

    const result = await service.createTicket("u_123", {
      category: SupportTicketCategory.CASHOUT_ISSUE,
      subject: "Cashout stuck",
      message: "My cashout has been pending for a while.",
    });

    expect(result.status).toBe(SupportTicketStatus.OPEN);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(2);
  });

  it("throws when the authenticated user is missing", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.createTicket("missing", {
        category: SupportTicketCategory.OTHER,
        subject: "General help needed",
        message: "Please help me with a general support question on the app.",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
