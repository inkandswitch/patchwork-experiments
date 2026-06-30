import { describe, it, expect, vi } from "vitest";
import { isJsonable, serializeComplement, hydrateComplement } from "./boundary.js";

describe("isJsonable", () => {
  it("accepts primitives, plain objects, arrays, and bytes", () => {
    expect(isJsonable(null)).toBe(true);
    expect(isJsonable("hi")).toBe(true);
    expect(isJsonable(42)).toBe(true);
    expect(isJsonable(true)).toBe(true);
    expect(isJsonable({ a: 1, b: [2, 3] })).toBe(true);
    expect(isJsonable(Uint8Array.from([1, 2]))).toBe(true); // transferable
  });
  it("rejects functions and class instances (File/MediaStream-like)", () => {
    expect(isJsonable(() => {})).toBe(false);
    class File {}
    expect(isJsonable(new File())).toBe(false);
    expect(isJsonable({ ok: 1, bad: new File() })).toBe(false); // nested non-plain
  });
});

describe("serializeComplement", () => {
  it("splits json data, function capabilities, and undroppable handles", () => {
    class FileHandle {}
    const complement = {
      name: "a.txt", mimeType: "text/plain", // data
      save: () => {}, seek: (n) => n,         // capabilities (arity 0 and 1)
      fileHandle: new FileHandle(),           // dropped (can't cross)
    };
    const { data, capabilities, dropped } = serializeComplement(complement);
    expect(data).toEqual({ name: "a.txt", mimeType: "text/plain" });
    expect(capabilities).toEqual([{ name: "save", arity: 0 }, { name: "seek", arity: 1 }]);
    expect(dropped).toEqual(["fileHandle"]);
  });
  it("tolerates an empty/absent complement", () => {
    expect(serializeComplement()).toEqual({ data: {}, capabilities: [], dropped: [] });
  });
});

describe("hydrateComplement", () => {
  it("rebuilds data + async capability stubs that call invoke(name, args)", async () => {
    const invoke = vi.fn(async (name, args) => `${name}(${args.join(",")})`);
    const c = hydrateComplement({ data: { name: "a.txt" }, capabilities: [{ name: "save", arity: 0 }] }, invoke);
    expect(c.name).toBe("a.txt");
    expect(typeof c.save).toBe("function"); // capability present ⇒ feature-detection still works
    const r = await c.save();
    expect(invoke).toHaveBeenCalledWith("save", []);
    expect(r).toBe("save()");
  });
});

describe("isJsonable: transferable/cloneable media buffers cross by structured-clone", () => {
  it("accepts typed arrays + ArrayBuffer (image/audio pixel buffers)", () => {
    expect(isJsonable(new Float32Array([1, 2, 3]))).toBe(true);
    expect(isJsonable(new Uint8ClampedArray([0, 255]))).toBe(true);
    expect(isJsonable(new ArrayBuffer(8))).toBe(true);
  });
  it("keeps a pixel buffer in `data` (not dropped)", () => {
    const { data, dropped } = serializeComplement({ pixels: new Float32Array([0.5]), handle: { not: "cloneable", proto: Object.create({}) } });
    expect(data.pixels).toBeInstanceOf(Float32Array);
  });
});
