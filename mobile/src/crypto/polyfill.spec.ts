jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((length: number) =>
    Uint8Array.from({ length }, (_, index) => (index + 1) & 0xff),
  ),
}));

describe("crypto polyfill", () => {
  const mutableGlobal = globalThis as typeof globalThis & {
    crypto?: typeof globalThis.crypto;
  };
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    jest.resetModules();

    if (originalCrypto === undefined) {
      Reflect.deleteProperty(mutableGlobal, "crypto");
    } else {
      mutableGlobal.crypto = originalCrypto;
    }
  });

  it("fills typed arrays via crypto.getRandomValues", () => {
    Reflect.deleteProperty(mutableGlobal, "crypto");

    jest.isolateModules(() => {
      require("./polyfill");
    });

    const bytes = new Uint8Array(4);
    const returned = globalThis.crypto.getRandomValues(bytes);

    expect(returned).toBe(bytes);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
