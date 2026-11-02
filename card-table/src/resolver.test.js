import { describe, it, expect } from "vitest";
import { createResolver } from "./scene-resolver.js";
import { newDeckDoc } from "./deck.js";
import { plugins } from "./index.js";

/** One deck doc shared by several resolvers, with change events. */
function sharedDeck(faces, slots) {
  let state = structuredClone(newDeckDoc({ faces, slots }));
  const listeners = new Set();
  return {
    url: "automerge:deck",
    doc: () => state,
    change(fn) {
      const d = structuredClone(state);
      fn(d);
      state = d;
      queueMicrotask(() => {
        for (const l of [...listeners]) l();
      });
    },
    on: (_, f) => listeners.add(f),
    off: (_, f) => listeners.delete(f),
  };
}
const memoryStore = () => {
  const m = new Map();
  return { get: (id) => m.get(id) ?? null, set: (id, v) => m.set(id, v) };
};
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("the scene resolver", () => {
  it("registers as the scene's secrets provider for secure decks, worker-safe", () => {
    const p = plugins.find((x) => x.type === "scene:secrets");
    expect(p.supportedDatatypes).toEqual(["secure-deck"]);
    for (const x of plugins) expect(() => structuredClone({ ...x, load: undefined })).not.toThrow();
  });

  it("two seated players: shuffles on its own, then each sees their own hand and the face-up card", async () => {
    const faces = Array.from({ length: 6 }, (_, i) => ({ sourceUrl: `automerge:face${i}`, name: `Card ${i}` }));
    const slots = Object.fromEntries(faces.map((_, i) => [`o${i}`, i]));
    const deck = sharedDeck(faces, slots);
    const where = { o0: "me", o1: "you", o2: "public" };
    const visibleTo = (p) => new Set(Object.entries(where).filter(([, w]) => w === "public" || (p != null && w === p)).map(([id]) => id));
    const ctx = { players: ["me", "you"], visibleTo, nameOf: (p) => p.toUpperCase() };
    let changes = 0;
    const me = createResolver({ handle: deck, viewer: "me", keyStore: memoryStore(), onChange: () => changes++ });
    const you = createResolver({ handle: deck, viewer: "you", keyStore: memoryStore(), onChange: () => {} });
    me.update(ctx);
    expect(changes).toBe(0);
    await until(() => me.status() === "Waiting for YOU to shuffle.");
    you.update(ctx);
    await until(() => me.looks().size === 2 && you.looks().size === 2);
    expect([...me.looks().keys()].sort()).toEqual(["o0", "o2"]);
    expect([...you.looks().keys()].sort()).toEqual(["o1", "o2"]);
    expect(me.looks().get("o2")).toEqual(you.looks().get("o2"));
    expect(me.status()).toBeNull();
    me.dispose();
    you.dispose();
  }, 30000);
});
