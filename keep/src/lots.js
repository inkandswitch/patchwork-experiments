// Lots: a random value nobody chooses, drawn by those at the table between
// them, by commit and open. Pure: the round as the doc has it, and what it
// says to one viewer, given what that viewer's client holds. No crypto but
// SHA-256 (sha256.js, synchronous); the envelopes are seal.js's.
//
// A ROUND lives on an object, in the trait of the extension that runs it:
//
//   "keep.lots": { round: {
//     draw,              // this draw, the same across retries (what a consumer waits on)
//     id,                // this attempt (a retry is a new id)
//     by, at,            // who asked, and when, by their clock (ms)
//     sealers,           // sorted viewers whose parts stay sealed until released; [] for a draw open to all
//     members,           // who takes part: sorted viewers, fixed when it's asked, `by` among them
//     commits: { [v]: H("commit" ‖ id ‖ v ‖ nonce ‖ key) },
//     keys:    { [v]: an ECDH public key (base64), for envelopes (seal.js) },
//     closed,            // null, or the contributors `by` fixed at the commit deadline
//     opens:   { [v]: nonce },                      // in the clear
//     sealed:  { [s]: { [r]: { iv, ct } } },        // sealer s's nonce, to viewer r alone
//     protests: { [v]: { of, why } },               // v's client refused this attempt (see RETRIES)
//     tries, excluded,   // how many retries, and who was left out for stalling
//   } }
//
// THE PROTOCOL
//   1. Commit. Every member's client picks a 256-bit nonce, keeps it to itself
//      and writes its hash (and a public key) under its own name.
//   2. Close. The contributors are every member, once all have committed; or,
//      when the commit deadline passes first, whoever had (`by` writes them).
//   3. Open. Every contributor but the SEALERS (the contributors `sealers`
//      names) writes its nonce in the clear, checked by everyone against its
//      commit.
//   4. The seed is H("seed" ‖ id ‖ v=nonce ‖ …) over every contributor, in
//      viewer order. Whoever holds every sealer's nonce knows it: a sole
//      sealer at once (a roll for its own eyes), several sealers only once
//      they have released their parts to each other (a roll for nobody yet).
//      Everyone else is a 256-bit secret short of it, which is to say knows
//      nothing.
//   5. Release (the extension, by the stage's audience for the object): each
//      sealer seals its nonce to each viewer in the audience, and when the
//      audience is everyone, anyone who holds a sealed part writes it in the
//      clear.
//
// Every write is one viewer's own key in a map the round was made with, or
// `closed`, or a whole new round (a retry, a new draw), which only `by`
// writes: no two peers ever create the same map (scene/STAGE.md, "Shared
// maps"), and a write into a round that lost a merge is simply gone.
//
// RETRIES. The doc isn't signed: any client can write a new attempt of a
// draw. The one worth doing is a sole sealer's: it knows the seed as soon as
// the others have opened, so a new attempt then would be a reroll it chose
// to make. So a client that saw an attempt of a draw COMPLETE (every opener
// opened) refuses a later attempt of the same draw asked by anyone who could
// have known its seed (`knewOf`), and one that had opened its part and is
// then left out of the next attempt says so. Either
// way it writes a protest into the new attempt, under its own name, which
// every client shows; the refusal leaves the new attempt to be closed
// without it, so its contributors say who drew it. A retry the deadlines
// call for (`due`) replaces an attempt that was not complete and leaves out
// only those who hadn't opened, so honest clients never protest one, but
// for the one race at the open deadline (an opening that crossed the retry).
//
// WHAT IT GUARANTEES (each a property of the rules below, checked over
// every case in lots.test.js):
//   - The seed is a hash over every contributor's nonce, each fixed by its
//     commit before anyone's nonce is shown: no contributor can steer it
//     unless every other contributor colludes.
//   - Nobody can know it before every sealer's nonce is opened or sealed to
//     them, save the sealers between them; the last opener knows no more
//     than the first.
//   - A wrong opening (one that doesn't match its commit) spoils the round,
//     naming whose it was.
//   - A sole sealer can't throw away a draw it has seen and draw again
//     unseen: every client that saw it refuses, and says so.
//   - It ends. A member who doesn't commit is left out at the commit
//     deadline; one who commits and doesn't open is left out of a retry at
//     the open deadline. Each retry has fewer members, so a round finishes
//     (with `by` alone, at worst: then it is `by`'s own draw, and says so).

import { sha256 } from "./sha256.js";

export const TRAIT = "keep.lots";
/** How long the asker waits for every member to commit (ms). */
export const COMMIT_MS = 5000;
/** How long the asker waits, once the contributors are fixed, for each to open (ms). */
export const OPEN_MS = 5000;
const V = 1;

