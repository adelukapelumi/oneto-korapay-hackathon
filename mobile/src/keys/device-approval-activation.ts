import type { PublicKeyString, SignatureString } from "@oneto/shared";
import { ApiError, NetworkError } from "../api/errors";
import {
  DeviceTransferPayloadError,
  assertApprovalMatchesPendingPublicKey,
  parseNewDeviceApprovalQr,
  type NewDeviceApprovalPayload,
} from "./device-transfer-payload";

export const APP_HOME_ROUTE = "/(app)/home" as const;

export const APPROVAL_FAILED_RESCAN_MESSAGE = "Approval failed. Try scanning again.";
export const APPROVAL_DIFFERENT_PHONE_MESSAGE =
  "This approval code is for a different phone.";
export const APPROVAL_RECOVERY_KEY_MISSING_MESSAGE =
  "Recovery key missing. Set up again or contact support.";
export const APPROVAL_REGISTER_FAILED_MESSAGE =
  "Couldn't register this phone. Check connection and try again.";

export interface DeviceApprovalLog {
  readonly event: string;
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
}

export type DeviceApprovalLogger = (entry: DeviceApprovalLog) => void;

export interface PrecheckDeviceApprovalInput {
  readonly rawApprovalQr: string;
  readonly pendingPublicKey: string;
  readonly log: DeviceApprovalLogger;
}

export interface ActivateDeviceApprovalInput {
  readonly rawApprovalQr: string;
  readonly pendingPublicKey: string | null;
  readonly pendingPrivateKey: Uint8Array | null;
  readonly registerPublicKey: (
    publicKey: PublicKeyString,
    rotationSignature: SignatureString,
  ) => Promise<unknown>;
  readonly promotePendingRecoveryKeypair: () => Promise<void>;
  readonly completeOnboarding: (
    privateKey: Uint8Array,
    publicKey: PublicKeyString,
  ) => void;
  readonly log: DeviceApprovalLogger;
}

export interface DeviceApprovalSuccess {
  readonly ok: true;
  readonly routeTarget: typeof APP_HOME_ROUTE;
  readonly approval: NewDeviceApprovalPayload;
}

export interface DeviceApprovalFailure {
  readonly ok: false;
  readonly routeTarget: null;
  readonly message: string;
}

export type DeviceApprovalResult = DeviceApprovalSuccess | DeviceApprovalFailure;

export function precheckDeviceApproval({
  rawApprovalQr,
  pendingPublicKey,
  log,
}: PrecheckDeviceApprovalInput): DeviceApprovalResult {
  const parsed = parseAndMatchApproval({
    rawApprovalQr,
    pendingPublicKey,
    log,
    stage: "precheck",
  });
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, routeTarget: APP_HOME_ROUTE, approval: parsed.approval };
}

