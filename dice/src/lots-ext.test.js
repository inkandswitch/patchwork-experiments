// The lots extension, three seated clients and a spectator on one doc, with
// the platform's real WebCrypto: a draw for one viewer, a draw sealed by
// everyone (released between them with real envelopes), the release when
// the stage's audience for the object becomes everyone, a reroll that
// honest clients refuse, and a draw open to all, alone and together. The
// audience is given here as the stage would merge it. The round lives in
// the cup's own trait.

import Lots, { ID, holderOf } from "./lots-ext.js";
import { STALE_MS, OPEN_MS, commitOf, contributorsOf, couldKnow, freshNonce, knewOf, newRound, roundOf, seedOf } from "./lots.js";
import { cupOf, redrawFor } from "./cup.js";

const CUP = "dice.cup";

function world({ seated, present: arrived, running = arrived }) {
  const present = [...arrived];
  let doc = { objects: { cup: { name: "Cup", traits: { [CUP]: { holder: null, up: true, blind: false, roll: null, round: null } } }, d1: { name: "d1", traits: { "dice.die": {} } } } };
  let audience = () => null;
  const clients = new Map();
  let local = {};
  const flush = () => {
    for (const c of clients.values()) c.ext.update({ objects: doc.objects }, c.local, null);
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const join = (v) => {
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
      // the stage's time (scene/src/stage/time.js): the event loop's wall, here
      clock: {
        now: () => Date.now(),
        after(ms, fn) {
          const h = setTimeout(fn, ms);
          return () => clearTimeout(h);
        },
      },
    };
    c.api = api;
    c.ext = Lots.create(api);
    clients.set(v, c);
  };
  for (const v of present) join(v);
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
    /** `v`'s client starts again (a reload): what it kept in memory is gone, what it kept in storage isn't. */
    rejoin(v) {
      clients.get(v).ext.dispose();
      join(v);
    },
    /** `v` goes: its client stops, and it's no longer in anyone's presence. */
    leave(v) {
      clients.get(v)?.ext.dispose();
      clients.delete(v);
      present.splice(present.indexOf(v), 1);
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

describe("dice.lots, a round whose asker can't move it on", () => {
  // time by hand: what each client first saw, and when the deadlines fall
  let now;
  let spy;
  beforeEach(() => {
    now = 1_000_000;
    spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => spy.mockRestore());
  const later = async (w, ms) => {
    now += ms;
    await w.settle();
    await new Promise((r) => setTimeout(r, 1100)); // the runner's own timer (a second, watching someone else's round)
    await w.settle();
  };

  it("the asker leaves before opening: everyone waits on her until STALE_MS has passed with her gone, then the first client to see it gives it up in the doc, and every client says it's ended", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy", "spec"] });
    w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    w.leave("ana"); // her round is written, with her commit; her client goes before it can open
    await w.settle();
    expect(Object.keys(w.round("d1").commits).sort()).toEqual(["ana", "ben", "cy", "spec"]);
    await later(w, 2000);
    for (const v of ["ben", "cy", "spec"]) {
      expect(w.lots(v).state("d1")).toMatchObject({ phase: "opening", waiting: ["ana"] });
      expect(w.hud(v)).toContain("Drawing lots for d1: waiting for ana.");
    }
    // not before both deadlines have passed since each client first saw it
    await later(w, STALE_MS - 2000 - 1);
    expect(w.round("d1").gone).toEqual({});
    await later(w, 1);
    const gone = Object.keys(w.round("d1").gone);
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((v) => ["ben", "cy", "spec"].includes(v))).toBe(true);
    for (const v of ["ben", "cy", "spec"]) {
      expect(w.lots(v).state("d1")).toMatchObject({ phase: "ended", waiting: [], seed: null });
      expect(w.hud(v)).toEqual([]);
    }
    // and it stays ended: nothing more is written
    const after = JSON.stringify(w.raw("d1"));
    await later(w, STALE_MS);
    expect(JSON.stringify(w.raw("d1"))).toBe(after);
    w.dispose();
  }, 15_000);

  it("the asker leaves before the commits are in (one member never commits): her deadline never comes, and the round is ended the same way", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose(); // cy's client is here and never commits
    w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    w.leave("ana");
    await w.settle();
    await later(w, STALE_MS - 1);
    expect(w.lots("ben").state("d1")).toMatchObject({ phase: "committing", waiting: ["cy"] });
    await later(w, 1);
    expect(w.round("d1").gone).toEqual({ ben: true });
    expect(w.lots("ben").state("d1").phase).toBe("ended");
    w.dispose();
  }, 15_000);

  it("an asker who is here is never given up on, however long its round takes: it moves it on itself", async () => {
    const w = world({ seated: null, present: ["ana", "ben", "cy"] });
    w.clients.get("ana").ext.dispose(); // ana is here, her client a modified one that never opens
    const id = "rSTUCKxx";
    w.write((d) => (d.objects.d1.traits["dice.die"].round = newRound({ draw: "dSTUCKxx", id, by: "ana", at: now, of: ["d1"], sealers: [], members: ["ana", "ben", "cy"], commit: commitOf(id, "ana", freshNonce(), "", ["d1"]) })));
    await w.settle();
    await later(w, STALE_MS * 3);
    expect(w.round("d1").gone).toEqual({});
    expect(w.lots("ben").state("d1")).toMatchObject({ phase: "opening", waiting: ["ana"] });
    w.dispose();
  }, 15_000);

  it("the asker's own client, back without its part (another browser's, or storage cleared), gives up its own round at once", async () => {
    const r = newRound({ draw: "dLOSTxxx", id: "rLOSTxxx", by: "ana", at: 0, of: ["d1"], sealers: [], members: ["ana", "ben"], commit: commitOf("rLOSTxxx", "ana", freshNonce(), "", ["d1"]) });
    r.commits.ben = commitOf("rLOSTxxx", "ben", freshNonce(), "", ["d1"]);
    const w = world({ seated: null, present: ["ana", "ben"] });
    w.write((d) => (d.objects.d1.traits["dice.die"].round = r));
    await w.settle();
    expect(w.round("d1").gone).toEqual({ ana: true });
    for (const v of ["ana", "ben"]) expect(w.lots(v).state("d1").phase).toBe("ended");
    // her own `gone`, which her client wrote: no forgery
    expect(w.round("d1").protests).toEqual({});
    expect(w.lots("ana").state("d1").fault).toBe(null);
    w.dispose();
  }, 15_000);

  it("the last to open, knowing the face, writes `gone` in its own name: nothing is ended; everyone waits on it, by name, and the asker draws again without it at its deadline, as if it had only stalled", async () => {
    const id = "rVETOxxx";
    const n = { ana: freshNonce(), ben: freshNonce(), cy: freshNonce() };
    const w = world({ seated: null, present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose(); // cy is here, its client a modified one
    // ana's and ben's clients made their parts (kept in storage, as a client keeps them)
    for (const v of ["ana", "ben"]) localStorage.setItem(`dice.lots:${v}:${id}`, JSON.stringify({ nonce: n[v], pub: "" }));
    const r = newRound({ draw: "dVETOxxx", id, by: "ana", at: now, of: ["d1"], sealers: [], members: ["ana", "ben", "cy"], commit: commitOf(id, "ana", n.ana, "", ["d1"]) });
    for (const v of ["ben", "cy"]) r.commits[v] = commitOf(id, v, n[v], "", ["d1"]);
    r.opens = { ana: n.ana, ben: n.ben };
    // cy could work the seed out now: it gives the round up instead of opening
    r.gone = { cy: true };
    w.write((d) => (d.objects.d1.traits["dice.die"].round = r));
    await w.settle();
    expect(couldKnow(w.round("d1"))).toEqual(["cy"]);
    for (const v of ["ana", "ben"]) {
      expect(w.lots(v).state("d1")).toMatchObject({ phase: "opening", waiting: ["cy"], gone: ["cy"], fault: null });
      expect(w.hud(v)).toEqual([]);
    }
    await later(w, OPEN_MS - 1);
    expect(w.round("d1").id).toBe(id);
    expect(w.hud("ben")).toContain("Drawing lots for d1: waiting for cy.");
    await later(w, 1);
    // drawn again without cy, who is named for it
    const again = w.round("d1");
    expect(again).toMatchObject({ draw: "dVETOxxx", members: ["ana", "ben"], excluded: ["cy"], tries: 1 });
    expect(again.id).not.toBe(id);
    w.dispose();
  }, 15_000);

  it("a `gone` in my name my client didn't write is a forgery: my client refuses the round and says so, and everyone's HUD says who says so", async () => {
    const w = world({ seated: ["ana", "ben", "cy"], present: ["ana", "ben", "cy"] });
    w.clients.get("cy").ext.dispose(); // cy's client is here and never commits: the round stays committing
    w.lots("ana").draw("d1", { sealers: [], of: ["d1"] });
    await w.settle();
    expect(w.lots("ben").state("d1").phase).toBe("committing");
    // someone gives it up in ben's name
    w.write((d) => (d.objects.d1.traits["dice.die"].round.gone.ben = true));
    await w.settle();
    expect(w.round("d1").protests).toEqual({ ben: { of: w.round("d1").id, why: "forged" } });
    for (const v of ["ana", "ben"]) expect(w.lots(v).state("d1")).toMatchObject({ phase: "ended", forged: ["ben"] });
    expect(w.lots("ben").state("d1").fault).toEqual({ of: w.round("d1").id, why: "forged" });
    expect(w.hud("ben")).toContain("Someone wrote the lots for d1 in your name: your client refused them, and nothing lands by them.");
    expect(w.hud("ana")).toContain("Ben says the lots for d1 were written in their name by someone else: nothing lands by them.");
    w.dispose();
  }, 15_000);

  it("a cup lifted while its holder is away waits for her by design: never ended", async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben"] });
    w.setAudience(() => ["ana"]);
    w.lots("ana").draw("cup", { sealers: ["ana"] });
    await w.settle();
    expect(w.lots("ben").state("cup").phase).toBe("sealed");
    w.leave("ana");
    w.setAudience(() => "all");
    await later(w, STALE_MS * 2);
    expect(w.round().gone).toEqual({});
    expect(w.lots("ben").state("cup")).toMatchObject({ phase: "sealed", waiting: ["ana"] });
    w.dispose();
  }, 15_000);
});

describe("dice.lots, who could know a cup's roll, as its holder's client tells it: never less than whom it sealed its own part to", () => {
  // Ana shook blind, Ben the other one seated; the cup is up, so Ana's client sealed her part to Ben (and Ben's to
  // nobody: the holder never sees a blind roll). Ben could know the roll. A modified client of Ben's then takes his
  // envelope out of the doc in the same change as getting Ana's client to say the roll is forged, which, read from the
  // doc alone, would have Ana's client draw the cup again for him (sealed to him again) as often as he liked.
  const lifted = async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben"] });
    w.setAudience(() => []); // down, blind: nobody
    const draw = w.lots("ana").draw("cup", { sealers: ["ana", "ben"], of: ["d1"] });
    await w.settle();
    w.setAudience(() => ["ben"]); // lifted: the seated others
    await w.settle();
    expect(Object.keys(w.round().sealed.ana)).toEqual(["ben"]);
    expect(w.lots("ana").state("cup").knew).toEqual(["ben"]);
    const cup = cupOf({ traits: { [CUP]: { holder: "ana", up: true, blind: true, roll: { draw, dice: ["d1"], blind: true, done: false } } } });
    return { w, draw, cup };
  };
  const unsealed = (d) => delete d.objects.cup.traits[CUP].round.sealed.ana.ben;

  it("Ben deletes `sealed.ana.ben` and overwrites Ana's commit: her client says forged, still counts Ben as able to know, and nothing is drawn again", async () => {
    const { w, cup } = await lifted();
    w.write((d) => {
      unsealed(d);
      d.objects.cup.traits[CUP].round.commits.ana = "0".repeat(64);
    });
    const st = w.lots("ana").state("cup");
    expect(st.fault?.why).toBe("forged");
    expect(knewOf(w.round())).toEqual([]); // the doc's word, emptied
    expect(st.knew).toEqual(["ben"]);
    expect(redrawFor(st, cup, "ana")).toEqual([]);
    await w.settle();
    expect(redrawFor(w.lots("ana").state("cup"), cup, "ana")).toEqual([]);
    w.dispose();
  });

  it("Ben deletes `sealed.ana.ben` and says the roll is forged himself: his word only stops it", async () => {
    const { w, cup } = await lifted();
    w.write((d) => {
      unsealed(d);
      d.objects.cup.traits[CUP].round.protests.ben = { of: d.objects.cup.traits[CUP].round.id, why: "forged" };
    });
    const st = w.lots("ana").state("cup");
    expect(st.forged).toEqual(["ben"]);
    expect(knewOf(w.round())).toEqual([]);
    expect(st.knew).toEqual(["ben"]);
    expect(redrawFor(st, cup, "ana")).toEqual([]);
    w.dispose();
  });

  it("Ben writes a whole new attempt of Ana's draw in her name, nothing sealed in it: her client refuses it as forged, and still counts Ben (whom it sealed her part of that draw to)", async () => {
    const { w, draw, cup } = await lifted();
    const id = "rFAKExxx";
    const r = newRound({ draw, id, by: "ana", at: Date.now(), of: ["d1"], sealers: ["ana", "ben"], members: ["ana", "ben"], commit: commitOf(id, "ana", freshNonce(), "", ["d1"]) });
    r.commits.ben = commitOf(id, "ben", freshNonce(), "", ["d1"]);
    w.write((d) => void (d.objects.cup.traits[CUP].round = r));
    const st = w.lots("ana").state("cup");
    expect(st.fault?.why).toBe("forged");
    expect(knewOf(w.round())).toEqual([]);
    expect(st.knew).toEqual(["ben"]);
    expect(redrawFor(st, cup, "ana")).toEqual([]);
    w.dispose();
  });

  it("Ben strips Ana from the sealers so her client opens her part in the clear, puts them back, deletes her opening and says forged: her client knows it opened, so nothing is drawn again", async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben"] });
    w.setAudience(() => []); // down, blind: nobody
    const draw = w.lots("ana").draw("cup", { sealers: ["ana", "ben"], of: ["d1"] });
    await w.settle();
    const cup = cupOf({ traits: { [CUP]: { holder: "ana", up: false, blind: true, roll: { draw, dice: ["d1"], blind: true, done: false } } } });
    w.write((d) => void (d.objects.cup.traits[CUP].round.sealers = ["ben"])); // Ana is now an opener, not a sealer
    await w.settle();
    expect(w.round().opens.ana).toBeTruthy(); // her client opened her part in the clear
    w.write((d) => {
      const round = d.objects.cup.traits[CUP].round;
      round.sealers = ["ana", "ben"];
      delete round.opens.ana;
      round.protests.ben = { of: round.id, why: "forged" };
    });
    const st = w.lots("ana").state("cup");
    expect(st.knew).toBe("all");
    expect(redrawFor(st, cup, "ana")).toEqual([]);
    w.dispose();
  });

  it("after a reload, Ana's client can't say whom her part went to: anyone could know it, so nothing is ever drawn again", async () => {
    const { w, cup } = await lifted();
    w.rejoin("ana");
    await w.settle();
    expect(w.lots("ana").state("cup").knew).toBe("all");
    w.write((d) => {
      unsealed(d);
      d.objects.cup.traits[CUP].round.commits.ana = "0".repeat(64);
    });
    const st = w.lots("ana").state("cup");
    expect(st.fault?.why).toBe("forged");
    expect(st.knew).toBe("all");
    expect(redrawFor(st, cup, "ana")).toEqual([]);
    w.dispose();
  });

  it("while the cup is still down Ana's client sealed her part to nobody: Ben's word draws it again (he knows no more of the next roll than of this one)", async () => {
    const w = world({ seated: ["ana", "ben"], present: ["ana", "ben"] });
    w.setAudience(() => []);
    const draw = w.lots("ana").draw("cup", { sealers: ["ana", "ben"], of: ["d1"] });
    await w.settle();
    const cup = cupOf({ traits: { [CUP]: { holder: "ana", up: false, blind: true, roll: { draw, dice: ["d1"], blind: true, done: false } } } });
    w.write((d) => void (d.objects.cup.traits[CUP].round.protests.ben = { of: d.objects.cup.traits[CUP].round.id, why: "forged" }));
    const st = w.lots("ana").state("cup");
    expect(st.knew).toEqual([]);
    expect(redrawFor(st, cup, "ana")).toEqual(["ben"]);
    w.dispose();
  });
});
