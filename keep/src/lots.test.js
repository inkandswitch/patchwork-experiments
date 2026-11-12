// Lots, over every case of a small table: who takes part, whose parts stay
// sealed, who is away from the start and who commits and then never opens,
// and what the stage's audience says as the object is covered, lifted and
// shown to all. A model client per viewer follows the protocol (lots.js)
// against one round, as honest clients do (lots-ext.js); time moves only
// when nobody has anything to do. Envelopes here are a stand-in a client
// opens only when it's addressed to it (seal.test.js checks the real ones).

import { createHash } from "node:crypto";
import { COMMIT_MS, OPEN_MS, commitOf, complete, contributorsOf, derive, due, faultOf, knewOf, membersFor, newRound, roundOf, seed32, seedOf } from "./lots.js";
import { sha256 } from "./sha256.js";

const nonceOf = (v, id) => sha256(`nonce|${v}|${id}`);
const keyOf = (v, id) => sha256(`key|${v}|${id}`).slice(0, 44);
const envelope = (to, n) => ({ iv: "AAAAAAAAAAAAAAAA", ct: btoa(`${to}:${n}`) });
const openEnvelope = (env, me) => {
  const [to, n] = atob(env.ct).split(":");
  return to === me ? n : null;
};

/**
 * Run one draw to rest, through each of `phases`: what the stage would say
 * for the object at each ("all", or a list of viewers), in turn.
 */
function run({ members, sealers, by = "a", absent = [], stallers = [], withholds = [], phases }) {
  const live = members.filter((v) => !absent.includes(v));
  const learned = new Map(); // `${v}|${round}` → { [sealer]: nonce }
  const seen = new Map(); // v → { last: round as v last saw it, before: Map<round id, round>, faults: Map<round id, fault>, opened: Set<round id> }
  for (const v of live) seen.set(v, { last: null, before: new Map(), faults: new Map(), opened: new Set() });
  let trait = {};
  let now = 0;
  const since = new Map();
  let attempts = 0;
  const start = (draw, ms, ex, tries) => {
    attempts++;
    const id = `r${attempts}xx`;
    trait = { round: newRound({ draw, id, by, at: now, sealers, members: ms, commit: commitOf(id, by, nonceOf(by, id), keyOf(by, id)), key: keyOf(by, id), tries, excluded: ex }) };
  };
  const held = (r, v) => {
    const mineCommitted = r.commits[v] && r.commits[v] === commitOf(r.id, v, nonceOf(v, r.id), keyOf(v, r.id));
    return { mine: mineCommitted ? { nonce: nonceOf(v, r.id), key: keyOf(v, r.id) } : null, learned: learned.get(`${v}|${r.id}`) ?? null, fault: seen.get(v).faults.get(r.id) ?? null };
  };
  const witness = (r, v) => {
    const w = seen.get(v);
    if (!w.before.has(r.id)) {
      const prev = w.last && w.last.id !== r.id && w.last.draw === r.draw ? w.last : null;
      w.before.set(r.id, prev);
      const f = faultOf(prev, r, v, { opened: !!prev && w.opened.has(prev.id) });
      if (f) w.faults.set(r.id, f);
    }
    w.last = r;
  };
  // everyone was here when it was asked; the away go before they answer
  start("dxxxx", membersFor({ by, seated: members, present: members }), [], 0);
  const step = (audience) => {
    let changed = false;
    for (const v of live) {
      const r = roundOf(trait);
      witness(r, v);
      const d = derive(r, v, held(r, v));
      const raw = trait.round;
      if (d.fault && !raw.protests[v]) {
        raw.protests[v] = { ...d.fault };
        changed = true;
      }
      if (d.mustCommit) {
        raw.commits[v] = commitOf(r.id, v, nonceOf(v, r.id), keyOf(v, r.id));
        raw.keys[v] = keyOf(v, r.id);
        changed = true;
        continue;
      }
      if (d.mustOpen && !stallers.includes(v)) {
        raw.opens[v] = nonceOf(v, r.id);
        seen.get(v).opened.add(r.id);
        changed = true;
      }
      if (d.contributors && !since.has(r.id)) since.set(r.id, now);
      if (v === by) {
        const s = due(r, v, now, { openingSince: since.get(r.id) ?? null });
        if (s?.close && !raw.closed) {
          raw.closed = s.close;
          changed = true;
        } else if (s?.retry) {
          start(r.draw, s.retry.members, s.retry.excluded, r.tries + 1);
          changed = true;
          continue;
        }
      }
      if (d.phase === "sealed") {
        for (const s of d.waiting) {
          const key = `${v}|${r.id}`;
          if (raw.sealed[s]?.[v] && !learned.get(key)?.[s]) {
            const n = openEnvelope(raw.sealed[s][v], v);
            if (n) {
              learned.set(key, { ...(learned.get(key) ?? {}), [s]: n });
              changed = true;
            }
          }
        }
      }
      if (!withholds.includes(v)) {
        for (const s of d.holding) {
          const n = s === v ? nonceOf(v, r.id) : learned.get(`${v}|${r.id}`)[s];
          if (audience === "all" && !raw.opens[s]) {
            raw.opens[s] = n;
            changed = true;
          } else if (Array.isArray(audience) && s === v) {
            for (const t of audience) {
              if (t === v || !raw.keys[t] || raw.sealed[v]?.[t]) continue;
              if (!raw.sealed[v]) raw.sealed[v] = {};
              raw.sealed[v][t] = envelope(t, n);
              changed = true;
            }
          }
        }
      }
    }
    return changed;
  };
  const trace = [];
  for (const audience of phases) {
    for (let i = 0; i < 500; i++) {
      if (step(audience)) continue;
      // nobody has anything to do: time passes
      now += 500;
      if (now > 60_000) break;
    }
    trace.push(Object.fromEntries(live.map((v) => [v, derive(roundOf(trait), v, held(roundOf(trait), v))])));
  }
  return { trace, round: roundOf(trait), attempts, live };
}

