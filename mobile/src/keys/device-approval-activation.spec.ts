import { ApiError } from "../api/errors";
import {
  APPROVAL_DIFFERENT_PHONE_MESSAGE,
  APPROVAL_INVALID_OLD_PHONE_MESSAGE,
  APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
  APPROVAL_REGISTER_FAILED_MESSAGE,
  APPROVAL_SESSION_EXPIRED_MESSAGE,
  APPROVAL_USER_MISMATCH_MESSAGE,
  activateDeviceApproval,
  precheckDeviceApproval,
} from "./device-approval-activation";
import {
  buildNewDeviceApprovalPayload,
  stringifyDeviceTransferPayload,
} from "./device-transfer-payload";

const VALID_PUBLIC_KEY =
  "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_PUBLIC_KEY =
  "ed25519:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const VALID_ROTATION_SIGNATURE = "ed25519:" + "a".repeat(128);
const FRESH_TOKEN = createTokenWithOffsetSeconds(3600);

describe("device approval activation", () => {
  it("approval success registers, promotes, and completes onboarding", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const pendingPrivateKey = new Uint8Array(32).fill(7);
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey,
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result.ok).toBe(true);
    expect(registerPublicKey).toHaveBeenCalledWith(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );
    expect(promotePendingRecoveryKeypair).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledWith(
      pendingPrivateKey,
      VALID_PUBLIC_KEY,
    );
  });

  it("registerPublicKey failure returns explicit error and does not route or complete", async () => {
    const registerPublicKey = jest
      .fn()
      .mockRejectedValue(new ApiError("Unauthorized", 401, "UNAUTHORIZED"));
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(9),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_SESSION_EXPIRED_MESSAGE,
    });
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("rotation-signature 401 maps to invalid-approval message", async () => {
    const registerPublicKey = jest
      .fn()
      .mockRejectedValue(new ApiError("rotation_signature_invalid", 401, "Unauthorized"));
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(9),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_INVALID_OLD_PHONE_MESSAGE,
    });
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("missing pending keypair returns explicit error and does not call register", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: null,
      pendingPrivateKey: null,
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
    });
    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("missing token precheck returns session-expired and does not call registerPublicKey", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(8),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => null,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_SESSION_EXPIRED_MESSAGE,
    });
    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("expired token precheck returns session-expired and does not call registerPublicKey", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(8),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => createTokenWithOffsetSeconds(-120),
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_SESSION_EXPIRED_MESSAGE,
    });
    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("public key mismatch returns explicit error and does not call registerPublicKey", async () => {
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      OTHER_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = precheckDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      log,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_DIFFERENT_PHONE_MESSAGE,
    });
  });

  it("never logs privateKey, PIN, or full rotation signature", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );
    const pendingPrivateKey = new Uint8Array(32).fill(5);

    await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey,
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    const flattenedLogs = JSON.stringify(log.mock.calls);
    expect(flattenedLogs).not.toContain("privateKey");
    expect(flattenedLogs).not.toContain("pin");
    expect(flattenedLogs).not.toContain(FRESH_TOKEN);
    expect(flattenedLogs).not.toContain(VALID_ROTATION_SIGNATURE);
    expect(flattenedLogs).not.toContain(VALID_PUBLIC_KEY);
  });

  it("returns register-failed message for non-401 register errors", async () => {
    const registerPublicKey = jest
      .fn()
      .mockRejectedValue(new ApiError("server error", 500, "INTERNAL"));
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(9),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_REGISTER_FAILED_MESSAGE,
    });
  });

  it("allows retry after re-auth and succeeds with a fresh token", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const missingTokenResult = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(8),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => null,
    });
    expect(missingTokenResult).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_SESSION_EXPIRED_MESSAGE,
    });

    const freshTokenResult = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(8),
      authStateStatus: "recovery_pending",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });
    expect(freshTokenResult.ok).toBe(true);
    expect(registerPublicKey).toHaveBeenCalledTimes(1);
    expect(promotePendingRecoveryKeypair).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
  });

  it("blocks activation when authenticated user does not match recovery session user", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingRecoveryKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const log = jest.fn();
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    const result = await activateDeviceApproval({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey: new Uint8Array(32).fill(8),
      authStateStatus: "recovery_pending",
      authUserId: "u_wrong",
      authUserEmail: "wrong@stu.cu.edu.ng",
      expectedRecoveryUserId: "u_expected",
      expectedRecoveryUserEmail: "oadeluka.2202531@stu.cu.edu.ng",
      registerPublicKey,
      promotePendingRecoveryKeypair,
      completeOnboarding,
      log,
      getTokenFn: async () => FRESH_TOKEN,
    });

    expect(result).toEqual({
      ok: false,
      routeTarget: null,
      message: APPROVAL_USER_MISMATCH_MESSAGE,
    });
    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingRecoveryKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });
});

function createTokenWithOffsetSeconds(offsetSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "u_test",
    email: "test@stu.cu.edu.ng",
    role: "STUDENT",
    pubKeyRegistered: false,
    iat: now,
    exp: now + offsetSeconds,
  } as const;
  const header = { alg: "HS256", typ: "JWT" } as const;
  return `${toBase64Url(header)}.${toBase64Url(payload)}.signature`;
}

function toBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
