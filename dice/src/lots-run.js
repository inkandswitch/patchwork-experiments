// Running lots (lots.js) for one client, wherever the rounds live. The
// protocol's steps are the same in a scene (lots-ext.js: rounds on dice and
// cups, members from the stage's presence and seats, releases by the stage's
// audience) and in a die's own panel (panel-lots.js: one round on the die
// doc, members from who has that doc's panel open, nothing ever sealed), so
// this is written once against a PLACE that says only where rounds are and
// who is here:
//
//   place: {
//     viewer,                          // this client's viewer
//     ready() → boolean                // is the doc here yet (what's on it then is what was there before this client)
//     rounds() → [{ id, round }]       // every thing with a round on it, and that round as the doc has it (raw)
//     write(id, fn(holder))            // one change: fn gets the map that holds `round` for thing `id` (a draft), or isn't called
//     present() → viewer[]             // who is here and runs lots, this viewer among them
//     seated() → viewer[] | null       // who may take part (null: anyone here)
//     audience(id) → "all" | viewer[] | null   // who may know what's drawn for `id` (null: unknown, release nothing)
//     nudge()                          // something was learned without a doc change: read state() again
//     name(v) → string                 // what to call a viewer ("you" for this one)
//     what(id) → string                // what to call the thing ("d20", "Red cup")
//     storage?                         // where this client keeps its parts (localStorage, or nothing)
//   }
//
// It gives:
//   draw(id, { sealers, draw, of }) → draw id | null
//      start a draw on `id`. `sealers`: [] or "all" (a draw open to all: no
//      keys, nothing sealed, the seed everyone's once all have opened), or
//      the viewers whose parts stay sealed: whoever holds all of them knows
//      it (one: that one, at once; several: nobody until they release to
//      each other), each part released by the place's audience. `draw`: ask
//      again for a draw already asked (a new attempt of it). `of`: what it's
//      drawn for (ids, in order), bound into every commit.
//   state(id) → null | lots.js derive(): { draw, by, of, phase, seed, public, contributors, members, waiting, protests, … }
//   act()      do whatever this client owes every round now (the place calls it on every change)
//   hud()      lines for whoever shows status
//   dispose()
//
// What this client keeps to itself: its nonce (and, for a sealed draw, its
// private key) for each round it takes part in, in memory and in the
// place's storage (`dice.lots:<viewer>:<round id>`), so a reload doesn't
// lose a part it owes (storage forgets it once the round is open; memory
// keeps it, so a part rewritten in my name after it's open is still seen).
// There is no private place in the stage yet that would follow a viewer to
// another device (scene/STAGE.md, "Three places for state"): a part kept in
// another browser is lost to this one. What it has seen of each draw's
// attempts (to refuse a reroll) is in memory only: a reload forgets it.
//
// FORGERIES (lots.js): a round this client first sees once the doc is here
// that has a commit in its viewer's name it didn't make, or is asked in its
// viewer's name and it didn't ask it, or where its commit isn't the one it
// made, it refuses ("forged") and says so in the round. What was on the doc
// when this client came is past: it can't know what it made then (unless
// storage still holds the part), and judges none of it, save a part that
// appears in its name afterwards. So one viewer is one client: the same
// viewer in a second browser, or on another device, is a stranger to this
// one, and their parts are refused as forged.

import { commitOf, derive, due, faultOf, freshId, freshNonce, membersFor, newRound, opensRight, roundOf } from "./lots.js";
import { makeKeys, seal, unseal } from "./seal.js";

/** How long a wait goes untold in the HUD (ms): a round between two clients that are here takes a few round trips. */
export const QUIET_MS = 1200;
const isDrawId = (d) => typeof d === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(d);

