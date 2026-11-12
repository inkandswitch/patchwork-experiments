// The lots extension, three seated clients and a spectator on one doc, with
// the platform's real WebCrypto: a draw for one viewer, a draw sealed by
// everyone (released between them with real envelopes), the release when
// the stage's audience for the object becomes everyone, and a reroll that
// honest clients refuse. The audience is given here as the stage would
// merge it.

import Lots, { TRAIT } from "./lots-ext.js";
import { commitOf, contributorsOf, freshNonce, newRound, roundOf, seedOf } from "./lots.js";

function world({ seated, present }) {
  let doc = { objects: { cup: { name: "Cup", traits: { [TRAIT]: {} } } } };
  let audience = () => null;
  const clients = new Map();
  let local = {};
  const flush = () => {
    for (const c of clients.values()) c.ext.update({ objects: doc.objects }, c.local, null);
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  for (const v of present) {
    const c = { local };
    const api = {
      viewer: v,
      scene: () => ({ objects: doc.objects }),
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        queueMicrotask(flush);
      },
      audience: (id) => audience(id, v),
      presence: { get: () => Object.fromEntries(present.map((p) => [`s-${p}`, { viewer: p }])) },
      collect: (name) => (name === "roster" ? [{ id: "seats", value: { viewers: () => seated, who: (x) => x } }] : []),
      local: { swap: (fn) => ((c.local = fn(c.local)), queueMicrotask(flush)) },
      nameOf: () => "Cup",
      write: (fn) => api.change(fn),
    };
    c.api = api;
    c.ext = Lots.create(api);
    clients.set(v, c);
  }
  return {
    clients,
    lots: (v) => clients.get(v).ext.lots,
    round: () => roundOf(doc.objects.cup.traits[TRAIT]),
    raw: () => doc.objects.cup.traits[TRAIT].round,
    write(fn) {
      doc = structuredClone(doc);
      fn(doc);
    },
    hud: (v) => clients.get(v).ext.hud().map((l) => l.text),
    setAudience(fn) {
      audience = fn;
      flush();
    },
    async settle() {
      for (let i = 0; i < 60; i++) {
        flush();
        await new Promise((r) => setTimeout(r, 2));
      }
    },
    dispose: () => clients.forEach((c) => c.ext.dispose()),
  };
}

