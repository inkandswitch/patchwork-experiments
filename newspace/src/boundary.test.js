import { describe, it, expect, vi } from "vitest";
import {
  isJsonable, serializeComplement, hydrateComplement,
  serveBoundary, receiveBoundary,
} from "./boundary.js";

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

describe("isJsonable — cyclic values (no stack blowup)", () => {
  it("classifies a cyclic OBJECT as not-jsonable instead of throwing RangeError", () => {
    const v = { a: 1 };
    v.self = v;
    expect(() => isJsonable(v)).not.toThrow();
    expect(isJsonable(v)).toBe(false);
  });
  it("a cyclic ARRAY is not jsonable either", () => {
    const arr = [1];
    arr.push(arr);
    expect(isJsonable(arr)).toBe(false);
  });
  it("a SHARED (diamond) reference is still jsonable — only true cycles are rejected", () => {
    const shared = { k: 1 };
    expect(isJsonable({ a: shared, b: shared })).toBe(true);
    expect(isJsonable([shared, shared])).toBe(true);
  });
  it("serializeComplement DROPS a cyclic field instead of crashing", () => {
    const cyc = {}; cyc.me = cyc;
    const { data, dropped } = serializeComplement({ ok: 1, cyc });
    expect(data).toEqual({ ok: 1 });
    expect(dropped).toEqual(["cyc"]);
  });
});

// ── the real MessagePort proxy ───────────────────────────────────────────────
// a REAL MessageChannel (async delivery) — the near side serves, the far side
// receives { complement, dropped, close } and calls capabilities as async stubs.
const tick = () => new Promise((r) => setTimeout(r, 0)); // let queued port messages deliver

async function boundaryPair(near) {
  const ch = new MessageChannel();
  const stop = serveBoundary(near, ch.port1);
  const far = await receiveBoundary(ch.port2);
  return { far, stop };
}

describe("serveBoundary / receiveBoundary — a complement across a real MessagePort", () => {
  it("data crosses by value, capabilities become async stubs, drops are LISTED", async () => {
    class Handle {}
    const near = { name: "a.txt", size: 3, save: vi.fn(async () => "saved"), handle: new Handle() };
    const { far, stop } = await boundaryPair(near);
    expect(far.complement.name).toBe("a.txt");
    expect(far.complement.size).toBe(3);
    expect(far.dropped).toEqual(["handle"]); // the far side can SEE what didn't cross
    expect(far.complement.handle).toBeUndefined();
    // presence IS the affordance — feature-detection works across the boundary
    expect(typeof far.complement.save).toBe("function");
    expect(far.complement.missing).toBeUndefined();
    await expect(far.complement.save?.()).resolves.toBe("saved");
    expect(near.save).toHaveBeenCalledWith();
    stop();
  });

  it("args cross to the near function; the result crosses back (promises supported)", async () => {
    const near = { seek: vi.fn(async (n, label) => ({ at: n * 2, label })) };
    const { far, stop } = await boundaryPair(near);
    await expect(far.complement.seek(21, "here")).resolves.toEqual({ at: 42, label: "here" });
    expect(near.seek).toHaveBeenCalledWith(21, "here");
    stop();
  });

  it("CONCURRENT calls settle independently, even completing out of order", async () => {
    let release;
    const near = {
      slow: () => new Promise((res) => { release = () => res("slow"); }),
      fast: async () => "fast",
    };
    const { far, stop } = await boundaryPair(near);
    const slow = far.complement.slow();
    await tick(); // the slow call is in flight near-side
    await expect(far.complement.fast()).resolves.toBe("fast"); // fast overtakes slow
    release();
    await expect(slow).resolves.toBe("slow"); // correlated by id, not by order
    stop();
  });

  it("a THROWING capability rejects the far promise with the message (error serialized safely)", async () => {
    const { far, stop } = await boundaryPair({ boom: () => { throw new Error("kapow"); } });
    await expect(far.complement.boom()).rejects.toThrow("kapow");
    stop();
  });

  it("an async REJECTION rejects too", async () => {
    const { far, stop } = await boundaryPair({ later: async () => { throw new Error("eventually"); } });
    await expect(far.complement.later()).rejects.toThrow("eventually");
    stop();
  });

  it("a capability returning a NON-CLONABLE value rejects with a clear error", async () => {
    const { far, stop } = await boundaryPair({ leak: () => () => {} }); // returns a function
    await expect(far.complement.leak()).rejects.toThrow(/non-clonable/);
    stop();
  });

  it("a non-clonable ARG is refused far-side — it never reaches the near function", async () => {
    const near = { save: vi.fn() };
    const { far, stop } = await boundaryPair(near);
    await expect(far.complement.save(() => {})).rejects.toThrow(/not clonable/);
    await tick();
    expect(near.save).not.toHaveBeenCalled();
    stop();
  });

  it("NEAR-side teardown: pending calls reject, later calls reject 'boundary closed'", async () => {
    const near = { hang: () => new Promise(() => {}) }; // never settles near-side
    const { far, stop } = await boundaryPair(near);
    const pending = far.complement.hang();
    await tick();
    stop(); // the server goes away
    await expect(pending).rejects.toThrow("boundary closed");
    await expect(far.complement.hang()).rejects.toThrow("boundary closed");
  });

  it("FAR-side teardown: later stub calls reject locally, the near side never hears them", async () => {
    const near = { save: vi.fn(async () => "ok") };
    const { far, stop } = await boundaryPair(near);
    far.close();
    await expect(far.complement.save()).rejects.toThrow("boundary closed");
    await tick();
    expect(near.save).not.toHaveBeenCalled();
    stop();
  });

  it("close arriving before the complement rejects receiveBoundary itself", async () => {
    const ch = new MessageChannel();
    const receiving = receiveBoundary(ch.port2);
    ch.port1.postMessage({ type: "boundary:close" }); // a server that dies before serving
    await expect(receiving).rejects.toThrow("boundary closed");
  });

  it("an unknown capability name gets an error result (raw protocol robustness)", async () => {
    const ch = new MessageChannel();
    const stop = serveBoundary({}, ch.port1);
    const results = [];
    ch.port2.onmessage = (e) => results.push(e.data);
    ch.port2.postMessage({ type: "boundary:call", id: 1, name: "nope", args: [] });
    await tick();
    const r = results.find((m) => m.type === "boundary:result");
    expect(r).toEqual({ type: "boundary:result", id: 1, error: "no such capability: nope" });
    stop();
  });

  it("an EMPTY complement still crosses (the sandbox serves {} for an unwired inlet)", async () => {
    const { far, stop } = await boundaryPair({});
    expect(far.complement).toEqual({});
    expect(far.dropped).toEqual([]);
    stop();
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
