import { ConfigService } from "@nestjs/config";
import { Role, SupportTicketCategory } from "@prisma/client";
import { SupportEmailService } from "./support-email.service";

describe("SupportEmailService", () => {
  const sendMock = jest.fn();

  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM_ADDRESS: "Oneto Notifications <no-reply@getoneto.com>",
        USER_SUPPORT_FROM_ADDRESS: "Oneto Support <support@getoneto.com>",
        SUPPORT_EMAIL_ADDRESS: "support@getoneto.com",
        ADMIN_SUPPORT_NOTIFICATION_EMAILS: "support@getoneto.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue({ error: null });
  });

  function makeService() {
    const service = new SupportEmailService(configService);
    (service as unknown as { resend: { emails: { send: typeof sendMock } } }).resend = {
      emails: { send: sendMock },
    };
    return service;
  }

  const baseInput = {
    ticketNumber: "SUP-20260530-ABC123",
    userId: "u_123",
    userEmail: "student@stu.cu.edu.ng",
    userRole: Role.STUDENT,
    category: SupportTicketCategory.ACCOUNT_RECOVERY,
    subject: "PIN issue after device move",
    message:
      "My PIN 123456 stopped working after moving phones. My key is ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as const;

  it("redacts secrets and full public keys from support emails", async () => {
    const service = makeService();

    await service.sendAdminSupportTicketNotification(baseInput);

    const payload = sendMock.mock.calls[0]?.[0] as { text: string };
    expect(payload.text).toContain("Ticket number: SUP-20260530-ABC123");
    expect(payload.text).not.toContain("123456");
    expect(payload.text).not.toContain("ed25519:aaaa");
  });

  it("uses the support sender for user confirmation emails", async () => {
    const service = makeService();

    await service.sendUserSupportTicketReceived(baseInput);

    const payload = sendMock.mock.calls[0]?.[0] as { from: string; subject: string };
    expect(payload.from).toBe("Oneto Support <support@getoneto.com>");
    expect(payload.subject).toBe("We received your Oneto support request");
  });

  it("does not crash when Resend is unavailable", async () => {
    const service = new SupportEmailService({
      get: jest.fn((key: string) => {
        if (key === "ADMIN_SUPPORT_NOTIFICATION_EMAILS") {
          return "support@getoneto.com";
        }
        if (key === "USER_SUPPORT_FROM_ADDRESS") {
          return "Oneto Support <support@getoneto.com>";
        }
        if (key === "SUPPORT_EMAIL_ADDRESS") {
          return "support@getoneto.com";
        }
        return undefined;
      }),
    } as unknown as ConfigService);

    await expect(
      service.sendUserSupportTicketReceived(baseInput),
    ).resolves.toBeUndefined();
  });
});
