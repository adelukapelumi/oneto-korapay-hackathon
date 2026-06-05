describe("webidl-conversions startup compatibility", () => {
  const mutableGlobal = globalThis as typeof globalThis & {
    SharedArrayBuffer?: typeof SharedArrayBuffer;
  };
  const originalSharedArrayBuffer = globalThis.SharedArrayBuffer;
  const stringPrototype = String.prototype as String["constructor"]["prototype"] & {
    toWellFormed?: () => string;
  };
  const originalToWellFormed = stringPrototype.toWellFormed;

  afterEach(() => {
    jest.resetModules();

    if (originalSharedArrayBuffer === undefined) {
      Reflect.deleteProperty(mutableGlobal, "SharedArrayBuffer");
    } else {
      mutableGlobal.SharedArrayBuffer = originalSharedArrayBuffer;
    }

    if (originalToWellFormed === undefined) {
      Reflect.deleteProperty(stringPrototype, "toWellFormed");
    } else {
      stringPrototype.toWellFormed = originalToWellFormed;
    }
  });

  it("loads Expo's URL dependency chain without SharedArrayBuffer", () => {
    Reflect.deleteProperty(mutableGlobal, "SharedArrayBuffer");

    expect(() => {
      jest.isolateModules(() => {
        require("whatwg-url-without-unicode");
      });
    }).not.toThrow();
  });

  it("keeps USVString working when Hermes lacks String.prototype.toWellFormed", () => {
    Reflect.deleteProperty(stringPrototype, "toWellFormed");

    jest.isolateModules(() => {
      const conversions = require("webidl-conversions") as {
        USVString: (value: string) => string;
      };

      expect(conversions.USVString("\uD800")).toBe("\uFFFD");
      expect(conversions.USVString("ok")).toBe("ok");
    });
  });
});
