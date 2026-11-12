// The lots extension, three seated clients and a spectator on one doc, with
// the platform's real WebCrypto: a draw for one viewer, a draw sealed by
// everyone (released between them with real envelopes), the release when
// the stage's audience for the object becomes everyone, a reroll that
// honest clients refuse, and a draw open to all, alone and together. The
// audience is given here as the stage would merge it. The round lives in
// the cup's own trait.

import Lots, { ID, holderOf } from "./lots-ext.js";
import { OPEN_MS, commitOf, contributorsOf, couldKnow, freshNonce, newRound, roundOf, seedOf } from "./lots.js";

const CUP = "dice.cup";

function world({ seated, present, running = present }) {
  let doc = { objects: { cup: { name: "Cup", traits: { [CUP]: { holder: null, up: true, blind: false, roll: null, round: null } } }, d1: { name: "d1", traits: { "dice.die": {} } } } };
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
      id: ID,
      viewer: v,
      scene: () => ({ objects: doc.objects }),
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        queueMicrotask(flush);
      },
      audience: (id) => audience(id, v),
      // everyone here, each saying whether their client runs lots (the extension's presence key)
      presence: { get: () => Object.fromEntries(present.filter((p) => p !== v).map((p) => [`s-${p}`, { viewer: p, keys: running.includes(p) ? { [ID]: { here: true } } : {} }])), set() {} },
      collect: (name) => (name === "roster" ? [{ id: "seats", value: { viewers: () => seated, who: (x) => x } }] : []),
      local: { swap: (fn) => ((c.local = fn(c.local)), queueMicrotask(flush)) },
      nameOf: (id) => (id === "cup" ? "Cup" : id),
    };
    c.api = api;
    c.ext = Lots.create(api);
    clients.set(v, c);
  }
  return {
    clients,
    lots: (v) => clients.get(v).ext[ID],
    round: (id = "cup") => roundOf(holderOf(doc.objects[id])),
    raw: (id = "cup") => holderOf(doc.objects[id]).round,
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

describe("dice.lots, three players and a spectator", () => {
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
      d.objects.cup.traits[CUP].round = newRound({ draw, id, by: "ana", at: Date.now() - 10_000, sealers: ["ana"], members: first.members, commit: commitOf(id, "ana", nonce, "") });
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
      d.objects.cup.traits[CUP].round = { ...newRound({ draw: "dALONExxxx", id, by: "ana", at: Date.now(), sealers: ["ana"], members: ["ana", "ben"], commit: commitOf(id, "ana", freshNonce(), "") }), closed: ["ana"] };
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

describe("dice.lots, a draw open to all (a throw in the open)", () => {
  it("alone: one member, drawn at once, with no deadline: the seed is the hash of the one opening", async () => {
    const w = world({ seated: null, present: ["ana"] });
    const draw = w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    // asked and opened before any time has passed
    await w.settle();
    const r = w.round("d1");
    expect(r.draw).toBe(draw);
    expect(r.members).toEqual(["ana"]);
    expect(r.of).toEqual(["d1"]);
    expect(r.keys).toEqual({}); // nothing will be sealed: no key
    const st = w.lots("ana").state("d1");
    expect(st.phase).toBe("open");
    expect(st.public).toBe(true);
    expect(st.seed).toBe(seedOf(r.id, Object.entries(r.opens)));
    expect(w.hud("ana")).toEqual([]);
    w.dispose();
  });

  it("together: everyone here who runs lots commits, then all open; the seed is everyone's and the hash of every opening", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy"] });
    w.setAudience(() => null); // no policy says anything of a die in the open: nothing is sealed, so nothing waits on it
    w.lots("ben").draw("d1", { sealers: [], of: ["d1"] });
    await w.settle();
    const r = w.round("d1");
    expect(contributorsOf(r)).toEqual(["ana", "ben", "cy"]);
    expect(Object.keys(r.opens).sort()).toEqual(["ana", "ben", "cy"]);
    const seed = seedOf(r.id, Object.entries(r.opens));
    for (const v of ["ana", "ben", "cy"]) expect(w.lots(v).state("d1")).toMatchObject({ phase: "open", public: true, seed, by: "ben", of: ["d1"] });
    w.dispose();
  });

  it("someone here whose client doesn't run lots isn't waited for", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy"], running: ["ana", "ben"] });
    w.clients.get("cy").ext.dispose();
    w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    await w.settle();
    expect(w.round("d1").members).toEqual(["ana", "ben"]);
    expect(w.lots("ana").state("d1").phase).toBe("open");
    w.dispose();
  });

  it("the asker opens first: the others' openings wait on its own", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy"] });
    // ana's client is a modified one that commits and never opens
    w.clients.get("ana").ext.dispose();
    const id = "rFIRSTxx";
    w.write((d) => (d.objects.d1.traits["dice.die"].round = newRound({ draw: "dFIRSTxx", id, by: "ana", at: Date.now(), of: ["d1"], sealers: [], members: ["ana", "ben", "cy"], commit: commitOf(id, "ana", freshNonce(), "", ["d1"]) })));
    await w.settle();
    const r = w.round("d1");
    expect(Object.keys(r.commits).sort()).toEqual(["ana", "ben", "cy"]);
    expect(r.opens).toEqual({}); // nobody opened before her: she learns nothing
    expect(w.lots("ben").state("d1").waiting).toEqual(["ana"]);
    w.dispose();
  });

  it("a forgery: Cy writes a new attempt of Ana's throw in Ana's name, her commit made from the nonce she opened, his own nonce ground to the face he wants; Ana's client refuses it as forged, and says so to everyone", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose(); // cy: a modified client, driven by hand
    const draw = w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    const r1 = w.round("d1");
    const nc = freshNonce();
    w.write((d) => void (d.objects.d1.traits["dice.die"].round.commits.cy = commitOf(r1.id, "cy", nc, "", ["d1"])));
    await w.settle();
    const opened = w.round("d1");
    // ana opened first, then ben; cy now knows the seed, and doesn't open
    expect(Object.keys(opened.opens).sort()).toEqual(["ana", "ben"]);
    expect(couldKnow(opened)).toEqual(["cy"]);
    // a new attempt of the same draw "by ana", reusing ana's and ben's openings; cy's own nonce is whatever he likes
    const id = "rFORGExx";
    const n = freshNonce();
    const r2 = newRound({ draw, id, by: "ana", at: Date.now(), of: ["d1"], sealers: [], members: ["ana", "ben", "cy"], commit: commitOf(id, "ana", opened.opens.ana, "", ["d1"]) });
    r2.commits.ben = commitOf(id, "ben", opened.opens.ben, "", ["d1"]);
    r2.commits.cy = commitOf(id, "cy", n, "", ["d1"]);
    r2.opens = { ana: opened.opens.ana, ben: opened.opens.ben, cy: n };
    w.write((d) => void (d.objects.d1.traits["dice.die"].round = r2));
    await w.settle();
    const r = w.round("d1");
    expect(r.id).toBe(id);
    // the seed is as cy ground it, and in the doc it looks whole; but ana and ben each say the part in their name isn't theirs
    expect(r.protests).toEqual({ ana: { of: id, why: "forged" }, ben: { of: id, why: "forged" } });
    for (const v of ["ana", "ben"]) {
      const st = w.lots(v).state("d1");
      expect(st).toMatchObject({ draw, public: true, own: false, forged: ["ana", "ben"] });
    }
    expect(w.hud("ana")).toContain("Someone wrote the lots for d1 in your name: your client refused them, and nothing lands by them.");
    expect(w.hud("ana")).toContain("Ben says the lots for d1 were written in their name by someone else: nothing lands by them.");
    w.dispose();
  });

  it("a forgery the other way: Cy asks, and writes a commit and an opening in Ana's name beside his own (choosing every part); Ana's client refuses it", async () => {
    const w = world({ seated: ["ana", "cy"], present: ["ana", "cy"] });
    w.clients.get("cy").ext.dispose();
    await w.settle(); // ana's client is here before it
    const id = "rCYxxxxx";
    const n = { ana: freshNonce(), cy: freshNonce() };
    const r = newRound({ draw: "dCYxxxxx", id, by: "cy", at: Date.now(), of: ["d1"], sealers: [], members: ["ana", "cy"], commit: commitOf(id, "cy", n.cy, "", ["d1"]) });
    r.commits.ana = commitOf(id, "ana", n.ana, "", ["d1"]);
    r.opens = { ...n };
    w.write((d) => void (d.objects.d1.traits["dice.die"].round = r));
    await w.settle();
    expect(w.round("d1").protests).toEqual({ ana: { of: id, why: "forged" } });
    expect(w.lots("ana").state("d1").forged).toEqual(["ana"]);
    w.dispose();
  });

  it("what was on the doc when a client came is past: a round there with its viewer's part in it isn't called forged", async () => {
    const w = world({ seated: null, present: ["ana", "ben"] });
    w.clients.get("ben").ext.dispose();
    w.clients.get("ana").ext.dispose();
    const id = "rOLDxxxx";
    const n = { ana: freshNonce(), ben: freshNonce() };
    const r = newRound({ draw: "dOLDxxxx", id, by: "ana", at: 0, of: ["d1"], sealers: [], members: ["ana", "ben"], commit: commitOf(id, "ana", n.ana, "", ["d1"]) });
    r.commits.ben = commitOf(id, "ben", n.ben, "", ["d1"]);
    r.opens = { ...n };
    w.write((d) => void (d.objects.d1.traits["dice.die"].round = r));
    // ana and ben come back (a reload: their clients made it, and remember nothing of it)
    const again = world({ seated: null, present: ["ana", "ben"] });
    again.write((d) => void (d.objects.d1.traits["dice.die"].round = structuredClone(r)));
    await again.settle();
    expect(again.round("d1").protests).toEqual({});
    for (const v of ["ana", "ben"]) expect(again.lots(v).state("d1")).toMatchObject({ phase: "open", forged: [] });
    again.dispose();
  });

  it("a veto by a new draw: Cy, the last to open Ana's throw, knows its seed, doesn't open, and throws the die himself; every client that saw it refuses his draw, and says so", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose();
    w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    const r1 = w.round("d1");
    w.write((d) => void (d.objects.d1.traits["dice.die"].round.commits.cy = commitOf(r1.id, "cy", freshNonce(), "", ["d1"])));
    await w.settle();
    expect(couldKnow(w.round("d1"))).toEqual(["cy"]);
    const id = "rVETOxxx";
    w.write((d) => void (d.objects.d1.traits["dice.die"].round = newRound({ draw: "dVETOxxx", id, by: "cy", at: Date.now(), of: ["d1"], sealers: [], members: ["ana", "ben", "cy"], commit: commitOf(id, "cy", freshNonce(), "", ["d1"]) })));
    await w.settle();
    expect(w.round("d1").protests).toEqual({ ana: { of: r1.id, why: "withheld" }, ben: { of: r1.id, why: "withheld" } });
    expect(Object.keys(w.round("d1").commits)).toEqual(["cy"]); // nobody took part
    w.dispose();
  });

  it("a veto by not opening: Cy, the last to open, knows its seed and doesn't open; the asker's deadline draws again without him, and the round says who was left out", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose();
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const draw = w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    const id = w.round("d1").id;
    w.write((d) => void (d.objects.d1.traits["dice.die"].round.commits.cy = commitOf(id, "cy", freshNonce(), "", ["d1"])));
    await w.settle();
    now += OPEN_MS + 100;
    await w.settle();
    await new Promise((r) => setTimeout(r, 300));
    await w.settle();
    const r2 = w.round("d1");
    expect(r2).toMatchObject({ draw, members: ["ana", "ben"], excluded: ["cy"], protests: {} });
    expect(w.lots("ben").state("d1")).toMatchObject({ phase: "open", excluded: ["cy"], contributors: ["ana", "ben"] });
    spy.mockRestore();
    w.dispose();
  });

  it("what it's for is bound into every commit: `of` changed once anyone has committed spoils it for everyone", async () => {
    const w = world({ seated: null, present: ["ana", "ben"] });
    w.clients.get("ana").ext.dispose();
    w.clients.get("ben").ext.dispose();
    const id = "rOFxxxxx";
    const n = { ana: freshNonce(), ben: freshNonce() };
    const round = newRound({ draw: "dOFxxxxx", id, by: "ana", at: 0, of: ["d1", "d2"], sealers: [], members: ["ana", "ben"], commit: commitOf(id, "ana", n.ana, "", ["d1", "d2"]) });
    round.commits.ben = commitOf(id, "ben", n.ben, "", ["d1", "d2"]);
    round.opens = { ana: n.ana, ben: n.ben };
    w.write((d) => (d.objects.d1.traits["dice.die"].round = round));
    const seed = seedOf(id, Object.entries(n));
    for (const v of ["ana", "ben"]) expect(w.lots(v).state("d1")).toMatchObject({ phase: "open", seed });
    // the dice swapped after the openings (to give each the other's face): no seed for anyone
    w.write((d) => (d.objects.d1.traits["dice.die"].round.of = ["d2", "d1"]));
    for (const v of ["ana", "ben"]) expect(w.lots(v).state("d1")).toMatchObject({ phase: "spoiled", seed: null });
    expect(w.hud("ana")[0]).toMatch(/^The lots for d1 are spoiled: /);
  });
});
