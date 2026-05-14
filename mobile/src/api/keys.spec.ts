// @noble/ed25519 v2 ships pure ESM, which Jest's CJS resolver can't load
// without a transform. We mock it here with a deterministic fake. The
// production code paths (Metro bundler in the actual app) consume the
// real module — Metro handles ESM natively. Tests therefore verify the
// API contract (correct args passed in, output shaped correctly), and
// the underlying signature math is covered by @noble/ed25519's own
// test suite plus the shared package's vitest tests.

const fakeSignature = new Uint8Array(64).fill(0xab);
const fakePublicKey = new Uint8Array(32).fill(0xcd);

const sign = jest.fn((_msg: Uint8Array, _key: Uint8Array) => fakeSignature);
const getPublicKey = jest.fn((_priv: Uint8Array) => fakePublicKey);

jest.mock("@noble/ed25519", () => ({
  sign,
  getPublicKey,
  etc: {
    sha512Sync: undefined as ((...m: Uint8Array[]) => Uint8Array) | undefined,
    concatBytes: (...arrs: Uint8Array[]): Uint8Array => {
      let total = 0;
      for (const a of arrs) total += a.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const a of arrs) {
        out.set(a, off);
        off += a.length;
      }
      return out;
    },
  },
}));

// Mock @oneto/shared too — its compiled dist also pulls in ed25519, and
// Jest can't load the workspace symlink's TS sources without transforming
// them. We re-implement the few branded-type helpers we need for tests.
jest.mock("@oneto/shared", () => ({
  toPublicKeyString: (s: string) => s,
  toSignatureString: (s: string) => s,
  buildKeyRotationMessage: (s: string) => `oneto:key-rotation:v1:${s}`,
}));

import type { AxiosInstance } from "axios";
import {
  RotationSignatureRequiredError,
  registerPublicKey,
  signRotation,
} from "./keys";
import { ApiError, NetworkError } from "./errors";

function fakeClient(post: (url: string, body: unknown) => Promise<unknown>): AxiosInstance {
  return {
    post: (url: string, body: unknown) => post(url, body),
  } as unknown as AxiosInstance;
}

const SAMPLE_PUBKEY =
  "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as never;

describe("registerPublicKey", () => {
  it("posts {publicKey} only on first registration", async () => {
    const post = jest.fn().mockResolvedValue({ data: { success: true } });
    await registerPublicKey(SAMPLE_PUBKEY, undefined, fakeClient((u, b) => post(u, b)));
    expect(post).toHaveBeenCalledWith("/auth/keys/register", {
      publicKey: SAMPLE_PUBKEY,
    });
  });

  it("posts both publicKey and rotationSignature on rotation", async () => {
    const post = jest.fn().mockResolvedValue({ data: { success: true } });
    const sig = ("ed25519:" + "a".repeat(128)) as never;
    await registerPublicKey(SAMPLE_PUBKEY, sig, fakeClient((u, b) => post(u, b)));
    expect(post).toHaveBeenCalledWith("/auth/keys/register", {
      publicKey: SAMPLE_PUBKEY,
      rotationSignature: sig,
    });
  });

  it("throws RotationSignatureRequiredError on the specific 400", async () => {
    const client = fakeClient(() =>
      Promise.reject({
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: "rotation_signature_required" },
        },
      }),
    );
    await expect(
      registerPublicKey(SAMPLE_PUBKEY, undefined, client),
    ).rejects.toBeInstanceOf(RotationSignatureRequiredError);
  });

  it("propagates a generic 400 (not the rotation marker) as ApiError", async () => {
    const client = fakeClient(() =>
      Promise.reject({
        isAxiosError: true,
        response: { status: 400, data: { message: "Invalid public key format" } },
      }),
    );
    await expect(
      registerPublicKey(SAMPLE_PUBKEY, undefined, client),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("converts a network failure to NetworkError", async () => {
    const client = fakeClient(() =>
      Promise.reject({ isAxiosError: true, response: undefined }),
    );
    await expect(
      registerPublicKey(SAMPLE_PUBKEY, undefined, client),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("signRotation", () => {
  beforeEach(() => sign.mockClear());

  it("signs domain-separated UTF-8 bytes of the new public key string with the OLD private key", () => {
    const oldPriv = new Uint8Array(32).fill(0x11);
    const newPub = "ed25519:" + "f".repeat(64);

    signRotation(newPub as never, oldPriv);

    expect(sign).toHaveBeenCalledTimes(1);
    const [msgArg, keyArg] = sign.mock.calls[0]!;
    expect(keyArg).toEqual(oldPriv);
    // Message must be the domain-separated UTF-8 bytes, not
    // canonical JSON. Anything else and the backend's verification fails.
    expect(Array.from(msgArg)).toEqual(
      Array.from(new TextEncoder().encode(`oneto:key-rotation:v1:${newPub}`)),
    );
  });

  it("formats the signature as ed25519:<128-hex-chars>", () => {
    const oldPriv = new Uint8Array(32).fill(0x11);
    const sig = signRotation("ed25519:abc" as never, oldPriv);
    expect(typeof sig).toBe("string");
    expect((sig as unknown as string).startsWith("ed25519:")).toBe(true);
    expect((sig as unknown as string).slice("ed25519:".length).length).toBe(128);
  });

  it("rejects a private key of the wrong length", () => {
    expect(() =>
      signRotation("ed25519:abc" as never, new Uint8Array(31)),
    ).toThrow();
  });
});