describe("keep.lots, three players and a spectator", () => {
  it("a roll for Ana alone: she knows it, nobody else does, until it's lifted; then everyone knows the same", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy", "spec"] });
    w.setAudience(() => ["ana"]); // under her cup
    const draw = w.lots("ana").draw("cup", { sealers: ["ana"] });
    await w.settle();
    const r = w.round();
    expect(r.draw).toBe(draw);
    expect(r.members).toEqual(["ana", "ben", "cy"]); // the spectator draws nothing
    expect(contributorsOf(r)).toEqual(["ana", "ben", "cy"]);
    expect(w.lots("ana").state("cup").phase).toBe("known");
    const seed = w.lots("ana").state("cup").seed;
    for (const v of ["ben", "cy", "spec"]) {
      expect(w.lots(v).state("cup").phase).toBe("sealed");
      expect(w.lots(v).state("cup").seed).toBe(null);
    }
    expect(r.opens.ana).toBe(undefined);
    expect(Object.keys(r.sealed)).toEqual([]);
    // lifted
    w.setAudience(() => "all");
    await w.settle();
    for (const v of ["ana", "ben", "cy", "spec"]) {
      expect(w.lots(v).state("cup").phase).toBe("open");
      expect(w.lots(v).state("cup").seed).toBe(seed);
    }
    const done = w.round();
    expect(seed).toBe(seedOf(done.id, Object.entries(done.opens)));
    w.dispose();
  });

  it("a roll shaken blind: every seated part sealed, so nobody knows it while it's covered; lifted, each releases to the others but Ana, so Ben and Cy know it and Ana never does until it's shown to all", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy", "spec"] });
    w.setAudience(() => []); // under her cup, blind: nobody
    w.lots("ana").draw("cup", { sealers: ["ana", "ben", "cy"] });
    await w.settle();
    let r = w.round();
    expect(contributorsOf(r)).toEqual(["ana", "ben", "cy"]);
    expect(r.opens).toEqual({}); // nobody's part in the clear
    expect(r.sealed).toEqual({});
    for (const v of ["ana", "ben", "cy", "spec"]) {
      expect(w.lots(v).state("cup").phase).toBe("sealed");
      expect(w.lots(v).state("cup").seed).toBe(null);
    }
    // lifted: kept from Ana (and the spectator)
    w.setAudience(() => ["ben", "cy"]);
    await w.settle();
    r = w.round();
    expect(Object.keys(r.sealed).sort()).toEqual(["ana", "ben", "cy"]);
    expect(Object.keys(r.sealed.ana).sort()).toEqual(["ben", "cy"]);
    expect(Object.keys(r.sealed.ben)).toEqual(["cy"]);
    expect(Object.keys(r.sealed.cy)).toEqual(["ben"]);
    const seed = w.lots("ben").state("cup").seed;
    expect(seed).toBeTypeOf("string");
    expect(w.lots("cy").state("cup").seed).toBe(seed);
    expect(w.lots("ana").state("cup").seed).toBe(null);
    expect(w.lots("spec").state("cup").seed).toBe(null);
    w.setAudience(() => "all");
    await w.settle();
    for (const v of ["ana", "ben", "cy", "spec"]) expect(w.lots(v).state("cup").seed).toBe(seed);
    expect(seed).toBe(seedOf(w.round().id, Object.entries(w.round().opens)));
    w.dispose();
  });

  it("a reroll: Ana, knowing her roll, writes a new attempt of the same draw; every client that saw the first (the spectator too) refuses it and says so, under its own name, to everyone", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy", "spec"] });
    w.setAudience(() => ["ana"]);
    const draw = w.lots("ana").draw("cup", { sealers: ["ana"] });
    await w.settle();
    const first = w.round();
    expect(w.lots("ana").state("cup").phase).toBe("known");
    // her client is a modified one from here: the same draw, nothing tried, the same members, her commit in it
    w.clients.get("ana").ext.dispose();
    const id = "rAGAINxxxx";
    const nonce = freshNonce();
    w.write((d) => {
      d.objects.cup.traits[TRAIT].round = newRound({ draw, id, by: "ana", at: Date.now() - 10_000, sealers: ["ana"], members: first.members, commit: commitOf(id, "ana", nonce, "") });
    });
    await w.settle();
    const r = w.round();
    expect(r.id).toBe(id);
    // every client that saw it (the spectator too: a witness, not a member) says so under its own name
    expect(r.protests).toEqual({ ben: { of: first.id, why: "complete" }, cy: { of: first.id, why: "complete" }, spec: { of: first.id, why: "complete" } });
    expect(Object.keys(r.commits)).toEqual(["ana"]); // nobody who saw the first took part
    expect(w.hud("spec")).toContain("Ben, cy and you saw ana draw the lots for Cup again after the draw before was made, and took no part.");
    expect(w.hud("ben")).toContain("You, cy and spec saw ana draw the lots for Cup again after the draw before was made, and took no part.");
    w.dispose();
  });

  it("closed by its asker alone, a draw says so to everyone else while it's still covered", async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben", "spec"] });
    w.setAudience(() => ["ana"]);
    const id = "rALONExxxx";
    w.write((d) => {
      d.objects.cup.traits[TRAIT].round = { ...newRound({ draw: "dALONExxxx", id, by: "ana", at: Date.now(), sealers: ["ana"], members: ["ana", "ben"], commit: commitOf(id, "ana", freshNonce(), "") }), closed: ["ana"] };
    });
    await w.settle();
    for (const v of ["ben", "spec"]) expect(w.hud(v)).toContain("The lots for Cup were drawn by ana alone: nobody else took part.");
    expect(w.hud("ana").some((t) => /alone/.test(t))).toBe(false);
    w.dispose();
  });

  it("an unknown audience (a package missing) releases nothing", async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben"] });
    w.setAudience(() => null);
    w.lots("ana").draw("cup", { sealers: ["ana"] });
    await w.settle();
    expect(w.lots("ben").state("cup").phase).toBe("sealed");
    expect(w.round().opens.ana).toBe(undefined);
    w.dispose();
  });
});