const subsets = (list) => list.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

/**
 * The kinds of draw, as a cup asks for them, and what the stage says for
 * it covered, then lifted (before it's shown to everyone):
 *   open      nobody's part sealed                        (a roll in the open)
 *   mine      a's alone; covered: a may see               (a roll under a's cup)
 *   one other b's alone; covered: b may see
 *   blind     everyone's sealed; covered: nobody; lifted: everyone but a   (a's cup, shaken blind)
 */
function kinds(members) {
  const others = members.filter((v) => v !== "a");
  const out = [
    { kind: "open", sealers: [], down: [], up: "all" },
    { kind: "mine", sealers: ["a"], down: ["a"], up: "all" },
  ];
  if (others.length) out.push({ kind: "blind", sealers: [...members], down: [], up: others });
  if (others.length > 1) out.push({ kind: "one other", sealers: ["b"], down: ["b"], up: "all" });
  return out;
}

const CASES = [];
for (const members of [["a"], ["a", "b"], ["a", "b", "c"]]) {
  const others = members.filter((v) => v !== "a");
  for (const k of kinds(members)) {
    for (const absent of subsets(others)) {
      const here = others.filter((v) => !absent.includes(v));
      // stallers commit and never open; a staller is never a sealer (those that hold back are `withholds`, below)
      const candidates = here.filter((v) => !k.sealers.includes(v));
      for (const stallers of subsets(candidates)) CASES.push({ members, ...k, absent, stallers });
    }
  }
}

