import {
  getDeviceLinkedActions,
  RECOVERY_PENDING_MESSAGES,
  RECOVERY_REASON_OPTIONS,
  RECOVERY_REJECTED_MESSAGE,
  RECOVERY_REQUEST_WARNINGS,
  SUPPORT_EMAIL_ADDRESS,
} from "./recovery-ui";

describe("recovery ui helpers", () => {
  it("shows a recovery-first device-linked flow by default", () => {
    const actions = getDeviceLinkedActions(false);

    expect(actions).toEqual([
      {
        label: "Request account recovery",
        pathname: "/(onboarding)/recovery-request",
      },
    ]);
  });

  it("shows the old-phone action only when the feature flag is enabled", () => {
    const actions = getDeviceLinkedActions(true);

    expect(actions.map((action) => action.label)).toContain("I still have my old phone");
  });

  it("includes the NEW_PHONE recovery reason and the support safety copy", () => {
    expect(RECOVERY_REASON_OPTIONS.map((option) => option.value)).toContain("NEW_PHONE");
    expect(RECOVERY_REQUEST_WARNINGS).toContain(
      "Oneto Support will never ask for your PIN or OTP.",
    );
  });

  it("includes the pending-state support email and 48-hour verification copy", () => {
    expect(RECOVERY_PENDING_MESSAGES[0]).toContain(SUPPORT_EMAIL_ADDRESS);
    expect(RECOVERY_PENDING_MESSAGES[2]).toContain("48-hour verification window");
  });

  it("keeps the rejected recovery copy explicit about manual review", () => {
    expect(RECOVERY_REJECTED_MESSAGE).toContain("support must review it manually");
  });
});
