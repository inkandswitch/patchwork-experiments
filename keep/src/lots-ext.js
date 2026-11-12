// `scene:extension` "keep.lots": random values nobody at the table chooses,
// drawn between the seated players' clients by commit and open (lots.js),
// for whatever needs one (a cup of dice). Built only from the stage's
// contract (scene/STAGE.md): it reads the doc, presence, the `roster`
// convention and api.audience, and contributes the `lots` convention and a
// HUD line.
//
// It runs wherever an object carries its trait, `keep.lots` (an empty
// marker until a draw puts a round in it), in every activity: a member's
// client must commit and open whatever its viewer is doing.
//
//   lots: {
//     draw(id, { sealers, draw }) → draw id | null
//        start a draw on object `id`. `sealers`: "all" or [] (everyone
//        learns it as soon as it's drawn), or the viewers whose parts stay
//        sealed: whoever holds all of them knows it (one sealer: that one,
//        at once; several: nobody until they release to each other). Each
//        part is released by the stage's audience for `id`: sealed to each
//        viewer in it, opened to everyone when it is everyone. `draw`: ask
//        again for a draw already asked (a new attempt of it, which every
//        client that saw the last one complete refuses: lots.js, RETRIES).
//     state(id) → null | lots.js derive(): { draw, phase, seed, public, contributors, sealers, waiting, protests, … }
//        the draw on `id` as this client knows it.
//   }
//
// What this client keeps to itself: its nonce and private key for each
// round it takes part in, in memory and in this browser's localStorage
// (`keep.lots:<viewer>:<round id>`), so a reload doesn't lose a part it
// owes. There is no private place in the stage yet that would follow a
// viewer to another device (scene/STAGE.md, "Three places for state"): a
// part kept in another browser is lost to this one. What it has seen of
// each draw's attempts (to refuse a reroll) is in memory only: a reload
// forgets it.

import { TRAIT, commitOf, derive, due, faultOf, freshId, freshNonce, membersFor, newRound, opensRight, roundOf } from "./lots.js";
import { makeKeys, seal, unseal } from "./seal.js";

export { TRAIT };

/** For setup code (found by this plugin's `lots: true`): the traits that let an object be drawn on. */
export const attach = () => ({ [TRAIT]: {} });

/** How long a wait goes untold in the HUD (ms): a round between two clients that are here takes a few round trips. */
const QUIET_MS = 1200;