describe("lots: every small table", () => {
  it("has the cases it means to (3 sizes × kinds of draw × away × stallers)", () => {
    expect(CASES.length).toBe(38);
  });

  for (const c of CASES) {
    const name = `${c.members.join("")}, ${c.kind}${c.absent.length ? `, ${c.absent.join("")} away` : ""}${c.stallers.length ? `, ${c.stallers.join("")} never opens` : ""}`;
    it(name, () => {
      const { trace, round, attempts, live } = run({ ...c, phases: [c.down, c.up, "all"] });
      const [down, up, after] = trace;
      const honest = live.filter((v) => !c.stallers.includes(v));
      const sealers = c.sealers.filter((v) => honest.includes(v));

      // nobody whose part was to be sealed took part: the round says so, and nobody knows anything
      if (c.sealers.length && !sealers.length) {
        for (const v of live) {
          expect(after[v].phase).toBe("spoiled");
          expect(after[v].seed).toBe(null);
        }
        return;
      }

      // it ends, with the honest clients who are here as its contributors: the away were closed out, the stallers retried out
      expect(contributorsOf(round)).toEqual([...honest].sort());
      expect(attempts).toBe(c.stallers.length ? 2 : 1);
      if (c.stallers.length) expect(round.excluded).toEqual([...c.stallers].sort());
      // an honest retry is never protested: the attempt it replaced wasn't complete, and it left out only who hadn't opened
      expect(round.protests).toEqual({});

      // the seed is the hash of every contributor's opening, and only that
      const want = seedOf(round.id, honest.map((v) => [v, nonceOf(v, round.id)]));
      for (const v of live) {
        expect(after[v].phase).toBe("open");
        expect(after[v].seed).toBe(want);
        expect(after[v].public).toBe(true);
      }
      // every opening in the clear matches its commit
      for (const v of Object.keys(round.opens)) expect(commitOf(round.id, v, round.opens[v], round.keys[v])).toBe(round.commits[v]);

      // who knew it, at each step: everyone, for a draw with nothing sealed; else whoever holds every sealer's part,
      // that is each sealer that holds every other sealer's part, released to it by the audience (a list) of the time
      const knows = (audience, v) => {
        if (!sealers.length || audience === "all") return true;
        if (!contributorsOf(round).includes(v)) return false;
        return sealers.every((s) => s === v || audience.includes(v));
      };
      for (const [audience, state] of [[c.down, down], [c.up, up]]) {
        for (const v of live) {
          const should = knows(audience, v);
          expect(state[v].seed === want, `${v} knew it, under ${JSON.stringify(audience)}`).toBe(should);
          if (!should) expect(state[v].seed).toBe(null);
        }
      }
      // shaken blind: a never knows it until it's shown to all, and while it's covered nobody does; unless nobody
      // else took part, when it is a's own draw like any other (which is why a cup won't shake blind with nobody else here)
      if (c.kind === "blind" && honest.length > 1) {
        expect(down.a.seed).toBe(null);
        expect(up.a.seed).toBe(null);
        for (const v of live) expect(down[v].seed).toBe(null);
      }
    });
  }
});

