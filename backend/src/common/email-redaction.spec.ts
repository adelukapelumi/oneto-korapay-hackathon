import { redactSensitiveEmailText } from "./email-redaction";

describe("email redaction helpers", () => {
  it("redacts natural-language PIN and OTP secrets without leaking the digits", () => {
    const redacted = redactSensitiveEmailText(
      "My PIN is 123456 and my OTP code was 654321 for the app.",
    );

    expect(redacted).toBe(
      "My PIN is [redacted-secret] and my OTP code was [redacted-secret] for the app.",
    );
  });

  it("keeps ordinary digits that are not tied to secrets intact", () => {
    const redacted = redactSensitiveEmailText(
      "Ticket 1234 is open, but the recovery code is 987654.",
    );

    expect(redacted).toBe(
      "Ticket 1234 is open, but the recovery code is [redacted-secret].",
    );
  });
});
