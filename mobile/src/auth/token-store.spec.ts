// Manual mock of expo-secure-store. The global jest.setup.js mock is also
// in-memory, but here we want to control it tightly to verify the contract.
jest.mock("expo-secure-store", () => {
  const memory = new Map<string, string>();
  return {
    getItemAsync: jest.fn(
      (key: string): Promise<string | null> =>
        Promise.resolve(memory.has(key) ? (memory.get(key) ?? null) : null),
    ),
    setItemAsync: jest.fn((key: string, value: string): Promise<void> => {
      memory.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string): Promise<void> => {
      memory.delete(key);
      return Promise.resolve();
    }),
    __reset: () => memory.clear(),
  };
});

import * as SecureStore from "expo-secure-store";
import { clearToken, getToken, setToken } from "./token-store";

const reset = (SecureStore as unknown as { __reset: () => void }).__reset;

describe("token-store", () => {
  beforeEach(() => reset());

  it("getToken returns null when nothing is stored", async () => {
    await expect(getToken()).resolves.toBeNull();
  });

  it("setToken persists and getToken retrieves", async () => {
    await setToken("jwt-abc");
    await expect(getToken()).resolves.toBe("jwt-abc");
  });

  it("setToken overwrites the existing value", async () => {
    await setToken("first");
    await setToken("second");
    await expect(getToken()).resolves.toBe("second");
  });

  it("clearToken deletes the value", async () => {
    await setToken("jwt-abc");
    await clearToken();
    await expect(getToken()).resolves.toBeNull();
  });

  it("uses the namespaced key oneto.jwt", async () => {
    await setToken("jwt-abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "oneto.jwt",
      "jwt-abc",
    );
  });
});