describe("lots: a reroll", () => {
  // a's client knows a draw for its eyes alone as soon as the others have opened. A modified a writes a new attempt
  // of the same draw (any members, any sealers) to get another. Every order the honest clients' openings land in,
  // every view each had when the new attempt reached it (its own opening and those before it, or every opening),
  // and every new member list.
  const cases = [];
  for (const members of [["a", "b"], ["a", "b", "c"]]) {
    const openers = members.filter((v) => v !== "a");
    const orders = openers.length === 1 ? [openers] : [openers, [...openers].reverse()];
    for (const order of orders) {
      for (const sawAll of subsets(openers)) {
        for (const next of subsets(openers)) cases.push({ members, order, sawAll, next: ["a", ...next] });
      }
    }
  }
  it("has the cases it means to", () => expect(cases.length).toBe(2 * 2 + 2 * 4 * 4));

  for (const { members, order, sawAll, next } of cases) {
    it(`${members.join("")}, opened ${order.join("")}, ${sawAll.join("") || "nobody"} saw all of it, then a draws again with ${next.join("")}`, () => {
      const id = "r1xx";
      const r = newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers: ["a"], members, commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) });
      for (const v of order) (r.commits[v] = commitOf(id, v, nonceOf(v, id), keyOf(v, id))), (r.keys[v] = keyOf(v, id));
      // what each honest client saw last of it: everything, or what had landed when it wrote its own opening
      const views = {};
      order.forEach((v, i) => {
        const copy = structuredClone(r);
        for (const w of sawAll.includes(v) ? order : order.slice(0, i)) copy.opens[w] = nonceOf(w, id);
        views[v] = roundOf({ round: copy });
      });
      for (const v of order) r.opens[v] = nonceOf(v, id);
      // a knew it, and nobody else did
      expect(derive(roundOf({ round: r }), "a", { mine: { nonce: nonceOf("a", id), key: keyOf("a", id) } }).seed).not.toBe(null);
      expect(complete(roundOf({ round: r }))).toBe(true);

      const id2 = "r2xx";
      const again = roundOf({ round: newRound({ draw: "dxxxx", id: id2, by: "a", at: 0, sealers: ["a"], members: next, commit: commitOf(id2, "a", nonceOf("a", id2), keyOf("a", id2)), key: keyOf("a", id2) }) });
      const faults = Object.fromEntries(order.map((v) => [v, faultOf(views[v], again, v, { opened: true })]));
      // the last to open always saw it complete, so somebody always refuses, and says why
      expect(faults[order.at(-1)]).toEqual({ of: id, why: "complete" });
      for (const v of order) {
        const sawComplete = complete(views[v], v);
        const want = sawComplete ? { of: id, why: "complete" } : !next.includes(v) ? { of: id, why: "dropped" } : null;
        expect(faults[v], v).toEqual(want);
        // a client that refuses takes no part in it
        if (want && next.includes(v)) expect(derive(again, v, { fault: want }).mustCommit).toBe(false);
      }
      // every honest member who doesn't refuse commits; the deadline closes it with those: a again, and whoever didn't see it complete
      const joins = order.filter((v) => next.includes(v) && !faults[v]);
      expect(joins.every((v) => !complete(views[v], v))).toBe(true);
      // nobody who has opened is left out unremarked
      for (const v of order) if (!next.includes(v)) expect(faults[v]).not.toBe(null);
    });
  }

  it("who could have known an attempt's seed: its sole sealer; with several, whoever holds every part; with every part in the clear, everyone", () => {
    const id = "r1xx";
    const made = (sealers, more = {}) => {
      const r = newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers, members: ["a", "b", "c"], commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) });
      for (const v of ["b", "c"]) (r.commits[v] = commitOf(id, v, nonceOf(v, id), keyOf(v, id))), (r.keys[v] = keyOf(v, id));
      return roundOf({ round: { ...r, ...more } });
    };
    const env = { iv: "AAAA", ct: "AAAA" };
    expect(knewOf(made(["a"]))).toEqual(["a"]);
    expect(knewOf(made(["a"], { opens: { a: nonceOf("a", id) } }))).toBe("all");
    expect(knewOf(made([]))).toBe("all");
    expect(knewOf(made(["a", "b", "c"]))).toEqual([]);
    // shaken blind and lifted: each sealed to the others but a
    expect(knewOf(made(["a", "b", "c"], { sealed: { a: { b: env, c: env }, b: { c: env }, c: { b: env } } }))).toEqual(["b", "c"]);
    expect(knewOf(made(["a", "b", "c"], { sealed: { a: { b: env }, c: { b: env } } }))).toEqual(["b"]);
    // not yet closed: nobody
    expect(knewOf(roundOf({ round: newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers: ["a"], members: ["a", "b"], commit: "0".repeat(64) }) }))).toEqual([]);
  });

  it("a round written over a draw by someone else (sealed to themselves) and completed, then asked for again by the draw's own asker: no fault, for the asker never knew the one it replaces", () => {
    const id = "rhijack";
    const hijack = newRound({ draw: "dxxxx", id, by: "b", at: 0, sealers: ["b"], members: ["a", "b"], commit: commitOf(id, "b", nonceOf("b", id), keyOf("b", id)), key: keyOf("b", id) });
    hijack.commits.a = commitOf(id, "a", nonceOf("a", id), keyOf("a", id));
    hijack.keys.a = keyOf("a", id);
    hijack.opens.a = nonceOf("a", id);
    const prev = roundOf({ round: hijack });
    expect(complete(prev)).toBe(true);
    const again = roundOf({ round: newRound({ draw: "dxxxx", id: "rmine", by: "a", at: 0, sealers: ["a"], members: ["a", "b"], commit: "0".repeat(64) }) });
    for (const me of ["a", "b", "c"]) expect(faultOf(prev, again, me, { opened: me === "a" })).toBe(null);
    // and the hijacker asking yet again is its reroll
    const third = roundOf({ round: newRound({ draw: "dxxxx", id: "rbob2", by: "b", at: 0, sealers: ["b"], members: ["a", "b"], commit: "0".repeat(64) }) });
    expect(faultOf(prev, third, "a", { opened: true })).toEqual({ of: id, why: "complete" });
  });

  it("a new attempt after one that wasn't complete (the deadlines' own retry) is no fault of anyone's", () => {
    const id = "r1xx";
    const prev = roundOf({ round: { ...newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers: ["a"], members: ["a", "b", "c"], commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)) }), commits: { a: "0".repeat(64), b: "1".repeat(64), c: "2".repeat(64) }, opens: { b: nonceOf("b", id) } } });
    const next = roundOf({ round: newRound({ draw: "dxxxx", id: "r2xx", by: "a", at: 0, sealers: ["a"], members: ["a", "b"], commit: "3".repeat(64), excluded: ["c"] }) });
    expect(faultOf(prev, next, "b", { opened: true })).toBe(null);
    // and a different draw, or the same attempt, is never a reroll
    expect(faultOf(prev, { ...next, draw: "dyyyy" }, "b")).toBe(null);
    expect(faultOf(prev, prev, "b")).toBe(null);
    expect(faultOf(null, next, "b")).toBe(null);
  });
});

