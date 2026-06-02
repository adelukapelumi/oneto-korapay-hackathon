import { ConfigService } from "@nestjs/config";
import { KeyRecoveryReason, KeyRecoveryRiskType, Role } from "@prisma/client";
import { RecoveryEmailService } from "./recovery-email.service";

describe("RecoveryEmailService", () => {
  const sendMock = jest.fn();

  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM_ADDRESS: "Oneto Notifications <no-reply@getoneto.com>",
        USER_SUPPORT_FROM_ADDRESS: "Oneto Support <support@getoneto.com>",
        SUPPORT_EMAIL_ADDRESS: "support@getoneto.com",
        ADMIN_RECOVERY_NOTIFICATION_EMAILS: "support@getoneto.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue({ error: null });
  });

  function makeService() {
    const service = new RecoveryEmailService(configService);
    (service as unknown as { resend: { emails: { send: typeof sendMock } } }).resend = {
      emails: { send: sendMock },
    };
    return service;
  }

  const baseInput = {
    requestId: "recovery_1",
    userId: "u_123",
    userEmail: "student@stu.cu.edu.ng",
    userRole: Role.STUDENT,
    reason: KeyRecoveryReason.NEW_PHONE,
    riskType: KeyRecoveryRiskType.LOST_DEVICE,
    oldKeyPublicKey:
      "ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requestedNewPublicKey:
      "ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    approximateBalanceKobo: "50000",
    lastMerchantText: "Cafe",
    lastTopupAmountKobo: "10000",
    userNotes:
      "My PIN 123456 stopped working and this is my key ed25519:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  } as const;

  it("redacts full keys and sensitive secrets from admin recovery emails", async () => {
    const service = makeService();

    await service.sendAdminNewRecoveryRequestNotification(baseInput);

    const payload = sendMock.mock.calls[0]?.[0] as { subject: string; text: string };
    expect(payload.subject).toBe("New Oneto recovery request");
    expect(payload.text).toContain("Old key suffix: aaaaaaaa");
    expect(payload.text).toContain("Requested new key suffix: bbbbbbbb");
    expect(payload.text).not.toContain(baseInput.oldKeyPublicKey);
    expect(payload.text).not.toContain(baseInput.requestedNewPublicKey);
    expect(payload.text).not.toContain("123456");
    expect(payload.text).not.toContain("ed25519:cccc");
  });

  it("marks compromised requests as urgent for admins", async () => {
    const service = makeService();

    await service.sendAdminNewRecoveryRequestNotification({
      ...baseInput,
      reason: KeyRecoveryReason.STOLEN_PHONE,
      riskType: KeyRecoveryRiskType.COMPROMISED_DEVICE,
    });

    const payload = sendMock.mock.calls[0]?.[0] as { subject: string };
    expect(payload.subject).toBe("Urgent: New Oneto recovery request");
  });

  it("uses the user-facing support sender for customer emails", async () => {
    const service = makeService();

    await service.sendUserRecoveryApproved(baseInput);

    const payload = sendMock.mock.calls[0]?.[0] as { from: string; subject: string };
    expect(payload.from).toBe("Oneto Support <support@getoneto.com>");
    expect(payload.subject).toBe("Your Oneto account is now active on this device");
  });

  it("makes the rejected high-risk recovery copy explicit about manual support review", async () => {
    const service = makeService();

    await service.sendUserRecoveryRejected({
      ...baseInput,
      reason: KeyRecoveryReason.STOLEN_PHONE,
      riskType: KeyRecoveryRiskType.COMPROMISED_DEVICE,
    });

    const payload = sendMock.mock.calls[0]?.[0] as { text: string };
    expect(payload.text).toContain("support will review it manually");
    expect(payload.text).not.toContain(baseInput.oldKeyPublicKey);
    expect(payload.text).not.toContain(baseInput.requestedNewPublicKey);
  });

  it("skips sending when RESEND_API_KEY is missing", async () => {
    const service = new RecoveryEmailService({
      get: jest.fn((key: string) => {
        if (key === "ADMIN_RECOVERY_NOTIFICATION_EMAILS") {
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
      service.sendUserRecoveryRejected(baseInput),
    ).resolves.toBeUndefined();
  });
});
