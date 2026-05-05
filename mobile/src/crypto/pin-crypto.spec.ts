import {
  PIN_SALT_LENGTH,
  PinIncorrectError,
  decryptKeypair,
  deriveKeyFromPin,
  encryptKeypair,
  generateRandomBytes,
} from "./pin-crypto";

// scrypt at N=2^15 takes ~200ms per call on a fast laptop. Each test
// derives a key, so we bump the per-test timeout to 30s to be safe in CI.
jest.setTimeout(30_000);

const examplePrivateKey = (): Uint8Array => {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i + 1;
  return k;
};

describe("pin-crypto", () => {
  describe("deriveKeyFromPin", () => {
    it("rejects an empty PIN", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      await expect(deriveKeyFromPin("", salt)).rejects.toThrow();
    });

    it("rejects a salt of the wrong length", async () => {
      const salt = generateRandomBytes(8);
      await expect(deriveKeyFromPin("123456", salt)).rejects.toThrow();
    });

    it("returns a 32-byte key", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const key = await deriveKeyFromPin("123456", salt);
      expect(key.length).toBe(32);
    });

    it("is deterministic — same PIN + same salt = same key", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const a = await deriveKeyFromPin("123456", salt);
      const b = await deriveKeyFromPin("123456", salt);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("derives different keys for different PINs with the same salt", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const a = await deriveKeyFromPin("123456", salt);
      const b = await deriveKeyFromPin("123457", salt);
      expect(Array.from(a)).not.toEqual(Array.from(b));
    });

    it("derives different keys for the same PIN with different salts", async () => {
      const saltA = generateRandomBytes(PIN_SALT_LENGTH);
      const saltB = generateRandomBytes(PIN_SALT_LENGTH);
      const a = await deriveKeyFromPin("123456", saltA);
      const b = await deriveKeyFromPin("123456", saltB);
      expect(Array.from(a)).not.toEqual(Array.from(b));
    });
  });

  describe("encryptKeypair / decryptKeypair", () => {
    it("round-trips with the same derived key", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const key = await deriveKeyFromPin("123456", salt);
      const pk = examplePrivateKey();
      const blob = encryptKeypair(pk, key);
      const decoded = decryptKeypair(blob, key);
      expect(Array.from(decoded)).toEqual(Array.from(pk));
    });

    it("throws PinIncorrectError when decrypted with the wrong key", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const goodKey = await deriveKeyFromPin("123456", salt);
      const badKey = await deriveKeyFromPin("000000", salt);
      const blob = encryptKeypair(examplePrivateKey(), goodKey);
      expect(() => decryptKeypair(blob, badKey)).toThrow(PinIncorrectError);
    });

    it("throws PinIncorrectError when ciphertext is tampered with", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const key = await deriveKeyFromPin("123456", salt);
      const blob = encryptKeypair(examplePrivateKey(), key);
      const tampered = {
        ...blob,
        ciphertext: new Uint8Array(blob.ciphertext),
      };
      tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 0xff;
      expect(() => decryptKeypair(tampered, key)).toThrow(PinIncorrectError);
    });

    it("generates a fresh random nonce for each encryption", async () => {
      const salt = generateRandomBytes(PIN_SALT_LENGTH);
      const key = await deriveKeyFromPin("123456", salt);
      const pk = examplePrivateKey();
      const a = encryptKeypair(pk, key);
      const b = encryptKeypair(pk, key);
      expect(Array.from(a.nonce)).not.toEqual(Array.from(b.nonce));
      // Same plaintext + key + different nonce → different ciphertext
      expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext));
    });

    it("rejects a derived key of the wrong length", () => {
      expect(() =>
        encryptKeypair(examplePrivateKey(), new Uint8Array(16)),
      ).toThrow();
    });
  });
});
