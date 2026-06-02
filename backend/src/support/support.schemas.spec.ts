import { CreateSupportTicketSchema } from "./support.schemas";

describe("CreateSupportTicketSchema", () => {
  it("accepts valid support ticket input", () => {
    const result = CreateSupportTicketSchema.safeParse({
      category: "PAYMENT_ISSUE",
      subject: "Payment did not sync",
      message: "A merchant scanned my payment but it still shows as pending.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid categories", () => {
    const result = CreateSupportTicketSchema.safeParse({
      category: "NOT_REAL",
      subject: "Payment did not sync",
      message: "A merchant scanned my payment but it still shows as pending.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects blank subjects and messages", () => {
    const blankSubject = CreateSupportTicketSchema.safeParse({
      category: "OTHER",
      subject: "  ",
      message: "This is still long enough to count as a message.",
    });
    const blankMessage = CreateSupportTicketSchema.safeParse({
      category: "OTHER",
      subject: "General help needed",
      message: "  ",
    });

    expect(blankSubject.success).toBe(false);
    expect(blankMessage.success).toBe(false);
  });
});