const isViewer = (v) => typeof v === "string" && v.length > 0 && v.length <= 256;
const isId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(v);
const isHex = (s, n) => typeof s === "string" && s.length === n && /^[0-9a-f]+$/.test(s);
const isKey = (s) => typeof s === "string" && s.length > 16 && s.length < 256 && /^[A-Za-z0-9+/=]+$/.test(s);
const isB64 = (s) => typeof s === "string" && s.length > 0 && s.length < 512 && /^[A-Za-z0-9+/=]+$/.test(s);
const isEnvelope = (e) => !!e && typeof e === "object" && isB64(e.iv) && isB64(e.ct);
const sorted = (list) => [...new Set(list)].sort();
/** Nonces are 32 bytes, as 64 hex digits. */
export const NONCE_HEX = 64;
export const isNonce = (s) => isHex(s, NONCE_HEX);

/** What a member writes first: its nonce, bound to this attempt, its name and its key. */
export const commitOf = (id, viewer, nonce, key = "") => sha256(`keep.lots/commit/${V}|${id}|${viewer}|${nonce}|${key}`);

/** The seed: a hash over every contributor's nonce, in viewer order. @param {Map<string,string>|[string,string][]} parts */
export function seedOf(id, parts) {
  const list = [...(parts instanceof Map ? parts.entries() : parts)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(`keep.lots/seed/${V}|${id}|${list.map(([v, n]) => `${v}=${n}`).join("|")}`);
}

/** A seed's first 32 bits, as an unsigned integer (what a die is rolled from). */
export const seed32 = (seed) => (isHex(seed, 64) ? parseInt(seed.slice(0, 8), 16) >>> 0 : null);

const pick = (map, keys, ok) => {
  const out = {};
  for (const k of keys) {
    const v = map?.[k];
    if (ok(v)) out[k] = typeof v === "object" ? { ...v } : v;
  }
  return out;
};
const isMap = (m) => !!m && typeof m === "object" && !Array.isArray(m);
const MAPS = ["commits", "keys", "opens", "sealed", "protests"];
/** Why a client refused an attempt: it had seen the one before it complete, or was left out after opening its part. */
export const PROTESTS = ["complete", "dropped"];
const isProtest = (p) => !!p && typeof p === "object" && isId(p.of) && PROTESTS.includes(p.why);

/**
 * A round as the doc has it, checked and copied (plain data, no proxies),
 * or null when the trait holds none or a malformed one (one without the
 * maps every client writes its own key into is malformed: nobody may make
 * them later, see "Shared maps").
 */
export function roundOf(trait) {
  const r = trait?.round;
  if (!r || typeof r !== "object") return null;
  if (!isId(r.id) || !isId(r.draw) || !isViewer(r.by) || !Array.isArray(r.members) || !Array.isArray(r.sealers)) return null;
  if (!MAPS.every((k) => isMap(r[k]))) return null;
  const members = sorted([...r.members].filter(isViewer));
  if (!members.includes(r.by)) return null;
  const sealers = sorted([...r.sealers].filter(isViewer));
  const sealed = {};
  for (const s of Object.keys(r.sealed).filter((v) => sealers.includes(v) && members.includes(v))) {
    if (isMap(r.sealed[s])) sealed[s] = pick(r.sealed[s], Object.keys(r.sealed[s]).filter(isViewer), isEnvelope);
  }
  return {
    draw: r.draw,
    id: r.id,
    by: r.by,
    at: Number.isFinite(r.at) ? r.at : 0,
    sealers,
    members,
    commits: pick(r.commits, members, (s) => isHex(s, 64)),
    keys: pick(r.keys, members, isKey),
    closed: Array.isArray(r.closed) ? sorted([...r.closed].filter((v) => members.includes(v))) : null,
    opens: pick(r.opens, members, isNonce),
    sealed,
    protests: pick(r.protests, Object.keys(r.protests).filter(isViewer).sort(), isProtest),
    tries: Number.isInteger(r.tries) && r.tries >= 0 ? r.tries : 0,
    excluded: Array.isArray(r.excluded) ? sorted([...r.excluded].filter(isViewer)) : [],
  };
}

/**
 * A new round, as `by` writes it, with `by`'s own commit (and key) already
 * in. `sealers`: whose parts stay sealed until released ([] or "all": none,
 * a draw open to everyone as soon as it's drawn).
 */
export function newRound({ draw, id, by, at, sealers, members, commit, key = null, tries = 0, excluded = [] }) {
  const m = sorted([by, ...members]);
  return {
    draw,
    id,
    by,
    at,
    sealers: Array.isArray(sealers) ? sorted(sealers) : [],
    members: m,
    commits: { [by]: commit },
    keys: key ? { [by]: key } : {},
    closed: null,
    opens: {},
    sealed: {},
    protests: {},
    tries,
    excluded: sorted(excluded),
  };
}

/**
 * Who takes part in a new draw: its asker, and every seated viewer who is
 * here now (a spectator draws nothing; an absent player isn't waited for),
 * less anyone left out. With no seats at all, everyone here.
 * @param {{ by: string, seated: string[] | null, present: string[], excluded?: string[] }} o
 */
export function membersFor({ by, seated, present, excluded = [] }) {
  const here = new Set(present.filter(isViewer));
  const pool = Array.isArray(seated) ? seated.filter((v) => here.has(v)) : [...here];
  return sorted([by, ...pool.filter((v) => !excluded.includes(v))]);
}

/** The contributors: everyone, once all have committed; or those `by` closed it with. Null while still open. */
export function contributorsOf(r) {
  if (r.closed) return r.closed.filter((v) => r.commits[v]);
  return r.members.every((v) => r.commits[v]) ? [...r.members] : null;
}

/** The sealers who took part: the contributors `sealers` names ([] for a draw open to all). */
export const sealersOf = (r, contributors) => r.sealers.filter((v) => contributors.includes(v));

/** Does an opened nonce match its commit? */
export const opensRight = (r, v, nonce) => isNonce(nonce) && !!r.commits[v] && commitOf(r.id, v, nonce, r.keys[v] ?? "") === r.commits[v];

/**
 * Has every opener of an attempt opened (so that its sole sealer, if it has
 * one, knows the seed)? `alsoOpened`: a viewer whose opening counts though
 * this copy of the round predates it (my own, written since).
 */
export function complete(r, alsoOpened = null) {
  const contributors = contributorsOf(r);
  if (!contributors) return false;
  const sealers = sealersOf(r, contributors);
  if (r.sealers.length && !sealers.length) return false;
  return contributors.filter((v) => !sealers.includes(v)).every((v) => r.opens[v] || v === alsoOpened);
}

/**
 * Who could have known an attempt's seed, from the doc: "all" once every
 * sealer's part is in the clear (or it has none); else each viewer who
 * holds every sealer's part, its own or sealed to it. (A sole sealer knows
 * it as soon as the others have opened.)
 */
export function knewOf(r) {
  const contributors = contributorsOf(r);
  if (!contributors) return [];
  const sealers = sealersOf(r, contributors);
  if (sealers.every((s) => r.opens[s])) return "all";
  const holds = (v) => sealers.every((s) => s === v || r.opens[s] || r.sealed[s]?.[v]);
  return sorted([...sealers, ...Object.values(r.sealed).flatMap((m) => Object.keys(m))].filter(holds));
}

/**
 * Is a new attempt of a draw one `me`'s client must refuse? Given the
 * attempt of the same draw it saw before (`prev`, as it last saw it) and
 * whether it opened its part of that one:
 *   { of: prev.id, why: "complete" }   prev was complete, and this one is asked by someone who could
 *                                      have known prev's seed: a reroll by them
 *   { of: prev.id, why: "dropped" }    I opened my part of prev, and this leaves me out
 *   null                               nothing to say (a retry the deadlines call for, or someone else
 *                                      asking again for a draw a round written over it took: they
 *                                      learn nothing of it from the round they replace)
 */
export function faultOf(prev, next, me, { opened = false } = {}) {
  if (!prev || !next || prev.draw !== next.draw || prev.id === next.id) return null;
  if (complete(prev, opened ? me : null)) {
    const knew = knewOf(prev);
    if (knew === "all" || knew.includes(next.by)) return { of: prev.id, why: "complete" };
  }
  if ((opened || prev.opens[me]) && !next.members.includes(me)) return { of: prev.id, why: "dropped" };
  return null;
}

/**
 * What a round says to `me`, given what my client holds.
 * @param {object} r        roundOf(...)
 * @param {string | null} me
 * @param {{ mine?: { nonce: string, key?: string | null } | null, learned?: Record<string, string> | null, fault?: object | null }} [held]
 *   mine: my own nonce (and public key) for this attempt; learned: sealers' nonces, from envelopes to me;
 *   fault: faultOf(...) for this attempt, if my client has one (it then takes no part)
 * @returns {{
 *   draw, id, by, asked: string[], members, tries, excluded,
 *   phase: "committing" | "opening" | "sealed" | "known" | "open" | "spoiled",
 *   contributors: string[] | null,
 *   sealers: string[] | null,   // the contributors whose parts stay sealed
 *   holding: string[],          // the sealers whose part I hold (mine, or sealed to me) and isn't in the clear
 *   waiting: string[],          // whose step the round waits on
 *   seed: string | null,        // known here
 *   public: boolean,            // known to everyone (every sealer's part is in the clear)
 *   spoiled: null | { by?: string, why: "opening" | "nobody" },
 *   protests: { by: string, of: string, why: string }[],
 *   fault: null | { of, why },  // my client refuses this attempt
 *   mustCommit: boolean, mustOpen: boolean,
 *   overwritten: boolean,       // my commit in the doc isn't the one I made
 * }}
 */
export function derive(r, me, { mine = null, learned = null, fault = null } = {}) {
  const contributors = contributorsOf(r);
  const out = {
    draw: r.draw,
    id: r.id,
    by: r.by,
    asked: r.sealers,
    members: r.members,
    tries: r.tries,
    excluded: r.excluded,
    phase: "committing",
    contributors,
    sealers: null,
    holding: [],
    waiting: [],
    seed: null,
    public: false,
    spoiled: null,
    protests: Object.entries(r.protests).map(([by, p]) => ({ by, of: p.of, why: p.why })),
    fault,
    mustCommit: false,
    mustOpen: false,
    overwritten: false,
  };
  const myCommitOk = !!mine && !!r.commits[me] && commitOf(r.id, me, mine.nonce, r.keys[me] ?? "") === r.commits[me];
  out.overwritten = !!mine && !!r.commits[me] && !myCommitOk;
  // every opening is held to its commit, whoever's it is
  for (const v of Object.keys(r.opens).sort()) {
    if (!opensRight(r, v, r.opens[v])) {
      out.phase = "spoiled";
      out.spoiled = { by: v, why: "opening" };
      return out;
    }
  }
  if (!contributors) {
    out.waiting = r.members.filter((v) => !r.commits[v]);
    out.mustCommit = !fault && r.members.includes(me) && !r.commits[me] && !mine;
    return out;
  }
  const sealers = sealersOf(r, contributors);
  out.sealers = sealers;
  if (r.sealers.length && !sealers.length) {
    out.phase = "spoiled";
    out.spoiled = { why: "nobody" };
    return out;
  }
  const openers = contributors.filter((v) => !sealers.includes(v));
  const missing = openers.filter((v) => !r.opens[v]);
  out.mustOpen = !fault && openers.includes(me) && !r.opens[me] && myCommitOk;
  if (missing.length) {
    out.phase = "opening";
    out.waiting = missing;
    return out;
  }
  const parts = new Map(openers.map((v) => [v, r.opens[v]]));
  const unknown = [];
  let clear = true;
  for (const s of sealers) {
    let nonce = null;
    if (r.opens[s]) nonce = r.opens[s];
    else {
      clear = false;
      if (s === me && myCommitOk) nonce = mine.nonce;
      else if (learned?.[s] && opensRight(r, s, learned[s])) nonce = learned[s];
      if (nonce) out.holding.push(s);
    }
    if (nonce === null) unknown.push(s);
    else parts.set(s, nonce);
  }
  out.public = clear;
  if (unknown.length) {
    out.phase = "sealed";
    out.waiting = unknown;
    return out;
  }
  out.seed = seedOf(r.id, parts);
  out.phase = out.public ? "open" : "known";
  return out;
}

/**
 * What the asker's client must do now, by its clock, if anything:
 *   { close: viewer[] }                    the commit deadline passed: fix the contributors as those who committed
 *   { retry: { members, excluded } }       the open deadline passed: draw again without whoever didn't open
 * `openingSince`: when this client first saw the round's contributors fixed.
 */
export function due(r, me, now, { openingSince = null } = {}) {
  if (me !== r.by) return null;
  const d = derive(r, null);
  if (d.phase === "committing" && now - r.at >= COMMIT_MS) return { close: r.members.filter((v) => r.commits[v]) };
  if (d.phase === "opening" && openingSince != null && now - openingSince >= OPEN_MS) {
    // (never the asker: its own opening is its own client's to write, and it's the one deciding)
    const left = d.waiting.filter((v) => v !== r.by);
    if (!left.length) return null;
    return { retry: { members: d.contributors.filter((v) => !left.includes(v)), excluded: sorted([...r.excluded, ...left]) } };
  }
  return null;
}

/** A fresh id: 16 random hex digits. */
export function freshId(prefix = "") {
  const c = globalThis.crypto;
  const b = new Uint8Array(8);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A fresh nonce: 32 bytes from the platform's CSPRNG, as hex. */
export function freshNonce() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
