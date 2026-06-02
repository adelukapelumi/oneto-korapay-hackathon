import { ConfigService } from "@nestjs/config";
import { CashoutEmailService } from "./cashout-email.service";

describe("CashoutEmailService", () => {
  const sendMock = jest.fn();

  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        RESEND_API_KEY: "re_test_key",
        USER_CASHOUT_FROM_ADDRESS:
          "Oneto Cashout Requests <cashoutrequests@getoneto.com>",
        CASHOUT_REQUESTS_EMAIL_ADDRESS: "cashoutrequests@getoneto.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue({ error: null });
  });

  function makeService() {
    const service = new CashoutEmailService(configService);
    (service as unknown as { resend: { emails: { send: typeof sendMock } } }).resend = {
      emails: { send: sendMock },
    };
    return service;
  }

  it("sends merchant request-received emails from the cashout inbox", async () => {
    const service = makeService();

    await service.sendRequestReceived({
      merchantEmail: "merchant@getoneto.com",
      requestId: "cashout_1",
      amountKobo: "500000",
    });

    const payload = sendMock.mock.calls[0]?.[0] as { from: string; subject: string; text: string };
    expect(payload.from).toBe("Oneto Cashout Requests <cashoutrequests@getoneto.com>");
    expect(payload.subject).toBe("We received your Oneto cashout request");
    expect(payload.text).toContain("Support will review and process your request.");
  });

  it("uses approved wording without saying paid", async () => {
    const service = makeService();

    await service.sendApproved({
      merchantEmail: "merchant@getoneto.com",
      requestId: "cashout_2",
      amountKobo: "600000",
    });

    const payload = sendMock.mock.calls[0]?.[0] as { text: string };
    expect(payload.text).toContain("has been approved");
    expect(payload.text).toContain("being processed");
    expect(payload.text.toLowerCase()).not.toContain("paid");
    expect(payload.text.toLowerCase()).not.toContain("completed");
  });

  it("uses completed wording only for completion emails", async () => {
    const service = makeService();

    await service.sendCompleted({
      merchantEmail: "merchant@getoneto.com",
      requestId: "cashout_3",
      amountKobo: "700000",
    });

    const payload = sendMock.mock.calls[0]?.[0] as { subject: string; text: string };
    expect(payload.subject).toBe("Your Oneto cashout has been completed");
    expect(payload.text.toLowerCase()).toContain("completed");
  });
});