function create(api) {
  const viewer = api.viewer;
  const mine = new Map(); // round id → { nonce, pub, jwk }
  const learned = new Map(); // round id → { [sealer]: nonce }, opened from envelopes to me
  const busy = new Set(); // async steps under way: "<round>:commit", "<round>:seal:<to>", "<round>:unseal:<sealer>", "<object>:attempt"
  const lastSeen = new Map(); // draw → its attempt as this client last saw it
  const before = new Map(); // attempt id → the attempt of its draw this client saw before it (null: none)
  const opened = new Set(); // attempt ids this client wrote its opening into
  const faults = new Map(); // attempt id → faultOf(…): this client refuses it
  const openingSince = new Map(); // round id → when this client first saw its contributors fixed
  const seenAt = new Map(); // round id → when this client first saw it
  let dead = false;
  let timer = null;
  let nudges = 0;

  // ── my parts, kept in this browser ──
  const storeKey = (id) => `keep.lots:${viewer}:${id}`;
  function mineOf(id) {
    if (mine.has(id)) return mine.get(id);
    try {
      const raw = globalThis.localStorage?.getItem(storeKey(id));
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.nonce === "string" && typeof v.pub === "string" && v.jwk) {
        mine.set(id, v);
        return v;
      }
    } catch {}
    return null;
  }
  function keepMine(id, v) {
    mine.set(id, v);
    try {
      globalThis.localStorage?.setItem(storeKey(id), JSON.stringify(v));
    } catch {}
  }
  function forget(id) {
    try {
      globalThis.localStorage?.removeItem(storeKey(id));
    } catch {}
  }

  /** Tell everything that reads `lots` to look again, when something was learned without a doc change (an envelope opened). */
  const nudge = () => {
    if (!dead) api.local.swap((m) => ({ ...m, "keep.lots.known": ++nudges }));
  };

  const heldFor = (r) => {
    const m = mineOf(r.id);
    return { mine: m ? { nonce: m.nonce, key: m.pub } : null, learned: learned.get(r.id) ?? null, fault: faults.get(r.id) ?? null };
  };

  /** Keep what this client has seen of each draw's attempts, and judge each new attempt against the one before it. */
  function witness(r) {
    const last = lastSeen.get(r.draw) ?? null;
    if (!before.has(r.id)) {
      const prev = last && last.id !== r.id ? last : null;
      before.set(r.id, prev);
      const f = faultOf(prev, r, viewer, { opened: !!prev && opened.has(prev.id) });
      if (f) faults.set(r.id, f);
    }
    lastSeen.set(r.draw, r);
  }

  /** Every object with a round on it: [{ id, r }]. */
  function rounds() {
    const out = [];
    for (const [id, o] of Object.entries(api.scene()?.objects ?? {})) {
      const r = roundOf(o?.traits?.[TRAIT]);
      if (r) out.push({ id, r });
    }
    return out;
  }

  /** Write into the round on `id`, if it is still attempt `rid`. */
  function into(id, rid, fn) {
    api.change((d) => {
      const r = d.objects?.[id]?.traits?.[TRAIT]?.round;
      if (!r || r.id !== rid) return;
      fn(r);
    });
  }

  function roster() {
    for (const { value } of api.collect?.("roster") ?? []) if (typeof value?.viewers === "function") return value;
    return null;
  }
  const nameOf = (v) => {
    if (v === viewer) return "you";
    try {
      return roster()?.who?.(v) || "someone";
    } catch {
      return "someone";
    }
  };

  // ── the steps ──
  async function commit(id, r) {
    const k = `${r.id}:commit`;
    if (busy.has(k)) return;
    busy.add(k);
    try {
      const keys = await makeKeys();
      const nonce = freshNonce();
      if (dead) return;
      keepMine(r.id, { nonce, pub: keys.pub, jwk: keys.jwk });
      into(id, r.id, (round) => {
        if (round.commits[viewer]) return;
        round.commits[viewer] = commitOf(r.id, viewer, nonce, keys.pub);
        round.keys[viewer] = keys.pub;
      });
    } catch (err) {
      console.warn("[keep.lots] couldn't commit", err);
    } finally {
      busy.delete(k);
    }
  }

  /** A new attempt on `id` (a first draw, or a retry), with my commit in it. */
  async function attempt(id, { draw, sealers, members, tries = 0, excluded = [], replaces = null }) {
    const k = `${id}:attempt`;
    if (busy.has(k)) return;
    busy.add(k);
    try {
      const rid = freshId("r");
      const keys = await makeKeys();
      const nonce = freshNonce();
      if (dead) return;
      keepMine(rid, { nonce, pub: keys.pub, jwk: keys.jwk });
      const round = newRound({ draw, id: rid, by: viewer, at: Date.now(), sealers, members, commit: commitOf(rid, viewer, nonce, keys.pub), key: keys.pub, tries, excluded });
      api.change((d) => {
        const o = d.objects?.[id];
        if (!o) return;
        if (replaces && o.traits?.[TRAIT]?.round?.id !== replaces) return;
        if (!o.traits) o.traits = {};
        if (!o.traits[TRAIT]) o.traits[TRAIT] = {};
        o.traits[TRAIT].round = round;
      });
    } catch (err) {
      console.warn("[keep.lots] couldn't start a draw", err);
    } finally {
      busy.delete(k);
    }
  }

  async function sealTo(id, r, to, nonce) {
    const k = `${r.id}:seal:${to}`;
    const m = mineOf(r.id);
    if (busy.has(k) || !m) return;
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
      console.warn("[keep.lots] couldn't seal", err);
    } finally {
      busy.delete(k);
    }
  }

  async function open(r, sealer) {
    const k = `${r.id}:unseal:${sealer}`;
    const m = mineOf(r.id);
    if (busy.has(k) || !m || !r.keys[sealer]) return;
    busy.add(k);
    try {
      const text = await unseal({ id: r.id, recipient: viewer, envelope: r.sealed[sealer][viewer], jwk: m.jwk, theirPub: r.keys[sealer] });
      if (!dead && text && opensRight(r, sealer, text)) {
        learned.set(r.id, { ...(learned.get(r.id) ?? {}), [sealer]: text });
        nudge();
      }
    } finally {
      busy.delete(k);
    }
  }

  /** Do whatever this client owes every round now. */
  function act() {
    if (dead) return;
    let pending = false;
    const now = Date.now();
    for (const { id, r } of rounds()) {
      if (!seenAt.has(r.id)) seenAt.set(r.id, now);
      witness(r);
      const d = derive(r, viewer, heldFor(r));
      // a reroll, or left out after I opened: I take no part, and say so where everyone reads it
      if (d.fault && !r.protests[viewer]) into(id, r.id, (round) => void (round.protests[viewer] || (round.protests[viewer] = { ...d.fault })));
      if (d.mustCommit) void commit(id, r);
      if (d.mustOpen) {
        const n = mineOf(r.id).nonce;
        opened.add(r.id);
        into(id, r.id, (round) => void (round.opens[viewer] || (round.opens[viewer] = n)));
      }
      if (r.opens[viewer]) opened.add(r.id);
      if (d.contributors && !openingSince.has(r.id)) openingSince.set(r.id, now);
      if (r.by === viewer && (d.phase === "committing" || d.phase === "opening")) {
        pending = true;
        const step = due(r, viewer, now, { openingSince: openingSince.get(r.id) ?? null });
        if (step?.close) into(id, r.id, (round) => void (round.closed || (round.closed = step.close)));
        else if (step?.retry) void attempt(id, { draw: r.draw, sealers: r.sealers, members: step.retry.members, tries: r.tries + 1, excluded: step.retry.excluded, replaces: r.id });
      }
      // envelopes to me
      if (d.phase === "sealed") for (const s of d.waiting) if (r.sealed[s]?.[viewer] && !learned.get(r.id)?.[s]) void open(r, s);
      // release what I hold of the sealed parts, as far as the stage's audience for the object says, and no further
      if (d.holding.length) {
        const audience = api.audience?.(id) ?? null;
        for (const s of d.holding) {
          const nonce = s === viewer ? mineOf(r.id)?.nonce : learned.get(r.id)?.[s];
          if (!nonce) continue;
          if (audience === "all") into(id, r.id, (round) => void (round.opens[s] || (round.opens[s] = nonce)));
          else if (Array.isArray(audience) && s === viewer) {
            for (const to of audience) if (to !== viewer && r.keys[to] && !r.sealed[viewer]?.[to]) void sealTo(id, r, to, nonce);
          }
        }
      }
      // nothing of it is a secret any more
      if (d.phase === "open" && mine.has(r.id)) {
        mine.delete(r.id);
        forget(r.id);
      }
    }
    clearTimeout(timer);
    timer = pending ? setTimeout(act, 250) : null;
  }

  function stateOf(id) {
    const r = roundOf(api.scene()?.objects?.[id]?.traits?.[TRAIT]);
    return r ? derive(r, viewer, heldFor(r)) : null;
  }

  return {
    update(snapshot, local, prev) {
      // look again when the doc, what's running or what's installed changed (any of which can change an audience)
      if (prev && snapshot === prev.scene && local?.running === prev.local?.running && local?.packages === prev.local?.packages && local?.["keep.lots.known"] === prev.local?.["keep.lots.known"]) return;
      act();
    },
    lots: Object.freeze({
      draw(id, { sealers = "all", draw = null } = {}) {
        const snap = api.scene();
        if (!snap?.objects?.[id] || !viewer) return null;
        const r = roster();
        let seated = null;
        try {
          seated = r ? r.viewers(snap) : null;
        } catch {}
        const present = [viewer, ...Object.values(api.presence?.get?.() ?? {}).map((p) => p?.viewer)].filter((v) => typeof v === "string");
        const members = membersFor({ by: viewer, seated, present });
        const d = typeof draw === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(draw) ? draw : freshId("d");
        void attempt(id, { draw: d, sealers: Array.isArray(sealers) ? [...new Set(sealers)] : [], members });
        return d;
      },
      state: stateOf,
    }),
    hud() {
      const out = [];
      const now = Date.now();
      const list = (vs) => (vs.length > 1 ? `${vs.slice(0, -1).join(", ")} and ${vs.at(-1)}` : vs[0] ?? "nobody");
      for (const { id, r } of rounds()) {
        const d = derive(r, viewer, heldFor(r));
        const what = api.nameOf?.(id) || "this";
        if (d.spoiled) out.push({ text: d.spoiled.why === "opening" ? `The lots for ${what} are spoiled: ${nameOf(d.spoiled.by)} opened something other than what they committed to.` : `The lots for ${what} can't be drawn: nobody they're for took part.`, state: "error" });
        else if (d.overwritten) out.push({ text: `Someone wrote over your part of the lots for ${what}.`, state: "error" });
        // what anyone can see in the doc about how this one was drawn, while it still matters
        if (d.phase !== "open") {
          // (a witness's word, under its own name: everyone who saw it says so, members or not)
          const by = (why) => d.protests.filter((p) => p.why === why).map((p) => nameOf(p.by));
          const cap = (t) => t.replace(/^./, (x) => x.toUpperCase());
          const saw = by("complete");
          if (saw.length) out.push({ text: cap(`${list(saw)} saw ${nameOf(r.by)} draw the lots for ${what} again after the draw before was made, and took no part.`), state: "warn" });
          const dropped = by("dropped");
          if (dropped.length) out.push({ text: cap(`${list(dropped)} opened ${dropped.length === 1 && dropped[0] === "you" ? "your" : "their"} part of the lots for ${what}, and then ${nameOf(r.by)} drew again without ${dropped.length === 1 && dropped[0] === "you" ? "you" : "them"}.`), state: "warn" });
          if (d.contributors?.length === 1 && d.contributors[0] !== viewer) out.push({ text: `The lots for ${what} were drawn by ${nameOf(d.contributors[0])} alone: nobody else took part.`, state: "warn" });
        }
        if (!d.spoiled && (d.phase === "committing" || d.phase === "opening") && now - (seenAt.get(r.id) ?? now) > QUIET_MS) out.push({ text: `Drawing lots for ${what}: waiting for ${list(d.waiting.map(nameOf))}.`, state: "loading" });
      }
      return out;
    },
    dispose() {
      dead = true;
      clearTimeout(timer);
    },
  };
}

export default { create, attach };
