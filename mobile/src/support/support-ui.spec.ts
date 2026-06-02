import {
  DASHBOARD_SUPPORT_LABEL,
  SUPPORT_CONFIRMATION_LINES,
  SUPPORT_SCREEN_FIELDS,
  SUPPORT_TICKET_CATEGORIES,
} from "./support-ui";

describe("support ui helpers", () => {
  it("exposes the support dashboard entry label for both dashboards", () => {
    expect(DASHBOARD_SUPPORT_LABEL).toBe("Need help?");
  });

  it("defines the support screen fields without asking for a PIN", () => {
    expect(SUPPORT_SCREEN_FIELDS).toEqual(["category", "subject", "message"]);
    expect(SUPPORT_SCREEN_FIELDS).not.toContain("pin");
  });

  it("includes the expected support categories and confirmation copy", () => {
    expect(SUPPORT_TICKET_CATEGORIES.map((option) => option.value)).toContain(
      "ACCOUNT_RECOVERY",
    );
    expect(SUPPORT_CONFIRMATION_LINES[0]).toContain("support@getoneto.com");
  });
});