export async function activateDeviceApproval({
  rawApprovalQr,
  pendingPublicKey,
  pendingPrivateKey,
  registerPublicKey,
  promotePendingRecoveryKeypair,
  completeOnboarding,
  log,
}: ActivateDeviceApprovalInput): Promise<DeviceApprovalResult> {
  if (!pendingPublicKey || !pendingPrivateKey) {
    log({
      event: "device_approval.recovery_key_missing",
      context: { stage: "activate" },
    });
    return {
      ok: false,
      routeTarget: null,
      message: APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
    };
  }

  const parsed = parseAndMatchApproval({
    rawApprovalQr,
    pendingPublicKey,
    log,
    stage: "activate",
  });
  if (!parsed.ok) {
    return parsed;
  }

  const approval = parsed.approval;
  const suffix = shortKeySuffix(approval.newPublicKey);

  log({
    event: "device_approval.register_public_key_started",
    context: { publicKeySuffix: suffix },
  });
  try {
    await registerPublicKey(approval.newPublicKey, approval.rotationSignature);
    log({
      event: "device_approval.register_public_key_succeeded",
      context: { publicKeySuffix: suffix },
    });
  } catch (error) {
    log({
      event: "device_approval.register_public_key_failed",
      context: { publicKeySuffix: suffix, ...safeErrorContext(error) },
    });
    return {
      ok: false,
      routeTarget: null,
      message: APPROVAL_REGISTER_FAILED_MESSAGE,
    };
  }

  log({
    event: "device_approval.promote_pending_keypair_started",
    context: { publicKeySuffix: suffix },
  });
  try {
    await promotePendingRecoveryKeypair();
    log({
      event: "device_approval.promote_pending_keypair_succeeded",
      context: { publicKeySuffix: suffix },
    });
  } catch (error) {
    log({
      event: "device_approval.promote_pending_keypair_failed",
      context: { publicKeySuffix: suffix, ...safeErrorContext(error) },
    });
    return {
      ok: false,
      routeTarget: null,
      message: APPROVAL_FAILED_RESCAN_MESSAGE,
    };
  }

  try {
    completeOnboarding(pendingPrivateKey, approval.newPublicKey);
    log({
      event: "device_approval.complete_onboarding_called",
      context: { publicKeySuffix: suffix },
    });
  } catch (error) {
    log({
      event: "device_approval.complete_onboarding_failed",
      context: { publicKeySuffix: suffix, ...safeErrorContext(error) },
    });
    return {
      ok: false,
      routeTarget: null,
      message: APPROVAL_FAILED_RESCAN_MESSAGE,
    };
  }

  log({
    event: "device_approval.final_route_target",
    context: { routeTarget: APP_HOME_ROUTE },
  });
  return {
    ok: true,
    routeTarget: APP_HOME_ROUTE,
    approval,
  };
}

interface ParseAndMatchApprovalInput {
  readonly rawApprovalQr: string;
  readonly pendingPublicKey: string;
  readonly log: DeviceApprovalLogger;
  readonly stage: "precheck" | "activate";
}

function parseAndMatchApproval({
  rawApprovalQr,
  pendingPublicKey,
  log,
  stage,
}: ParseAndMatchApprovalInput): DeviceApprovalResult {
  try {
    const approval = parseNewDeviceApprovalQr(rawApprovalQr);
    const suffix = shortKeySuffix(approval.newPublicKey);
    log({
      event: "device_approval.payload_parsed",
      context: { stage, publicKeySuffix: suffix },
    });
    assertApprovalMatchesPendingPublicKey(approval, pendingPublicKey);
    log({
      event: "device_approval.pending_public_key_matched",
      context: { stage, publicKeySuffix: suffix },
    });
    return { ok: true, routeTarget: APP_HOME_ROUTE, approval };
  } catch (error) {
    const message = mapApprovalValidationMessage(error);
    log({
      event: "device_approval.payload_validation_failed",
      context: { stage, ...safeErrorContext(error) },
    });
    return { ok: false, routeTarget: null, message };
  }
}

function mapApprovalValidationMessage(error: unknown): string {
  if (
    error instanceof DeviceTransferPayloadError &&
    error.code === "approval_public_key_mismatch"
  ) {
    return APPROVAL_DIFFERENT_PHONE_MESSAGE;
  }
  if (error instanceof DeviceTransferPayloadError) {
    return APPROVAL_FAILED_RESCAN_MESSAGE;
  }
  if (error instanceof NetworkError || error instanceof ApiError) {
    return APPROVAL_REGISTER_FAILED_MESSAGE;
  }
  return APPROVAL_FAILED_RESCAN_MESSAGE;
}

function shortKeySuffix(publicKey: string): string {
  if (publicKey.length <= 8) {
    return publicKey;
  }
  return publicKey.slice(-8);
}

function safeErrorContext(
  error: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (error instanceof ApiError) {
    return {
      errorName: error.name,
      status: error.status,
      code: error.code ?? null,
    };
  }
  if (error instanceof NetworkError) {
    return {
      errorName: error.name,
    };
  }
  if (error instanceof DeviceTransferPayloadError) {
    return {
      errorName: error.name,
      code: error.code,
    };
  }
  if (error instanceof Error) {
    return {
      errorName: error.name,
    };
  }
  return {
    errorName: "UnknownError",
  };
}
