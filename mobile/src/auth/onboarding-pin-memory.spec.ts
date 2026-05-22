import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearPendingOnboardingPin,
  consumePendingOnboardingPin,
  setPendingOnboardingPin,
} from "./onboarding-pin-memory";

describe("onboarding PIN memory handoff", () => {
  beforeEach(() => {
    clearPendingOnboardingPin();
  });

  it("keeps a valid onboarding PIN in memory until one-shot consumption", () => {
    setPendingOnboardingPin("123456");

    expect(consumePendingOnboardingPin()).toBe("123456");
    expect(consumePendingOnboardingPin()).toBeNull();
  });

  it("rejects non-six-digit values and clears any stale pending PIN", () => {
    setPendingOnboardingPin("123456");

    expect(() => setPendingOnboardingPin("12345")).toThrow(
      "Onboarding PIN must be exactly 6 digits.",
    );
    expect(consumePendingOnboardingPin()).toBeNull();

    expect(() => setPendingOnboardingPin("12345a")).toThrow(
      "Onboarding PIN must be exactly 6 digits.",
    );
    expect(consumePendingOnboardingPin()).toBeNull();
  });

  it("allows explicit clearing before consumption", () => {
    setPendingOnboardingPin("654321");

    clearPendingOnboardingPin();

    expect(consumePendingOnboardingPin()).toBeNull();
  });

  it("does not pass the onboarding PIN through Expo Router params", () => {
    const appDir = join(__dirname, "..", "..", "app", "(onboarding)");
    const pinSetupSource = readFileSync(join(appDir, "pin-setup.tsx"), "utf8");
    const generatingKeysSource = readFileSync(
      join(appDir, "generating-keys.tsx"),
      "utf8",
    );

    expect(pinSetupSource).not.toContain(["params:", "{ pin"].join(" "));
    expect(generatingKeysSource).not.toContain(
      ["useLocalSearchParams<{", "pin"].join(" "),
    );
    expect(generatingKeysSource).not.toContain(["params", "pin"].join("."));
  });
});
