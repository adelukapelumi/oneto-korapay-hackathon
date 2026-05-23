import {
  DeviceTransferPayloadError,
  NEW_DEVICE_APPROVAL_TYPE,
  NEW_DEVICE_REQUEST_TYPE,
  acceptDeviceApprovalQr,
  assertApprovalMatchesPendingPublicKey,
  buildApprovalQrAfterPinUnlock,
  buildNewDeviceApprovalPayload,
  buildNewDeviceRequestPayload,
  parseNewDeviceApprovalQr,
  parseNewDeviceRequestQr,
  stringifyDeviceTransferPayload,
} from "./device-transfer-payload";

const VALID_PUBLIC_KEY =
  "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_PUBLIC_KEY =
  "ed25519:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const VALID_ROTATION_SIGNATURE = "ed25519:" + "a".repeat(128);

describe("device transfer payloads", () => {
  it("builds a valid new-device request", () => {
    expect(buildNewDeviceRequestPayload(VALID_PUBLIC_KEY)).toEqual({
      version: 1,
      type: NEW_DEVICE_REQUEST_TYPE,
      newPublicKey: VALID_PUBLIC_KEY,
    });
  });

  it("parses a valid request", () => {
    const payload = buildNewDeviceRequestPayload(VALID_PUBLIC_KEY);
    expect(parseNewDeviceRequestQr(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects malformed publicKey", () => {
    expect(() =>
      buildNewDeviceRequestPayload("ed25519:" + "z".repeat(64)),
    ).toThrow(DeviceTransferPayloadError);
  });

  it("builds a valid approval", () => {
    expect(
      buildNewDeviceApprovalPayload(
        VALID_PUBLIC_KEY,
        VALID_ROTATION_SIGNATURE,
      ),
    ).toEqual({
      version: 1,
      type: NEW_DEVICE_APPROVAL_TYPE,
      newPublicKey: VALID_PUBLIC_KEY,
      rotationSignature: VALID_ROTATION_SIGNATURE,
    });
  });

  it("parses a valid approval", () => {
    const payload = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );
    expect(parseNewDeviceApprovalQr(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects malformed rotationSignature", () => {
    expect(() =>
      buildNewDeviceApprovalPayload(VALID_PUBLIC_KEY, "ed25519:" + "b".repeat(127)),
    ).toThrow(DeviceTransferPayloadError);
  });

  it("rejects wrong version/type", () => {
    expect(() =>
      parseNewDeviceRequestQr(
        JSON.stringify({
          version: 2,
          type: NEW_DEVICE_REQUEST_TYPE,
          newPublicKey: VALID_PUBLIC_KEY,
        }),
      ),
    ).toThrow(DeviceTransferPayloadError);

    expect(() =>
      parseNewDeviceApprovalQr(
        JSON.stringify({
          version: 1,
          type: NEW_DEVICE_REQUEST_TYPE,
          newPublicKey: VALID_PUBLIC_KEY,
          rotationSignature: VALID_ROTATION_SIGNATURE,
        }),
      ),
    ).toThrow(DeviceTransferPayloadError);
  });

  it("rejects an approval if newPublicKey does not match the pending key", () => {
    const approval = buildNewDeviceApprovalPayload(
      OTHER_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );
    expect(() =>
      assertApprovalMatchesPendingPublicKey(approval, VALID_PUBLIC_KEY),
    ).toThrow(DeviceTransferPayloadError);
  });

  it("calls registerPublicKey only after the approval payload is valid", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();

    await expect(
      acceptDeviceApprovalQr({
        rawApprovalQr: "not-json",
        pendingPublicKey: VALID_PUBLIC_KEY,
        pendingPrivateKey: new Uint8Array(32).fill(1),
        registerPublicKey,
        promotePendingKeypair,
        completeOnboarding,
      }),
    ).rejects.toBeInstanceOf(DeviceTransferPayloadError);

    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("does not complete onboarding on invalid approval", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const mismatchedApproval = buildNewDeviceApprovalPayload(
      OTHER_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    await expect(
      acceptDeviceApprovalQr({
        rawApprovalQr: stringifyDeviceTransferPayload(mismatchedApproval),
        pendingPublicKey: VALID_PUBLIC_KEY,
        pendingPrivateKey: new Uint8Array(32).fill(1),
        registerPublicKey,
        promotePendingKeypair,
        completeOnboarding,
      }),
    ).rejects.toBeInstanceOf(DeviceTransferPayloadError);

    expect(registerPublicKey).not.toHaveBeenCalled();
    expect(promotePendingKeypair).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("registers, promotes, and completes onboarding for a matching approval", async () => {
    const registerPublicKey = jest.fn().mockResolvedValue({ success: true });
    const promotePendingKeypair = jest.fn().mockResolvedValue(undefined);
    const completeOnboarding = jest.fn();
    const pendingPrivateKey = new Uint8Array(32).fill(1);
    const approval = buildNewDeviceApprovalPayload(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );

    await acceptDeviceApprovalQr({
      rawApprovalQr: stringifyDeviceTransferPayload(approval),
      pendingPublicKey: VALID_PUBLIC_KEY,
      pendingPrivateKey,
      registerPublicKey,
      promotePendingKeypair,
      completeOnboarding,
    });

    expect(registerPublicKey).toHaveBeenCalledWith(
      VALID_PUBLIC_KEY,
      VALID_ROTATION_SIGNATURE,
    );
    expect(promotePendingKeypair).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledWith(
      pendingPrivateKey,
      VALID_PUBLIC_KEY,
    );
  });

  it("keeps PIN and privateKey out of request and approval QR payloads", () => {
    const requestJson = stringifyDeviceTransferPayload(
      buildNewDeviceRequestPayload(VALID_PUBLIC_KEY),
    );
    const approvalJson = stringifyDeviceTransferPayload(
      buildNewDeviceApprovalPayload(
        VALID_PUBLIC_KEY,
        VALID_ROTATION_SIGNATURE,
      ),
    );

    expect(requestJson).not.toContain("pin");
    expect(requestJson).not.toContain("privateKey");
    expect(approvalJson).not.toContain("pin");
    expect(approvalJson).not.toContain("privateKey");
  });

  it("signs approval only after PIN unlock", async () => {
    const privateKey = new Uint8Array(32).fill(7);
    const unlockKeypairWithPin = jest.fn().mockResolvedValue({ privateKey });
    const signRotation = jest
      .fn()
      .mockReturnValue(VALID_ROTATION_SIGNATURE);

    const request = buildNewDeviceRequestPayload(VALID_PUBLIC_KEY);
    const approval = await buildApprovalQrAfterPinUnlock({
      rawRequestQr: stringifyDeviceTransferPayload(request),
      pin: "123456",
      unlockKeypairWithPin,
      signRotation,
    });

    expect(unlockKeypairWithPin).toHaveBeenCalledWith("123456");
    expect(signRotation).toHaveBeenCalledWith(VALID_PUBLIC_KEY, privateKey);
    const unlockCallOrder = unlockKeypairWithPin.mock.invocationCallOrder[0];
    const signCallOrder = signRotation.mock.invocationCallOrder[0];
    expect(unlockCallOrder).toBeDefined();
    expect(signCallOrder).toBeDefined();
    expect(unlockCallOrder as number).toBeLessThan(signCallOrder as number);
    expect(approval).toEqual(
      buildNewDeviceApprovalPayload(
        VALID_PUBLIC_KEY,
        VALID_ROTATION_SIGNATURE,
      ),
    );
    expect(Array.from(privateKey)).toEqual(Array.from(new Uint8Array(32)));
  });

  it("does not sign when PIN unlock fails", async () => {
    const unlockKeypairWithPin = jest.fn().mockRejectedValue(new Error("no"));
    const signRotation = jest.fn();
    const request = buildNewDeviceRequestPayload(VALID_PUBLIC_KEY);

    await expect(
      buildApprovalQrAfterPinUnlock({
        rawRequestQr: stringifyDeviceTransferPayload(request),
        pin: "000000",
        unlockKeypairWithPin,
        signRotation,
      }),
    ).rejects.toThrow("no");

    expect(signRotation).not.toHaveBeenCalled();
  });
});
