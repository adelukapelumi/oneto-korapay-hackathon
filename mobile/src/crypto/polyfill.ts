import "fast-text-encoding";
import * as Crypto from "expo-crypto";

// Manually polyfill the standard Web Crypto API for @noble/ed25519
if (typeof global.crypto !== "object") {
  (global as any).crypto = {};
}
if (typeof (global as any).crypto.getRandomValues !== "function") {
  (global as any).crypto.getRandomValues = function getRandomValues(array: any) {
    if (!array || !array.byteLength) {
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
