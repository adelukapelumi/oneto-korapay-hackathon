import { z } from "zod";
import type { PublicKeyString, SignatureString } from "@oneto/shared";

export const NEW_DEVICE_REQUEST_TYPE = "oneto:new-device-request";
export const NEW_DEVICE_APPROVAL_TYPE = "oneto:new-device-approval";
export const DEVICE_TRANSFER_PAYLOAD_VERSION = 1;

export const PUBLIC_KEY_REGEX = /^ed25519:[0-9a-f]{64}$/;
export const ROTATION_SIGNATURE_REGEX = /^ed25519:[0-9a-f]{128}$/;

const PublicKeySchema = z
  .string()
  .regex(PUBLIC_KEY_REGEX)
  .transform((value) => value as PublicKeyString);

const RotationSignatureSchema = z
  .string()
  .regex(ROTATION_SIGNATURE_REGEX)
  .transform((value) => value as SignatureString);

export const NewDeviceRequestPayloadSchema = z
  .object({
    version: z.literal(DEVICE_TRANSFER_PAYLOAD_VERSION),
    type: z.literal(NEW_DEVICE_REQUEST_TYPE),
    newPublicKey: PublicKeySchema,
  })
  .strict();

export const NewDeviceApprovalPayloadSchema = z
  .object({
    version: z.literal(DEVICE_TRANSFER_PAYLOAD_VERSION),
    type: z.literal(NEW_DEVICE_APPROVAL_TYPE),
    newPublicKey: PublicKeySchema,
    rotationSignature: RotationSignatureSchema,
  })
  .strict();

export type NewDeviceRequestPayload = z.infer<
  typeof NewDeviceRequestPayloadSchema
>;
export type NewDeviceApprovalPayload = z.infer<
  typeof NewDeviceApprovalPayloadSchema
>;

export type DeviceTransferPayload =
  | NewDeviceRequestPayload
  | NewDeviceApprovalPayload;

export class DeviceTransferPayloadError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceTransferPayloadError";
    this.code = code;
  }
}

export function buildNewDeviceRequestPayload(
  newPublicKey: string,
): NewDeviceRequestPayload {
  const parsedPublicKey = parsePublicKey(newPublicKey);
  return {
    version: DEVICE_TRANSFER_PAYLOAD_VERSION,
    type: NEW_DEVICE_REQUEST_TYPE,
    newPublicKey: parsedPublicKey,
  };
}

export function buildNewDeviceApprovalPayload(
  newPublicKey: string,
  rotationSignature: string,
): NewDeviceApprovalPayload {
  const parsedPublicKey = parsePublicKey(newPublicKey);
  const parsedSignature = parseRotationSignature(rotationSignature);
  return {
    version: DEVICE_TRANSFER_PAYLOAD_VERSION,
    type: NEW_DEVICE_APPROVAL_TYPE,
    newPublicKey: parsedPublicKey,
    rotationSignature: parsedSignature,
  };
}

export function stringifyDeviceTransferPayload(
  payload: DeviceTransferPayload,
): string {
  return JSON.stringify(payload);
}

export function parseNewDeviceRequestQr(
  rawData: string,
): NewDeviceRequestPayload {
  const parsedJson = parseQrJson(rawData);
  const parsed = NewDeviceRequestPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new DeviceTransferPayloadError(
      "invalid_new_device_request",
      "This is not a valid Oneto phone move request.",
    );
  }
  return parsed.data;
}

export function parseNewDeviceApprovalQr(
  rawData: string,
): NewDeviceApprovalPayload {
  const parsedJson = parseQrJson(rawData);
  const parsed = NewDeviceApprovalPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new DeviceTransferPayloadError(
      "invalid_new_device_approval",
      "This is not a valid Oneto phone approval.",
    );
  }
  return parsed.data;
}

export function assertApprovalMatchesPendingPublicKey(
  approval: NewDeviceApprovalPayload,
  pendingPublicKey: string,
): asserts pendingPublicKey is PublicKeyString {
  const parsedPendingPublicKey = parsePublicKey(pendingPublicKey);
  if (approval.newPublicKey !== parsedPendingPublicKey) {
    throw new DeviceTransferPayloadError(
      "approval_public_key_mismatch",
      "This approval is for a different phone.",
    );
  }
}

export interface AcceptDeviceApprovalInput {
  readonly rawApprovalQr: string;
  readonly pendingPublicKey: string;
  readonly pendingPrivateKey: Uint8Array;
  readonly registerPublicKey: (
    publicKey: PublicKeyString,
    rotationSignature: SignatureString,
  ) => Promise<unknown>;
  readonly promotePendingKeypair: () => Promise<void>;
  readonly completeOnboarding: (
    privateKey: Uint8Array,
    publicKey: PublicKeyString,
  ) => void;
}

export interface BuildApprovalAfterPinUnlockInput {
  readonly rawRequestQr: string;
  readonly pin: string;
  readonly unlockKeypairWithPin: (
    pin: string,
  ) => Promise<{ readonly privateKey: Uint8Array }>;
  readonly signRotation: (
    newPublicKey: PublicKeyString,
    oldPrivateKey: Uint8Array,
  ) => SignatureString;
}

export async function buildApprovalQrAfterPinUnlock({
  rawRequestQr,
  pin,
  unlockKeypairWithPin,
  signRotation,
}: BuildApprovalAfterPinUnlockInput): Promise<NewDeviceApprovalPayload> {
  const request = parseNewDeviceRequestQr(rawRequestQr);
  const { privateKey } = await unlockKeypairWithPin(pin);
  try {
    const rotationSignature = signRotation(request.newPublicKey, privateKey);
    return buildNewDeviceApprovalPayload(
      request.newPublicKey,
      rotationSignature,
    );
  } finally {
    privateKey.fill(0);
  }
}

export async function acceptDeviceApprovalQr({
  rawApprovalQr,
  pendingPublicKey,
  pendingPrivateKey,
  registerPublicKey,
  promotePendingKeypair,
  completeOnboarding,
}: AcceptDeviceApprovalInput): Promise<NewDeviceApprovalPayload> {
  const approval = parseNewDeviceApprovalQr(rawApprovalQr);
  assertApprovalMatchesPendingPublicKey(approval, pendingPublicKey);

  await registerPublicKey(approval.newPublicKey, approval.rotationSignature);
  await promotePendingKeypair();
  completeOnboarding(pendingPrivateKey, approval.newPublicKey);

  return approval;
}

function parsePublicKey(value: string): PublicKeyString {
  const parsed = PublicKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new DeviceTransferPayloadError(
      "invalid_public_key",
      "Invalid Oneto phone approval code.",
    );
  }
  return parsed.data;
}

function parseRotationSignature(value: string): SignatureString {
  const parsed = RotationSignatureSchema.safeParse(value);
  if (!parsed.success) {
    throw new DeviceTransferPayloadError(
      "invalid_rotation_signature",
      "Invalid Oneto phone approval code.",
    );
  }
  return parsed.data;
}

function parseQrJson(rawData: string): unknown {
  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    throw new DeviceTransferPayloadError(
      "invalid_json",
      "This QR code could not be read.",
    );
  }
}
