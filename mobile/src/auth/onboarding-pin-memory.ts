const ONBOARDING_PIN_REGEX = /^\d{6}$/;

let pendingOnboardingPin: string | null = null;

function assertValidOnboardingPin(pin: string): void {
  if (!ONBOARDING_PIN_REGEX.test(pin)) {
    throw new Error("Onboarding PIN must be exactly 6 digits.");
  }
}

export function setPendingOnboardingPin(pin: string): void {
  try {
    assertValidOnboardingPin(pin);
  } catch (err) {
    pendingOnboardingPin = null;
    throw err;
  }
  pendingOnboardingPin = pin;
}

export function consumePendingOnboardingPin(): string | null {
  const pin = pendingOnboardingPin;
  pendingOnboardingPin = null;
  return pin;
}

export function clearPendingOnboardingPin(): void {
  pendingOnboardingPin = null;
}