describe("lots: a contributor can't steer it", () => {
  it("every contributor's nonce changes the seed, the others held", () => {
    const parts = [["a", nonceOf("a", "r")], ["b", nonceOf("b", "r")], ["c", nonceOf("c", "r")]];
    const base = seedOf("r", parts);
    for (let i = 0; i < parts.length; i++) {
      const changed = parts.map(([v, n], k) => [v, k === i ? nonceOf(v, "other") : n]);
      expect(seedOf("r", changed)).not.toBe(base);
    }
    // and the order they're given in doesn't matter
    expect(seedOf("r", [...parts].reverse())).toBe(base);
  });

  it("an opening that isn't what was committed spoils the round, naming whose it was, for everyone", () => {
    for (const cheat of ["a", "b", "c"]) {
      const id = "rcheat";
      const r = roundOf({ round: newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers: [], members: ["a", "b", "c"], commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) }) });
      for (const v of ["b", "c"]) {
        r.commits[v] = commitOf(id, v, nonceOf(v, id), keyOf(v, id));
        r.keys[v] = keyOf(v, id);
      }
      for (const v of ["a", "b", "c"]) r.opens[v] = v === cheat ? nonceOf(v, "swapped") : nonceOf(v, id);
      for (const me of ["a", "b", "c", "spectator"]) {
        const d = derive(r, me);
        expect(d.phase).toBe("spoiled");
        expect(d.spoiled).toEqual({ by: cheat, why: "opening" });
        expect(d.seed).toBe(null);
      }
    }
  });

  it("the one whose part is sealed can refuse to open: the round waits on them, by name, and nobody else learns it", () => {
    const { trace, live } = run({ members: ["a", "b"], sealers: ["a"], withholds: ["a"], phases: ["all"] });
    const after = trace.at(-1);
    expect(live).toEqual(["a", "b"]);
    expect(after.b.phase).toBe("sealed");
    expect(after.b.waiting).toEqual(["a"]);
    expect(after.b.seed).toBe(null);
    expect(after.a.phase).toBe("known");
  });

  it("someone who overwrites my commit is noticed by my client", () => {
    const id = "rover";
    const r = roundOf({ round: newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers: [], members: ["a", "b"], commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) }) });
    r.commits.b = commitOf(id, "b", nonceOf("mallory", id), keyOf("b", id));
    r.keys.b = keyOf("b", id);
    expect(derive(r, "b", { mine: { nonce: nonceOf("b", id), key: keyOf("b", id) } }).overwritten).toBe(true);
    expect(derive(r, "b", { mine: { nonce: nonceOf("b", id), key: keyOf("b", id) } }).mustOpen).toBe(false);
  });
});

