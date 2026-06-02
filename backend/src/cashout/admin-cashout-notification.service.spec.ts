import { ConfigService } from "@nestjs/config";
import { AdminCashoutNotificationService } from "./admin-cashout-notification.service";

describe("AdminCashoutNotificationService", () => {
  const sendMock = jest.fn();
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM_ADDRESS: "Oneto Notifications <no-reply@getoneto.com>",
        ADMIN_CASHOUT_NOTIFICATION_EMAILS: "cashoutrequests@getoneto.com",
        CASHOUT_REQUESTS_EMAIL_ADDRESS: "cashoutrequests@getoneto.com",
        ADMIN_WEB_ORIGINS: "https://admin.getoneto.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue({ error: null });
  });

  it("masks full account number in notification body", async () => {
    const service = new AdminCashoutNotificationService(configService);
    (service as any).resend = { emails: { send: sendMock } };

    await service.sendNewCashoutRequestNotification({
      cashoutId: "cash_1",
      merchantUserId: "u_merchant",
      merchantBusinessName: "Campus Cafe",
      grossAmountKobo: 500_000n,
      onetoFeeKobo: 12_500n,
      amountToPayKobo: 487_500n,
      cashoutBankName: "Wema Bank",
      cashoutAccountName: "Campus Cafe Ltd",
      cashoutAccountNumber: "1234567890",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0]?.[0] as {
      text: string;
      to: string[];
      replyTo: string;
    };
    expect(payload.text).toContain("******7890");
    expect(payload.text).not.toContain("1234567890");
    expect(payload.to).toEqual(["cashoutrequests@getoneto.com"]);
    expect(payload.replyTo).toBe("cashoutrequests@getoneto.com");
    expect(payload.to).not.toContain("support@getoneto.com");
  });
});
