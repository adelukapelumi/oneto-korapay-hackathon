import "fast-text-encoding";
import * as Crypto from "expo-crypto";

interface MutableCrypto {
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

type PolyfillGlobal = {
  crypto?: MutableCrypto;
};

const globalScope = globalThis as unknown as PolyfillGlobal;

// Manually polyfill the standard Web Crypto API for @noble/ed25519
if (typeof globalScope.crypto !== "object") {
  globalScope.crypto = {} as MutableCrypto;
}
if (typeof globalScope.crypto.getRandomValues !== "function") {
  globalScope.crypto.getRandomValues = function getRandomValues<T extends ArrayBufferView>(array: T): T {
    if (typeof array !== "object" || array === null || array.byteLength === undefined) {
      throw new Error("crypto.getRandomValues() requires a typed array");
    }
    // Generate secure random bytes synchronously via Expo's native module
    const bytes = Crypto.getRandomBytes(array.byteLength);
    // Mutate the passed-in array to comply with the Web Crypto standard
    const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    view.set(bytes);
    return array;
  };
}