describe("lots: deadlines", () => {
  const id = "rdead";
  const base = () => roundOf({ round: newRound({ draw: "dxxxx", id, by: "a", at: 1000, sealers: [], members: ["a", "b"], commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) }) });
  it("only the asker acts on one, and not before it's due", () => {
    const r = base();
    expect(due(r, "b", 1000 + COMMIT_MS)).toBe(null);
    expect(due(r, "a", 1000 + COMMIT_MS - 1)).toBe(null);
    expect(due(r, "a", 1000 + COMMIT_MS)).toEqual({ close: ["a"] });
  });
  it("an open deadline retries without whoever didn't open", () => {
    const r = base();
    r.commits.b = commitOf(id, "b", nonceOf("b", id), keyOf("b", id));
    expect(due(r, "a", 99_999, { openingSince: 5000 })).toEqual({ retry: { members: ["a"], excluded: ["b"] } });
    expect(due(r, "a", 5000 + OPEN_MS - 1, { openingSince: 5000 })).toBe(null);
  });
});

describe("lots: what the doc may hold", () => {
  it("a malformed round is no round", () => {
    const good = newRound({ draw: "dxxxx", id: "rxxxx", by: "a", at: 0, sealers: ["a"], members: ["a"], commit: sha256("x"), key: keyOf("a", "r") });
    expect(roundOf({ round: good })).not.toBe(null);
    for (const bad of [null, {}, { ...good, id: "" }, { ...good, by: 7 }, { ...good, members: ["b"] }, { ...good, sealers: "some" }, { ...good, protests: undefined }, { ...good, sealed: [] }, { ...good, draw: "a b" }]) expect(roundOf({ round: bad })).toBe(null);
    // junk in its maps is left out, not trusted
    const r = roundOf({ round: { ...good, commits: { a: "zz", b: sha256("y") }, opens: { a: "short" } } });
    expect(r.commits).toEqual({});
    expect(r.opens).toEqual({});
  });
  it("members: the asker and the seated who are here; with no seats, everyone here", () => {
    expect(membersFor({ by: "a", seated: ["a", "b", "c"], present: ["a", "b", "s"] })).toEqual(["a", "b"]);
    expect(membersFor({ by: "a", seated: ["b"], present: ["b", "s"] })).toEqual(["a", "b"]);
    expect(membersFor({ by: "a", seated: null, present: ["b", "s"] })).toEqual(["a", "b", "s"]);
    expect(membersFor({ by: "a", seated: ["a", "b"], present: ["a", "b"], excluded: ["b"] })).toEqual(["a"]);
  });
  it("seed32 is the seed's first four bytes", () => {
    expect(seed32("ff00000100000000000000000000000000000000000000000000000000000000")).toBe(0xff000001);
    expect(seed32("nope")).toBe(null);
  });
});

describe("sha256", () => {
  it("agrees with node's on every length across the padding boundaries", () => {
    for (let n = 0; n <= 130; n++) {
      const s = "x".repeat(n);
      expect(sha256(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
    expect(sha256("ünïcødé ✓")).toBe(createHash("sha256").update("ünïcødé ✓").digest("hex"));
  });
});
