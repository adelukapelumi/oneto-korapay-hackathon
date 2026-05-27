import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import {
  buildKeyRotationMessage,
  fromHex,
  generateKeypair,
  publicKeyFromString,
} from '@oneto/shared';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe('mobile rotation signature parity', () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_URL ??= 'https://oneto-production.up.railway.app';
  });

  it('mobile signRotation verifies with backend-style message bytes', async () => {
    const { signRotation } =
      require('../../../mobile/src/keys/rotation-signature') as typeof import('../../../mobile/src/keys/rotation-signature');
    const oldDevice = generateKeypair();
    const newDevice = generateKeypair();

    const rotationSignature = signRotation(
      newDevice.publicKeyString,
      oldDevice.privateKey,
    );

    const messageBytes = new TextEncoder().encode(
      buildKeyRotationMessage(newDevice.publicKeyString),
    );
    const signatureBytes = fromHex(
      rotationSignature.slice('ed25519:'.length),
    );
    const oldPublicKeyBytes = publicKeyFromString(oldDevice.publicKeyString);

    const verified = await ed.verify(
      signatureBytes,
      messageBytes,
      oldPublicKeyBytes,
    );
    expect(verified).toBe(true);
  });

  it('old-phone approval payload parses and verifies with backend-style signature check', async () => {
    let derivePublicKeyFromPrivateKey: typeof import('../../../mobile/src/keys/rotation-signature').derivePublicKeyFromPrivateKey;
    let signRotation: typeof import('../../../mobile/src/keys/rotation-signature').signRotation;
    let verifyRotationSignature: typeof import('../../../mobile/src/keys/rotation-signature').verifyRotationSignature;
    let buildApprovalQrAfterPinUnlock: typeof import('../../../mobile/src/keys/device-transfer-payload').buildApprovalQrAfterPinUnlock;
    let buildNewDeviceRequestPayload: typeof import('../../../mobile/src/keys/device-transfer-payload').buildNewDeviceRequestPayload;
    let parseNewDeviceApprovalQr: typeof import('../../../mobile/src/keys/device-transfer-payload').parseNewDeviceApprovalQr;
    let stringifyDeviceTransferPayload: typeof import('../../../mobile/src/keys/device-transfer-payload').stringifyDeviceTransferPayload;
    try {
      ({
        derivePublicKeyFromPrivateKey,
        signRotation,
        verifyRotationSignature,
      } = require('../../../mobile/src/keys/rotation-signature') as typeof import('../../../mobile/src/keys/rotation-signature'));
      ({
        buildApprovalQrAfterPinUnlock,
        buildNewDeviceRequestPayload,
        parseNewDeviceApprovalQr,
        stringifyDeviceTransferPayload,
      } = require('../../../mobile/src/keys/device-transfer-payload') as typeof import('../../../mobile/src/keys/device-transfer-payload'));
    } catch (error) {
      throw new Error(`failed to load mobile approval helpers: ${String(error)}`);
    }

    const oldDevice = generateKeypair();
    const newDevice = generateKeypair();

    const request = buildNewDeviceRequestPayload(newDevice.publicKeyString);
    const approval = await buildApprovalQrAfterPinUnlock({
      rawRequestQr: stringifyDeviceTransferPayload(request),
      pin: '123456',
      unlockKeypairWithPin: async () => ({
        privateKey: oldDevice.privateKey,
        publicKey: oldDevice.publicKeyString,
      }),
      signRotation,
      derivePublicKeyFromPrivateKey,
      verifyRotationSignature,
    });

    const parsedApproval = parseNewDeviceApprovalQr(
      stringifyDeviceTransferPayload(approval),
    );
    const messageBytes = new TextEncoder().encode(
      buildKeyRotationMessage(parsedApproval.newPublicKey),
    );
    const signatureBytes = fromHex(
      parsedApproval.rotationSignature.slice('ed25519:'.length),
    );
    const oldPublicKeyBytes = publicKeyFromString(oldDevice.publicKeyString);
    const verified = await ed.verify(
      signatureBytes,
      messageBytes,
      oldPublicKeyBytes,
    );
    expect(verified).toBe(true);
  });
});
