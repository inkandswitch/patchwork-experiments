import { describe, it, expect } from "vitest";
import { snapshotDelta, pointerLockSource, plugin } from "./pointerlock-source.js";

describe("snapshotDelta", () => {
  it("reads movementX/movementY into { dx, dy }", () => {
    expect(snapshotDelta({ movementX: 3, movementY: -7 })).toEqual({ dx: 3, dy: -7 });
  });
  it("falls back to 0 on a missing/undefined axis", () => {
    expect(snapshotDelta({ movementX: 5 })).toEqual({ dx: 5, dy: 0 });
    expect(snapshotDelta({})).toEqual({ dx: 0, dy: 0 });
  });
  it("treats a null event as a zero delta", () => {
    expect(snapshotDelta(null)).toEqual({ dx: 0, dy: 0 });
    expect(snapshotDelta(undefined)).toEqual({ dx: 0, dy: 0 });
  });
  it("coerces NaN-ish/zero movement to 0 (|| fallback)", () => {
    expect(snapshotDelta({ movementX: 0, movementY: 0 })).toEqual({ dx: 0, dy: 0 });
  });
});

describe("pointerLockSource factory", () => {
  it("requests a lock, pushes deltas on mousemove, and stops cleanly", () => {
    const calls = { request: 0, exit: 0 };
    const listeners = {};
    const fakeBody = {
      requestPointerLock() { calls.request++; },
    };
    const fakeDoc = {
      body: fakeBody,
      pointerLockElement: fakeBody, // the lock was granted to us
      addEventListener(type, cb) { listeners[type] = cb; },
      removeEventListener(type, cb) { if (listeners[type] === cb) delete listeners[type]; },
      exitPointerLock() { calls.exit++; },
    };
    const prevDoc = globalThis.document;
    globalThis.document = fakeDoc;
    try {
      const src = pointerLockSource();
      expect(calls.request).toBe(1);
      expect(typeof listeners.mousemove).toBe("function");
      // a mousemove pushes the snapshotted delta
      listeners.mousemove({ movementX: 4, movementY: -2 });
      expect(src.stream.value).toEqual({ dx: 4, dy: -2 });
      // stop removes the listener and exits the lock
      src.stop();
      expect(listeners.mousemove).toBeUndefined();
      expect(calls.exit).toBe(1);
    } finally {
      globalThis.document = prevDoc;
    }
  });

  it("stops emitting once the lock is lost (Esc), and stop() never exits a lock it doesn't hold", () => {
    const calls = { exit: 0 };
    const listeners = {};
    const fakeBody = { requestPointerLock() {} };
    const fakeDoc = {
      body: fakeBody,
      pointerLockElement: fakeBody,
      addEventListener(type, cb) { listeners[type] = cb; },
      removeEventListener(type, cb) { if (listeners[type] === cb) delete listeners[type]; },
      exitPointerLock() { calls.exit++; },
    };
    const prevDoc = globalThis.document;
    globalThis.document = fakeDoc;
    try {
      const src = pointerLockSource();
      listeners.mousemove({ movementX: 1, movementY: 1 });
      expect(src.stream.value).toEqual({ dx: 1, dy: 1 });
      // Esc: the browser releases the lock — ordinary mouse motion must NOT leak out
      fakeDoc.pointerLockElement = null;
      listeners.mousemove({ movementX: 9, movementY: 9 });
      expect(src.stream.value).toEqual({ dx: 1, dy: 1 }); // unchanged
      // another component now holds the lock — stop() must not steal it
      fakeDoc.pointerLockElement = { other: true };
      src.stop();
      expect(calls.exit).toBe(0);
    } finally {
      globalThis.document = prevDoc;
    }
  });

  it("guards when the API/document is absent (pushes { error }, no-op stop)", () => {
    const prevDoc = globalThis.document;
    // a document with no usable body / requestPointerLock
    globalThis.document = { body: {} };
    try {
      const src = pointerLockSource();
      expect(src.stream.value).toEqual({ error: "Pointer Lock API unavailable" });
      expect(typeof src.stop).toBe("function");
      expect(() => src.stop()).not.toThrow();
    } finally {
      globalThis.document = prevDoc;
    }
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("pointer-lock");
    expect(plugin.name).toBe("Pointer lock");
    expect(plugin.icon).toBe("MousePointer2");
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0].name).toBe("delta");
    expect(plugin.outlets[0].type).toBe("json");
    expect(plugin.outlets[0].schema).toBeTruthy();
  });

  it("load() returns a gated mount function", async () => {
    const mount = await plugin.load();
    expect(typeof mount).toBe("function");
  });
});

// the gated mount: registers a proxy outlet up front, shows an Enable button, and
// forwards the device stream into the proxy once enabled. We drive it with fake
// opstreams and a fake document so the device actually starts.
describe("gated mount behaviour", () => {
  function fakeOpstream(value) {
    return { value, connect(cb) { cb({ type: "snapshot", value: this.value }); return () => {}; }, apply() {} };
  }
  it("exposes the delta proxy outlet before enabling, then forwards deltas", async () => {
    const mount = await plugin.load();
    const element = document.createElement("div");
    const outlets = {};
    const setOutlet = (name, s) => { outlets[name] = s; };

    // fake document so start() can actually lock + listen
    const listeners = {};
    let exited = 0;
    const prevDoc = globalThis.document;
    const realDoc = prevDoc; // keep real createElement for the element above
    const fakeBody = { requestPointerLock() {} };
    globalThis.document = {
      body: fakeBody,
      pointerLockElement: fakeBody, // the lock was granted to us
      addEventListener(type, cb) { listeners[type] = cb; },
      removeEventListener(type, cb) { if (listeners[type] === cb) delete listeners[type]; },
      exitPointerLock() { exited++; },
      createElement: realDoc.createElement.bind(realDoc),
    };
    try {
      const cleanup = mount({ element, outlets, setOutlet });
      // proxy outlet present before enabling
      expect(outlets.delta).toBeTruthy();
      expect(outlets.delta.value).toBe(null);

      // click the Enable button (rendered by makeSourceMount for gated sources)
      const btn = element.querySelector("button");
      expect(btn).toBeTruthy();
      btn.onclick();

      // device started → a mousemove now forwards into the proxy outlet
      expect(typeof listeners.mousemove).toBe("function");
      listeners.mousemove({ movementX: 9, movementY: 1 });
      expect(outlets.delta.value).toEqual({ dx: 9, dy: 1 });

      cleanup();
      expect(exited).toBe(1);
    } finally {
      globalThis.document = prevDoc;
    }
  });
});
