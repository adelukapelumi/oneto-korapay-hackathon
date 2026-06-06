// Default env for tests. Individual specs override per-case.
process.env.EXPO_PUBLIC_API_URL = "https://api.getoneto.com";

// expo-secure-store ships a JS-only mock when not running on a device, but
// some Jest setups still hit the native bridge. Replace with an in-memory
// implementation. Specs that test the wrapper inject their own mock.
jest.mock("expo-secure-store", () => {
  const memory = new Map();
  return {
    getItemAsync: jest.fn((key) =>
      Promise.resolve(memory.has(key) ? memory.get(key) : null),
    ),
    setItemAsync: jest.fn((key, value) => {
      memory.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      memory.delete(key);
      return Promise.resolve();
    }),
  };
});
