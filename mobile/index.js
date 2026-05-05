// Custom entry point for oneto mobile.
//
// The Web Crypto polyfill MUST execute before expo-router/entry.js scans
// the app/ directory, because that scan evaluates generating-keys.tsx
// which imports @noble/ed25519, and that library caches
// globalThis.crypto at module-evaluation time. If crypto.getRandomValues
// is not defined by then, key generation fails at runtime.
//
// By placing the polyfill import here — in the true entry point — we
// guarantee it runs before any route file or shared-library module is
// evaluated.

require("./src/crypto/polyfill");

// Hand off to expo-router's standard entry, which sets up the file-based
// routing, imports all route files, and renders the app.
require("expo-router/entry");