export function createRunner(place) {
  const viewer = place.viewer;
  const store = place.storage ?? null;
  const mine = new Map(); // round id → { nonce, pub, jwk }
  const learned = new Map(); // round id → { [sealer]: nonce }, opened from envelopes to me
  const busy = new Set(); // async steps under way: "<round>:commit", "<round>:seal:<to>", "<round>:unseal:<sealer>", "<object>:attempt"
  const lastSeen = new Map(); // draw → its attempt as this client last saw it
  const before = new Map(); // attempt id → faultOf it against the attempt of its draw this client saw before it (judged once)
  const opened = new Set(); // attempt ids this client wrote its opening into
  const faults = new Map(); // attempt id → faultOf(…): this client refuses it
  const openingSince = new Map(); // round id → when this client first saw its contributors fixed
  const seenAt = new Map(); // round id → when this client first saw it
  const lastOn = new Map(); // thing id → the attempt on it as this client last saw it (a new draw is judged against it)
  let base = null; // round id → was there a part (or the asking) in my name in it when this client came; null until the doc is here
  let dead = false;
  let timer = null;
  let acting = false;
  let again = false;

  // ── my parts, kept in this browser ──
  const storeKey = (id) => `dice.lots:${viewer}:${id}`;
  function mineOf(id) {
    if (mine.has(id)) return mine.get(id);
    try {
      const raw = store?.getItem(storeKey(id));
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.nonce === "string" && typeof v.pub === "string") {
        mine.set(id, v);
        return v;
      }
    } catch {}
    return null;
  }
  function keepMine(id, v) {
    mine.set(id, v);
    try {
      store?.setItem(storeKey(id), JSON.stringify(v));
    } catch {}
  }
  const forgotten = new Set();
  function forget(id) {
    if (forgotten.has(id)) return;
    forgotten.add(id);
    try {
      store?.removeItem(storeKey(id));
    } catch {}
  }

  const heldFor = (r) => {
    const m = mineOf(r.id);
    return { mine: m ? { nonce: m.nonce, key: m.pub || null } : null, learned: learned.get(r.id) ?? null, fault: faults.get(r.id) ?? null };
  };

  /**
   * Keep what this client has seen of each draw's attempts, and judge each
   * new attempt, once, against the one before it: of the same draw, if this
   * client saw one; else (a new draw) the one on the same thing.
   */
  function witness(id, r) {
    if (!before.has(r.id)) {
      const last = lastSeen.get(r.draw) ?? lastOn.get(id);
      const prev = last && last.id !== r.id ? last : null;
      const f = faultOf(prev, r, viewer, { opened: !!prev && opened.has(prev.id) });
      before.set(r.id, f);
      if (f) faults.set(r.id, f);
    }
    lastSeen.set(r.draw, r);
    lastOn.set(id, r);
  }
  /** Is a part of this attempt in my name one I didn't make (or is it asked in my name, and I didn't ask)? */
  function forgedHere(r, d) {
    if (d.overwritten) return true;
    if (!base) return false;
    const mineThere = !!r.commits[viewer] || r.by === viewer;
    if (!mineThere || mineOf(r.id)) return false;
    // there when this client came: it can't say
    return !base.get(r.id);
  }

  /** Every thing with a round on it: [{ id, r }], checked. */
  function rounds() {
    const out = [];
    for (const { id, round } of place.rounds()) {
      const r = roundOf({ round });
      if (r) out.push({ id, r });
    }
    return out;
  }

  /** Write into the round on `id`, if it is still attempt `rid`. */
  function into(id, rid, fn) {
    place.write(id, (holder) => {
      const r = holder?.round;
      if (!r || r.id !== rid) return;
      fn(r);
    });
  }

  // ── the steps ──
  /** My commit, and (for a draw with sealers: something may be sealed to me) a key to seal to. */
  async function partFor(r) {
    const nonce = freshNonce();
    if (!r.sealers.length) return { nonce, pub: "", jwk: null };
    const keys = await makeKeys();
    return { nonce, pub: keys.pub, jwk: keys.jwk };
  }

  function writeCommit(id, r, part) {
    keepMine(r.id, part);
    into(id, r.id, (round) => {
      if (round.commits[viewer]) return;
      round.commits[viewer] = commitOf(r.id, viewer, part.nonce, part.pub, r.of);
      if (part.pub) round.keys[viewer] = part.pub;
    });
  }

  function commit(id, r) {
    const k = `${r.id}:commit`;
    if (busy.has(k)) return;
    // a draw open to all needs no key: commit now, in this change
    if (!r.sealers.length) return writeCommit(id, r, { nonce: freshNonce(), pub: "", jwk: null });
    busy.add(k);
    partFor(r)
      .then((part) => {
        if (!dead) writeCommit(id, r, part);
      })
      .catch((err) => console.warn("[dice.lots] couldn't commit", err))
      .finally(() => busy.delete(k));
  }

  /** A new attempt on `id` (a first draw, or a retry), with my commit in it. */
  function attempt(id, { draw, of, sealers, members, tries = 0, excluded = [], replaces = null }) {
    const k = `${id}:attempt`;
    if (busy.has(k)) return;
    const rid = freshId("r");
    const write = (part) => {
      keepMine(rid, part);
      const round = newRound({ draw, id: rid, by: viewer, at: Date.now(), of, sealers, members, commit: commitOf(rid, viewer, part.nonce, part.pub, of), key: part.pub || null, tries, excluded });
      place.write(id, (holder) => {
        if (!holder) return;
        if (replaces && holder.round?.id !== replaces) return;
        holder.round = round;
      });
    };
    // open to all: in this change, so a throw is under way the moment it's asked
    if (!sealers.length) return write({ nonce: freshNonce(), pub: "", jwk: null });
    busy.add(k);
    partFor({ sealers })
      .then((part) => {
        if (!dead) write(part);
      })
      .catch((err) => console.warn("[dice.lots] couldn't start a draw", err))
      .finally(() => busy.delete(k));
  }

  async function sealTo(id, r, to, nonce) {
    const k = `${r.id}:seal:${to}`;
    const m = mineOf(r.id);
    if (busy.has(k) || !m?.jwk) return;
    busy.add(k);
    try {
      const env = await seal({ id: r.id, recipient: to, text: nonce, jwk: m.jwk, theirPub: r.keys[to] });
      if (!dead)
        into(id, r.id, (round) => {
          // my own key in `sealed`: only I make it
          if (!round.sealed[viewer]) round.sealed[viewer] = {};
          if (!round.sealed[viewer][to]) round.sealed[viewer][to] = env;
        });
    } catch (err) {
      console.warn("[dice.lots] couldn't seal", err);
    } finally {
      busy.delete(k);
    }
  }

  async function open(r, sealer) {
    const k = `${r.id}:unseal:${sealer}`;
    const m = mineOf(r.id);
    if (busy.has(k) || !m?.jwk || !r.keys[sealer]) return;
    busy.add(k);
    try {
      const text = await unseal({ id: r.id, recipient: viewer, envelope: r.sealed[sealer][viewer], jwk: m.jwk, theirPub: r.keys[sealer] });
      if (!dead && text && opensRight(r, sealer, text)) {
        learned.set(r.id, { ...(learned.get(r.id) ?? {}), [sealer]: text });
        place.nudge?.();
      }
    } finally {
      busy.delete(k);
    }
  }

  /** Do whatever this client owes every round now. (A write here can bring the next change at once: then it goes round again.) */
  function act() {
    if (dead) return;
    if (acting) return void (again = true);
    acting = true;
    try {
      do {
        again = false;
        step();
      } while (again && !dead);
    } finally {
      acting = false;
    }
  }

  function step() {
    let pending = false;
    const now = Date.now();
    const all = rounds();
    if (!base && (place.ready?.() ?? true)) base = new Map(all.map(({ r }) => [r.id, !!r.commits[viewer] || r.by === viewer]));
    // (nothing before the doc is here: what's on it then is past, and this client couldn't tell its own part from a forgery after)
    if (!base) return;
    for (const { id, r } of all) {
      if (!seenAt.has(r.id)) seenAt.set(r.id, now);
      witness(id, r);
      // what was there when this client came, and since then had nothing in my name, can't have it later unremarked
      if (base && !base.has(r.id)) base.set(r.id, false);
      let d = derive(r, viewer, heldFor(r));
      if (faults.get(r.id)?.why !== "forged" && forgedHere(r, d)) {
        faults.set(r.id, { of: r.id, why: "forged" });
        d = derive(r, viewer, heldFor(r));
      }
      // a reroll, left out after I opened, or a part in my name I didn't make: I take no part, and say so where
      // everyone reads it (a forgery found after I refused it otherwise says so instead: it's what consumers act on)
      const said = (p) => !!p && (p.why === "forged" || d.fault.why !== "forged");
      if (d.fault && !said(r.protests[viewer])) into(id, r.id, (round) => void (said(round.protests[viewer]) || (round.protests[viewer] = { ...d.fault })));
      if (d.mustCommit) commit(id, r);
      if (d.mustOpen) {
        const n = mineOf(r.id).nonce;
        opened.add(r.id);
        into(id, r.id, (round) => void (round.opens[viewer] || (round.opens[viewer] = n)));
      }
      if (r.opens[viewer]) opened.add(r.id);
      if (d.contributors && !openingSince.has(r.id)) openingSince.set(r.id, now);
      if (r.by === viewer && d.fault?.why !== "forged" && (d.phase === "committing" || d.phase === "opening")) {
        pending = true;
        const s = due(r, viewer, now, { openingSince: openingSince.get(r.id) ?? null });
        if (s?.close) into(id, r.id, (round) => void (round.closed || (round.closed = s.close)));
        else if (s?.retry) attempt(id, { draw: r.draw, of: r.of, sealers: r.sealers, members: s.retry.members, tries: r.tries + 1, excluded: s.retry.excluded, replaces: r.id });
      }
      // envelopes to me
      if (d.phase === "sealed") for (const s of d.waiting) if (r.sealed[s]?.[viewer] && !learned.get(r.id)?.[s]) void open(r, s);
      // release what I hold of the sealed parts, as far as the place's audience for the thing says, and no further
      if (d.holding.length) {
        const audience = place.audience?.(id) ?? null;
        for (const s of d.holding) {
          const nonce = s === viewer ? mineOf(r.id)?.nonce : learned.get(r.id)?.[s];
          if (!nonce) continue;
          if (audience === "all") into(id, r.id, (round) => void (round.opens[s] || (round.opens[s] = nonce)));
          else if (Array.isArray(audience) && s === viewer) {
            for (const to of audience) if (to !== viewer && r.keys[to] && !r.sealed[viewer]?.[to]) void sealTo(id, r, to, nonce);
          }
        }
      }
      // nothing of it is a secret any more: this browser's storage forgets it (memory keeps it, to see it rewritten)
      if (d.phase === "open" && mine.has(r.id)) forget(r.id);
    }
    clearTimeout(timer);
    timer = pending && !dead ? setTimeout(act, 250) : null;
  }

  function state(id) {
    const raw = place.rounds().find((x) => x.id === id)?.round;
    const r = raw ? roundOf({ round: raw }) : null;
    return r ? derive(r, viewer, heldFor(r)) : null;
  }

  function draw(id, { sealers = "all", draw = null, of = [] } = {}) {
    if (!viewer || !place.rounds || dead) return null;
    let seated = null;
    try {
      seated = place.seated?.() ?? null;
    } catch {}
    const members = membersFor({ by: viewer, seated, present: place.present() });
    const d = isDrawId(draw) ? draw : freshId("d");
    attempt(id, { draw: d, of: Array.isArray(of) ? [...of] : [], sealers: Array.isArray(sealers) ? [...new Set(sealers)] : [], members });
    return d;
  }

  function hud() {
    const out = [];
    const now = Date.now();
    const list = (vs) => (vs.length > 1 ? `${vs.slice(0, -1).join(", ")} and ${vs.at(-1)}` : vs[0] ?? "nobody");
    const cap = (t) => t.replace(/^./, (x) => x.toUpperCase());
    const name = (v) => place.name?.(v) ?? (v === viewer ? "you" : "someone");
    for (const { id, r } of rounds()) {
      const d = derive(r, viewer, heldFor(r));
      const what = place.what?.(id) || "this";
      if (d.spoiled) out.push({ text: d.spoiled.why === "opening" ? `The lots for ${what} are spoiled: ${name(d.spoiled.by)} opened something other than what they committed to (or what it was drawn for was changed after).` : `The lots for ${what} can't be drawn: nobody they're for took part.`, state: "error" });
      // a forgery is said for as long as the round is there, drawn or not: nothing lands by it
      if (d.fault?.why === "forged" || d.forged.includes(viewer)) out.push({ text: `Someone wrote the lots for ${what} in your name: your client refused them, and nothing lands by them.`, state: "error" });
      const others = d.forged.filter((v) => v !== viewer);
      if (others.length) out.push({ text: cap(`${list(others.map(name))} say${others.length === 1 ? "s" : ""} the lots for ${what} were written in their name by someone else: nothing lands by them.`), state: "error" });
      // what anyone can see in the doc about how this one was drawn, while it still matters
      if (d.phase !== "open") {
        // (a witness's word, under its own name: everyone who saw it says so, members or not)
        const by = (why) => d.protests.filter((p) => p.why === why).map((p) => name(p.by));
        const saw = by("complete");
        if (saw.length) out.push({ text: cap(`${list(saw)} saw ${name(r.by)} draw the lots for ${what} again after the draw before was made, and took no part.`), state: "warn" });
        const withheld = by("withheld");
        if (withheld.length) out.push({ text: cap(`${list(withheld)} saw ${name(r.by)} draw the lots for ${what} again without opening ${r.by === viewer ? "your" : "their"} part of the draw before, once everyone else had, and took no part.`), state: "warn" });
        const dropped = by("dropped");
        if (dropped.length) out.push({ text: cap(`${list(dropped)} opened ${dropped.length === 1 && dropped[0] === "you" ? "your" : "their"} part of the lots for ${what}, and then ${name(r.by)} drew again without ${dropped.length === 1 && dropped[0] === "you" ? "you" : "them"}.`), state: "warn" });
        if (d.contributors?.length === 1 && d.contributors[0] !== viewer) out.push({ text: `The lots for ${what} were drawn by ${name(d.contributors[0])} alone: nobody else took part.`, state: "warn" });
      }
      if (!d.spoiled && (d.phase === "committing" || d.phase === "opening") && now - (seenAt.get(r.id) ?? now) > QUIET_MS) out.push({ text: `Drawing lots for ${what}: waiting for ${list(d.waiting.map(name))}.`, state: "loading" });
    }
    return out;
  }

  return {
    act,
    draw,
    state,
    hud,
    dispose() {
      dead = true;
      clearTimeout(timer);
    },
  };
}
