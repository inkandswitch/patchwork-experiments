// Lots, over every case of a small table: who takes part, whose parts stay
// sealed, who is away from the start and who commits and then never opens,
// and what the stage's audience says as the object is covered, lifted and
// shown to all. A model client per viewer follows the protocol (lots.js)
// against one round, as honest clients do (lots-ext.js); time moves only
// when nobody has anything to do. Envelopes here are a stand-in a client
// opens only when it's addressed to it (seal.test.js checks the real ones).

import { createHash } from "node:crypto";
import { COMMIT_MS, KEPT, STALE_MS, MAX_OF, OPEN_MS, commitOf, complete, contributorsOf, couldKnow, derive, due, endable, faultOf, goneOf, knewOf, knewWith, membersFor, newRound, opensRight, roundOf, seed32, seedOf } from "./lots.js";
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

  it("who could know, as a sealer's client tells it (knewWith): the doc's word, whatever anyone deleted from it, never misses anyone else who holds that client's part", () => {
    // Every honest doc of a round a, b and c took part in, a among its sealers: each envelope a sealer could have
    // written (to each other member) and each sealer's opening there or not; then every way a forger could take any
    // of them out again. a's client knows what it wrote itself (`told`), and that never leaves out anyone but a
    // who could know the seed from the honest doc: anyone who could holds a's part, sealed to them or in the clear.
    const id = "r1xx";
    const M = ["a", "b", "c"];
    let cases = 0;
    for (const sealers of [["a"], ["a", "b"], ["a", "b", "c"]]) {
      const slots = [...sealers.flatMap((s) => M.filter((t) => t !== s).map((t) => ({ s, t }))), ...sealers.map((s) => ({ s, open: true }))];
      // each slot: 0 never written, 1 written, 2 written and then deleted by the forger
      for (let k = 0; k < 3 ** slots.length; k++) {
        const state = slots.map((_, i) => Math.floor(k / 3 ** i) % 3);
        const docWith = (keep) => {
          const r = newRound({ draw: "dxxxx", id, by: "a", at: 0, sealers, members: M, commit: commitOf(id, "a", nonceOf("a", id), keyOf("a", id)), key: keyOf("a", id) });
          for (const v of ["b", "c"]) (r.commits[v] = commitOf(id, v, nonceOf(v, id), keyOf(v, id))), (r.keys[v] = keyOf(v, id));
          slots.forEach((x, i) => {
            if (!keep(state[i])) return;
            if (x.open) r.opens[x.s] = nonceOf(x.s, id);
            else (r.sealed[x.s] ??= {})[x.t] = { iv: "AAAA", ct: "AAAA" };
          });
          return roundOf({ round: r });
        };
        const honest = docWith((st) => st > 0);
        const forged = docWith((st) => st === 1);
        const told = { to: slots.filter((x, i) => x.s === "a" && !x.open && state[i] > 0).map((x) => x.t), opened: slots.some((x, i) => x.s === "a" && x.open && state[i] > 0) };
        const truth = knewOf(honest);
        const said = knewWith(knewOf(forged), told);
        const what = JSON.stringify({ sealers, state });
        if (truth === "all") expect(said, what).toBe("all");
        else for (const v of truth) if (v !== "a") expect(said === "all" || said.includes(v), what).toBe(true);
        // and it only ever widens the doc's word
        const doc = knewOf(forged);
        if (doc === "all") expect(said).toBe("all");
        else for (const v of doc) expect(said === "all" || said.includes(v), what).toBe(true);
        cases++;
      }
    }
    expect(cases).toBe(3 ** 3 + 3 ** 6 + 3 ** 9);
  });

  it("knewWith: the doc's word, and whom the client sealed its part to; everyone once it opened it, or when it can't say", () => {
    const P = ["a", "b", "c"];
    const subsetsOf = (list) => list.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
    for (const knew of ["all", ...subsetsOf(P)])
      for (const told of [null, KEPT, ...subsetsOf(P).flatMap((to) => [{ to, opened: false }, { to, opened: true }])]) {
        const said = knewWith(knew, told);
        if (knew === "all" || told === null || told.opened) expect(said).toBe("all");
        else expect(said).toEqual([...new Set([...knew, ...told.to])].sort());
      }
    // derive takes it as `told`, the doc's word alone when it's left out
    const r = roundOf({ round: newRound({ draw: "dxxxx", id: "r1xx", by: "a", at: 0, sealers: ["a"], members: ["a"], commit: commitOf("r1xx", "a", nonceOf("a", "r1xx"), keyOf("a", "r1xx")), key: keyOf("a", "r1xx") }) });
    expect(derive(r, "a").knew).toEqual(["a"]);
    expect(derive(r, "a", { told: { to: ["b"], opened: false } }).knew).toEqual(["a", "b"]);
    expect(derive(r, "a", { told: null }).knew).toBe("all");
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

describe("lots: a draw open to all, and its last opener", () => {
  // With nothing sealed, the last contributor to open can work the seed out from the others' openings before
  // writing its own. Every way such a draw among two or three can stand (who has opened), every one of them
  // asking for it again with everyone, and every client judging it (having opened its own part or not).
  const cases = [];
  for (const members of [["a", "b"], ["a", "b", "c"]])
    for (const opened of subsets(members))
      for (const by of members) for (const me of members) cases.push({ members, opened, by, me });
  it("has the cases it means to", () => expect(cases.length).toBe(4 * 2 * 2 + 8 * 3 * 3));

  const roundWith = (members, opened, by = "a", id = "r1xx") => {
    const r = newRound({ draw: "dxxxx", id, by, at: 0, of: ["d1"], sealers: [], members, commit: commitOf(id, by, nonceOf(by, id), "", ["d1"]) });
    for (const v of members) r.commits[v] = commitOf(id, v, nonceOf(v, id), "", ["d1"]);
    for (const v of opened) r.opens[v] = nonceOf(v, id);
    return roundOf({ round: r });
  };

  it("who could know it: everyone once all have opened; the one still to open once all the others have; else nobody", () => {
    for (const { members, opened } of cases) {
      const missing = members.filter((v) => !opened.includes(v));
      const r = roundWith(members, opened);
      expect(couldKnow(r)).toEqual(missing.length === 0 ? "all" : missing.length === 1 ? missing : []);
      // and only then is the seed in anyone's hands from the doc alone
      for (const v of [...members, "spectator"]) {
        const held = members.includes(v) && !opened.includes(v) ? { mine: { nonce: nonceOf(v, "r1xx"), key: null } } : {};
        const d = derive(r, v, held);
        const knows = missing.length === 0 || (missing.length === 1 && missing[0] === v);
        // (a client's own unopened part is the one it holds: derive says what the doc says, so the last opener sees the seed only once it has written its part)
        if (missing.length === 0) expect(d.seed).toBe(seedOf("r1xx", members.map((m) => [m, nonceOf(m, "r1xx")])));
        else expect(d.seed).toBe(null);
        if (!knows) expect(couldKnow(r) === "all" || couldKnow(r).includes(v)).toBe(false);
      }
    }
  });

  it("a new attempt of it is refused exactly when its asker could have known the one before: complete, or all opened but the asker (withheld)", () => {
    for (const { members, opened, by, me } of cases) {
      const prev = roundWith(members, opened);
      const next = roundOf({ round: newRound({ draw: "dxxxx", id: "r2xx", by, at: 0, of: ["d1"], sealers: [], members, commit: "0".repeat(64) }) });
      const mine = opened.includes(me);
      const f = faultOf(prev, next, me, { opened: mine });
      const missing = members.filter((v) => !opened.includes(v));
      const want = missing.length === 0 ? { of: "r1xx", why: "complete" } : missing.length === 1 && missing[0] === by ? { of: "r1xx", why: "withheld" } : null;
      expect(f, `${members.join("")} opened ${opened.join("") || "-"}, ${by} asks, ${me} judges`).toEqual(want);
    }
  });

  it("the deadlines' own retry is never refused: the asker has opened, and those it leaves out hadn't", () => {
    for (const { members, opened } of cases) {
      if (!opened.includes("a")) continue; // an honest asker opens as soon as the contributors are fixed
      const r = roundWith(members, opened);
      const step = due(r, "a", 1e9, { openingSince: 0 });
      if (!step?.retry) continue;
      const next = roundOf({ round: newRound({ draw: "dxxxx", id: "r2xx", by: "a", at: 0, of: ["d1"], sealers: [], members: step.retry.members, commit: "0".repeat(64), excluded: step.retry.excluded }) });
      for (const me of members) expect(faultOf(r, next, me, { opened: opened.includes(me) })).toBe(null);
    }
  });

  it("the asker opens first: nobody else opens until its opening is in, so the asker never knows the seed before everyone can", () => {
    for (const { members, opened, by, me } of cases) {
      const r = roundWith(members, opened, by);
      const d = derive(r, me, { mine: { nonce: nonceOf(me, "r1xx"), key: null } });
      const want = !opened.includes(me) && (me === by || opened.includes(by));
      expect(d.mustOpen, `${members.join("")} opened ${opened.join("") || "-"}, ${by} asked, ${me}`).toBe(want);
      if (!opened.includes(by) && members.length > 1) expect(d.waiting).toEqual([by]);
      // in every state honest clients can reach (nobody opened, or the asker among those who have), the asker
      // could know the seed only once everyone can
      if (!opened.length || opened.includes(by)) {
        const knew = couldKnow(r);
        expect(knew === "all" || !knew.includes(by) || members.length === 1).toBe(true);
      }
    }
  });

  it("a new draw on the same thing is refused exactly when the one before was open to all, not yet drawn, and its one contributor still to open asks it", () => {
    for (const { members, opened, by, me } of cases) {
      if (by !== "a") continue; // (the one before is a's; every asker of the next is below)
      const prev = roundWith(members, opened, "a");
      for (const asker of members) {
        const next = roundOf({ round: newRound({ draw: "dnext", id: "r2xx", by: asker, at: 0, of: ["d1"], sealers: [], members, commit: "0".repeat(64) }) });
        const missing = members.filter((v) => !opened.includes(v));
        const want = missing.length === 1 && missing[0] === asker ? { of: "r1xx", why: "withheld" } : null;
        expect(faultOf(prev, next, me, { opened: opened.includes(me) }), `${members.join("")} opened ${opened.join("") || "-"}, ${asker} draws anew, ${me} judges`).toEqual(want);
        // after a draw that's drawn (everyone opened), the next draw is just the next roll; and an asker that has
        // opened, as an honest one does first, is never refused a new draw
        if (!missing.length || opened.includes(asker)) expect(faultOf(prev, next, me, { opened: opened.includes(me) })).toBe(null);
        // a cup's new shake (its draw sealed) is never refused: the cup tells it
        const sealedPrev = roundOf({ round: { ...structuredClone(prev), sealers: ["a"] } });
        expect(faultOf(sealedPrev, next, me)).toBe(null);
      }
    }
  });

  it("alone: one member, closed by its own commit, its seed the hash of its one opening, no deadline", () => {
    const r = roundWith(["a"], ["a"]);
    expect(contributorsOf(r)).toEqual(["a"]);
    expect(derive(r, "a")).toMatchObject({ phase: "open", public: true, seed: seedOf("r1xx", [["a", nonceOf("a", "r1xx")]]) });
    expect(due(roundWith(["a"], []), "a", 0)).toBe(null);
    expect(derive(roundWith(["a"], []), "a", { mine: { nonce: nonceOf("a", "r1xx"), key: null } })).toMatchObject({ phase: "opening", mustOpen: true });
  });

  it("what it's of is bound into every commit: the same nonce opens it only for the `of` it was committed with", () => {
    const id = "rofxx";
    const n = nonceOf("a", id);
    const r = roundOf({ round: newRound({ draw: "dxxxx", id, by: "a", at: 0, of: ["d1", "d2"], sealers: [], members: ["a"], commit: commitOf(id, "a", n, "", ["d1", "d2"]) }) });
    expect(opensRight(r, "a", n)).toBe(true);
    for (const of of [["d2", "d1"], ["d1"], ["d1", "d2", "d3"], []]) expect(opensRight({ ...r, of }, "a", n)).toBe(false);
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

describe("lots: gone", () => {
  // Every attempt a's client can leave behind among two or three: a draw open to all, or sealed by a (a cup's
  // shake); every set of commits (a's always in), closed at the deadline or not, every set of openings honest clients
  // can reach (open to all: the asker first), and every set of openings at all (a merge can bring anything). Each
  // judged by every member and a spectator, a here or not, watched just short of STALE_MS or for it, holding their
  // own part or not, refusing it as forged or not.
  const id = "r1xx";
  const OF = ["d1"];
  const attempts = [];
  for (const members of [["a", "b"], ["a", "b", "c"]])
    for (const sealers of [[], ["a"]])
      for (const more of subsets(members.filter((v) => v !== "a"))) {
        const committed = ["a", ...more];
        for (const closed of committed.length < members.length ? [null, committed] : [null]) {
          const contributors = closed ?? (committed.length === members.length ? committed : null);
          const openers = contributors ? contributors.filter((v) => !sealers.includes(v)) : [];
          for (const opened of subsets(openers)) {
            const r = newRound({ draw: "dxxxx", id, by: "a", at: 0, of: OF, sealers, members, commit: commitOf(id, "a", nonceOf("a", id), "", OF) });
            for (const v of more) r.commits[v] = commitOf(id, v, nonceOf(v, id), "", OF);
            r.closed = closed;
            for (const v of opened) r.opens[v] = nonceOf(v, id);
            // honest clients reach it: in a draw open to all, nobody opens before the asker
            const honest = !(openers.length > 1 && openers.includes("a") && opened.length && !opened.includes("a"));
            attempts.push({ members, sealers, committed, closed, opened, honest, raw: r });
          }
        }
      }
  const VIEWERS = ["a", "b", "c", "s"];
  // could anyone but its asker know it? (nothing here is sealed to anyone: only the contributors' own parts) Some
  // contributor besides a whose part is the only one not in the clear: it can work the seed out from the others'
  const otherKnows = (raw) => {
    const contributors = contributorsOf(roundOf({ round: raw }));
    return !!contributors && contributors.some((v) => v !== "a" && contributors.every((u) => u === v || raw.opens[u]));
  };
  const underWay = (raw) => ["committing", "opening"].includes(derive(roundOf({ round: raw }), null).phase);
  it("has the cases it means to", () => {
    // ab, open to all: a alone (not closed; closed with a, a opened or not) 3, both (none, a, b, ab opened) 4; sealed
    // by a: 2 + 2. abc, open to all: a alone 3, with b 5, with c 5, all 8; sealed: 2 + 3 + 3 + 4. 11 + 33.
    expect(attempts.length).toBe(44);
    // what honest clients can't reach: b (or c, or both) opened before a, in a draw open to all: 1 among two, 5 among three
    expect(attempts.filter((x) => x.honest).length).toBe(38);
    // under way with someone besides the asker able to know it: open to all, every contributor's part in but one, not
    // a's. ab: both committed, a opened (1). abc: all committed, a and c or a and b opened (2); closed with ab or ac,
    // a opened (2)
    const known = attempts.filter((x) => underWay(x.raw) && otherKnows(x.raw));
    expect(known.length).toBe(5);
    for (const x of known) expect(x.sealers).toEqual([]);
    // endable is exactly "nobody but the asker could know it", over every attempt under way
    for (const { raw } of attempts) if (underWay(raw)) expect(endable(roundOf({ round: raw }))).toBe(!otherKnows(raw));
  });

  const heldBy = (v, has) => (has ? { mine: { nonce: nonceOf(v, id), key: null } } : {});
  it("who gives one up: anyone, once its asker is gone and it's been watched for both deadlines; the asker only when it can't move it on; never once it's drawn or waits only on sealed parts", () => {
    let n = 0;
    for (const { members, raw } of attempts) {
      const r = roundOf({ round: raw });
      const underWay = ["committing", "opening"].includes(derive(r, null).phase);
      for (const me of VIEWERS)
        for (const aHere of [true, false])
          for (const watched of [STALE_MS - 1, STALE_MS])
            for (const mine of [true, false])
              for (const fault of [null, { of: id, why: "forged" }]) {
                n++;
                const g = goneOf(r, me, { present: aHere ? ["a", ...members.filter((v) => v !== "a"), "s"] : [...members.filter((v) => v !== "a"), "s"], watched, mine, fault });
                const waitsOnMyOpening = derive(r, null).phase === "opening" && derive(r, null).waiting.includes(me);
                // (never once someone besides the asker could know it: a `gone` then would be its veto, knowing the face)
                const want = !underWay || otherKnows(raw) ? false : me === "a" ? !!fault || (waitsOnMyOpening && !mine) : !aHere && watched >= STALE_MS;
                expect(g, `${JSON.stringify(raw.commits && Object.keys(raw.commits))} closed ${raw.closed} opened ${Object.keys(raw.opens)} sealers ${raw.sealers}; ${me} judges, a ${aHere ? "here" : "gone"}, watched ${watched}, mine ${mine}, fault ${!!fault}`).toBe(want);
                // an honest asker that's here holding its part never gives up its own attempt: it moves it on
                if (me === "a" && mine && !fault) expect(g).toBe(false);
                // nor does anyone give up one whose asker they see here
                if (me !== "a" && aHere) expect(g).toBe(false);
              }
    }
    expect(n).toBe(44 * 4 * 2 * 2 * 2 * 2);
  });

  it("given up by anyone while nobody but its asker could know it, it's ended for everyone alike: nobody waits on it, nobody commits or opens, the asker's deadlines are done, and nobody gives it up again", () => {
    let n = 0;
    for (const { members, raw } of attempts) {
      if (!underWay(raw) || otherKnows(raw)) continue;
      n++;
      for (const giver of VIEWERS) {
        const r = roundOf({ round: { ...structuredClone(raw), gone: { [giver]: true } } });
        for (const v of VIEWERS)
          for (const has of [true, false]) {
            const d = derive(r, v, heldBy(v, has && members.includes(v)));
            expect(d).toMatchObject({ phase: "ended", waiting: [], mustCommit: false, mustOpen: false, seed: null, gone: [giver] });
            expect(goneOf(r, v, { present: [], watched: STALE_MS, mine: false })).toBe(false);
          }
        expect(due(r, "a", 1e9, { openingSince: 0 })).toBe(null);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it("one someone besides its asker could know is never ended by any `gone`, whoever's: it waits on the one still to open, by name, and the asker's deadline draws again without it, as with no `gone` at all", () => {
    let n = 0;
    for (const { members, raw } of attempts) {
      if (!underWay(raw) || !otherKnows(raw)) continue;
      const plain = roundOf({ round: raw });
      for (const gone of subsets(VIEWERS).filter((g) => g.length)) {
        n++;
        const r = roundOf({ round: { ...structuredClone(raw), gone: Object.fromEntries(gone.map((v) => [v, true])) } });
        for (const v of VIEWERS)
          for (const has of [true, false]) {
            const d = derive(r, v, heldBy(v, has && members.includes(v)));
            const without = derive(plain, v, heldBy(v, has && members.includes(v)));
            expect(d.phase).toBe("opening");
            expect(d.waiting).toHaveLength(1);
            expect(d.waiting[0]).not.toBe("a");
            // exactly as if nobody had written `gone`
            expect({ ...d, gone: [] }).toEqual({ ...without, gone: [] });
            // and nobody writes one
            expect(goneOf(r, v, { present: [], watched: STALE_MS, mine: false, fault: { of: id, why: "forged" } })).toBe(false);
          }
        expect(due(r, "a", 1e9, { openingSince: 0 })).toEqual(due(plain, "a", 1e9, { openingSince: 0 }));
        expect(due(r, "a", 1e9, { openingSince: 0 })?.retry?.excluded).toEqual(derive(plain, null).waiting);
      }
    }
    expect(n).toBe(attempts.filter((x) => underWay(x.raw) && otherKnows(x.raw)).length * 15);
  });

  it("an attempt drawn, or spoiled, isn't ended by a stale word that crosses it: the openings decide", () => {
    for (const { members, sealers, raw } of attempts) {
      // the same attempt with every opener's opening in (a merge that brings the last of them and someone's gone together)
      const all = structuredClone(raw);
      const contributors = contributorsOf(roundOf({ round: all }));
      if (!contributors) continue;
      for (const v of contributors) if (!sealers.includes(v)) all.opens[v] = nonceOf(v, id);
      all.gone = { b: true };
      const d = derive(roundOf({ round: all }), "s");
      expect(d.phase).toBe(sealers.length ? "sealed" : "open");
      // and a wrong opening spoils it, gone or not
      const bad = { ...structuredClone(all), opens: { ...all.opens, [contributors.find((v) => !sealers.includes(v)) ?? "a"]: "0".repeat(64) } };
      if (Object.keys(bad.opens).length) expect(derive(roundOf({ round: bad }), "s").phase).toBe("spoiled");
      expect(members.length).toBeGreaterThan(1);
    }
  });

  it("asked again by its asker once it's ended (a cup's holder, back), it's refused by nobody, save when the asker was its one contributor still to open", () => {
    let withheld = 0;
    let judged = 0;
    for (const { members, sealers, raw, honest } of attempts) {
      if (!honest) continue;
      const prev = roundOf({ round: { ...structuredClone(raw), gone: { b: true } } });
      if (derive(prev, null).phase !== "ended") continue;
      for (const next of subsets(members.filter((v) => v !== "a"))) {
        const again = roundOf({ round: newRound({ draw: "dxxxx", id: "r2xx", by: "a", at: 0, of: OF, sealers, members: ["a", ...next], commit: "0".repeat(64) }) });
        const knew = couldKnow(prev);
        for (const me of VIEWERS) {
          const f = faultOf(prev, again, me, { opened: !!prev.opens[me] });
          if (knew !== "all" && knew.includes("a")) {
            // a was the only one whose part wasn't in: it could have known the seed (and nobody can tell it lost its part)
            const contributors = contributorsOf(prev);
            expect(contributors.filter((v) => !prev.opens[v])).toEqual(["a"]);
            expect(f).toEqual({ of: id, why: "withheld" });
            withheld++;
            continue;
          }
          // anyone else is refused only for leaving out someone who had opened: they say so
          expect(f, `${Object.keys(raw.commits)} closed ${raw.closed} opened ${Object.keys(raw.opens)} sealers ${sealers}; a asks again with ${next}; ${me} judges`).toEqual(prev.opens[me] && !again.members.includes(me) ? { of: id, why: "dropped" } : null);
          judged++;
        }
      }
    }
    // (a closed out everyone else at its deadline and then lost its own part: from the doc, that's withholding)
    expect(withheld).toBeGreaterThan(0);
    expect(judged).toBeGreaterThan(withheld);
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
  it("an open deadline retries without whoever didn't open, once the asker has (until then the others wait on it, and it holds up only its own draw)", () => {
    const r = base();
    r.commits.b = commitOf(id, "b", nonceOf("b", id), keyOf("b", id));
    expect(derive(r, null).waiting).toEqual(["a"]);
    expect(due(r, "a", 99_999, { openingSince: 5000 })).toBe(null);
    r.opens.a = nonceOf("a", id);
    expect(due(r, "a", 99_999, { openingSince: 5000 })).toEqual({ retry: { members: ["a"], excluded: ["b"] } });
    expect(due(r, "a", 5000 + OPEN_MS - 1, { openingSince: 5000 })).toBe(null);
  });
});

describe("lots: what the doc may hold", () => {
  it("a malformed round is no round", () => {
    const good = newRound({ draw: "dxxxx", id: "rxxxx", by: "a", at: 0, sealers: ["a"], members: ["a"], commit: sha256("x"), key: keyOf("a", "r") });
    expect(roundOf({ round: good })).not.toBe(null);
    for (const bad of [null, {}, { ...good, id: "" }, { ...good, by: 7 }, { ...good, members: ["b"] }, { ...good, sealers: "some" }, { ...good, protests: undefined }, { ...good, gone: undefined }, { ...good, sealed: [] }, { ...good, draw: "a b" }, { ...good, of: "d1" }, { ...good, of: [7] }, { ...good, of: Array.from({ length: MAX_OF + 1 }, (_, i) => `d${i}`) }]) expect(roundOf({ round: bad })).toBe(null);
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
