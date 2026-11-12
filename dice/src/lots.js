// Lots: a random value nobody chooses, drawn by those present between them,
// by commit and open. Every roll of a die is drawn this way: a throw in the
// open (nothing sealed), a cup's shake (the holder's part sealed), a shake
// blind (every seated part sealed), the die's own panel. Pure: the round as
// the doc has it, and what it says to one viewer, given what that viewer's
// client holds. No crypto but SHA-256 (sha256.js, synchronous); the envelopes
// are seal.js's.
//
// A ROUND lives on whatever it's drawn for, under the key `round` of the map
// that says what that thing is: a die's trait (`"dice.die": { round }`, on
// the first die of a throw), a cup's (`"dice.cup": { …, round }`), the die
// doc itself for its panel (`{ …, round }`). Where is the caller's business
// (lots-run.js takes it as a place); a round is the same everywhere:
//
//   round: {
//     draw,              // this draw, the same across retries (what a consumer waits on)
//     id,                // this attempt (a retry is a new id)
//     by, at,            // who asked, and when, by their clock (ms)
//     of,                // what it's drawn for: ids, in order (a throw's dice, a shake's dice); bound into every commit
//     sealers,           // sorted viewers whose parts stay sealed until released; [] for a draw open to all
//     members,           // who takes part: sorted viewers, fixed when it's asked, `by` among them
//     commits: { [v]: H("commit" ‖ id ‖ v ‖ nonce ‖ key ‖ of) },
//     keys:    { [v]: an ECDH public key (base64), for envelopes (seal.js); none in a draw open to all },
//     closed,            // null, or the contributors `by` fixed at the commit deadline
//     opens:   { [v]: nonce },                      // in the clear
//     sealed:  { [s]: { [r]: { iv, ct } } },        // sealer s's nonce, to viewer r alone
//     protests: { [v]: { of, why } },               // v's client refused this attempt (see RETRIES)
//     tries, excluded,   // how many retries, and who was left out for stalling
//   }
//
// THE PROTOCOL
//   1. Commit. Every member's client picks a 256-bit nonce, keeps it to itself
//      and writes its hash (and a public key) under its own name. The hash
//      binds the attempt, the member, the key and what the draw is `of`: a
//      round whose `of` is changed after anyone committed is spoiled.
//   2. Close. The contributors are every member, once all have committed; or,
//      when the commit deadline passes first, whoever had (`by` writes them).
//   3. Open. Every contributor but the SEALERS (the contributors `sealers`
//      names) writes its nonce in the clear, checked by everyone against its
//      commit. The asker, if it opens at all, opens FIRST: nobody else opens
//      until its opening is in. So the one who decides whether to draw again
//      never knows the seed before everyone can (see RETRIES).
//   4. The seed is H("seed" ‖ id ‖ v=nonce ‖ …) over every contributor, in
//      viewer order. Whoever holds every sealer's nonce knows it: a sole
//      sealer at once (a roll for its own eyes), several sealers only once
//      they have released their parts to each other (a roll for nobody yet).
//      Everyone else is a 256-bit secret short of it, which is to say knows
//      nothing. With no sealers (a roll in the open), it is everyone's once
//      the last contributor opens.
//   5. Release (the runner, by the stage's audience for the object): each
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
// draw. The one worth writing is by someone who could already know the seed
// of the attempt it replaces (`couldKnow`): a sole sealer once the others
// have opened (a cup's holder), or, in a draw with nothing sealed, the last
// contributor still to open, who can work the seed out from the others'
// openings before writing its own (never the asker, who opens first; so
// only someone else, who can then only stop the draw, never start one of
// its own instead unremarked). A new attempt then would be a reroll it
// chose to make. So a client refuses (`faultOf`) a new attempt of a draw
//   - asked by anyone who could have known the one before it ("complete":
//     every opener had opened; "withheld": all but the asker had, and the
//     asker hadn't);
//   - or that leaves it out, having opened its part of the one before
//     ("dropped");
// and a new DRAW on the same thing, the one before it open to all and not
// yet drawn, asked by the one contributor still to open it ("withheld"
// again: it could work that seed out, and threw the draw away for one of
// its own).
//
// FORGERIES. Nor can anyone tell from the doc whose commit is whose: in a
// draw open to all, every nonce is in the clear once opened, so anyone could
// write a new attempt in someone else's name (`by` them, their commit made
// from the nonce they opened before) beside a nonce of their own, ground to
// the seed they like. Only the client whose name it is can tell, and it
// does (lots-run.js): an attempt that has a part in my name I didn't make
// (or is asked in my name and I didn't ask it), or where my commit isn't the
// one I made, my client refuses ("forged", `of` the attempt itself), takes
// no further part in and says so; every consumer (`forged` in derive) lands
// nothing by it.
// Either way it writes a protest into the new attempt, under its own name,
// which every client shows; the refusal leaves the new attempt to be closed
// without it, so its contributors say who drew it. A retry the deadlines
// call for (`due`) replaces an attempt that was not complete and leaves out
// only those who hadn't opened (never its asker, so never when the asker is
// the only one missing), so honest clients never protest one, but for the
// one race at the open deadline (an opening that crossed the retry). A new
// DRAW on the same thing is the consumer's to tell: a cup tells every new
// draw on it as a shake, a die a new throw before the last one landed.

// WHAT IT GUARANTEES (each a property of the rules below, checked over
// every case in lots.test.js):
//   - The seed is a hash over every contributor's nonce, each fixed by its
//     commit before anyone's nonce is shown: no contributor can steer it
//     unless every other contributor colludes.
//   - Nobody can know it before every sealer's nonce is opened or sealed to
//     them, save the sealers between them. With sealers, the last opener
//     knows no more than the first; with none, the last opener can know it
//     first, and can only use that by not opening, which every client sees:
//     the retry without it lists it in `excluded`, for whatever tells the
//     roll to say. That last opener is never the asker (it opens first), so
//     whoever asks for a draw open to all knows its seed only once everyone
//     can.
//   - A wrong opening (one that doesn't match its commit) spoils the round,
//     naming whose it was; so does `of` changed after the commits.
//   - Whoever could already know an attempt can't throw it away and draw it
//     again unseen: every client that saw it refuses, and says so.
//   - Nobody can write a part in someone else's name, or ask in it, unseen
//     by that someone's client, if it is here: it refuses ("forged").
//   - It ends. A member who doesn't commit is left out at the commit
//     deadline; one who commits and doesn't open is left out of a retry at
//     the open deadline. Each retry has fewer members, so a round finishes
//     (with `by` alone, at worst: then it is `by`'s own draw, and says so).
//     A round with one member (someone alone) finishes at once.

import { sha256 } from "./sha256.js";

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
/** The most things one draw may be of (a throw's dice). */
export const MAX_OF = 64;
const isOf = (of) => Array.isArray(of) && of.length <= MAX_OF && of.every((x) => typeof x === "string" && x.length > 0 && x.length <= 128);
const sorted = (list) => [...new Set(list)].sort();
/** Nonces are 32 bytes, as 64 hex digits. */
export const NONCE_HEX = 64;
export const isNonce = (s) => isHex(s, NONCE_HEX);

/** What a member writes first: its nonce, bound to this attempt, its name, its key and what the draw is of. */
export const commitOf = (id, viewer, nonce, key = "", of = []) => sha256(`dice.lots/commit/${V}|${id}|${viewer}|${nonce}|${key}|${JSON.stringify(of)}`);

/** The seed: a hash over every contributor's nonce, in viewer order. @param {Map<string,string>|[string,string][]} parts */
export function seedOf(id, parts) {
  const list = [...(parts instanceof Map ? parts.entries() : parts)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(`dice.lots/seed/${V}|${id}|${list.map(([v, n]) => `${v}=${n}`).join("|")}`);
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
/**
 * Why a client refused an attempt: it had seen the one before it complete,
 * or all of it but its asker's own opening, or it was left out after opening
 * its part; or a part of it in that client's name isn't one it made.
 */
export const PROTESTS = ["complete", "withheld", "dropped", "forged"];
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
  if (!isId(r.id) || !isId(r.draw) || !isViewer(r.by) || !Array.isArray(r.members) || !Array.isArray(r.sealers) || !isOf(r.of ?? [])) return null;
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
    of: [...(r.of ?? [])],
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
export function newRound({ draw, id, by, at, of = [], sealers, members, commit, key = null, tries = 0, excluded = [] }) {
  const m = sorted([by, ...members]);
  return {
    draw,
    id,
    by,
    at,
    of: [...of],
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
export const opensRight = (r, v, nonce) => isNonce(nonce) && !!r.commits[v] && commitOf(r.id, v, nonce, r.keys[v] ?? "", r.of) === r.commits[v];

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
 * Who could have known an attempt's seed from the doc, however far it got:
 * "all" when every contributor's part is in the clear; else each viewer who
 * holds every part that isn't, its own or sealed to it. So: a sole sealer
 * once the others have opened; whoever holds every sealed part; and, in a
 * draw with nothing sealed, the one contributor still to open, once all the
 * others have. `alsoOpened`: a viewer whose opening counts though this copy
 * of the round predates it (my own, written since). Not yet closed: nobody.
 */
export function couldKnow(r, alsoOpened = null) {
  const contributors = contributorsOf(r);
  if (!contributors) return [];
  const missing = contributors.filter((v) => !r.opens[v] && v !== alsoOpened);
  if (!missing.length) return "all";
  const sealers = sealersOf(r, contributors);
  // an opener's part is never sealed to anyone: only its own client holds it
  const holds = (v) => missing.every((s) => s === v || (sealers.includes(s) && !!r.sealed[s]?.[v]));
  return sorted([...missing, ...Object.values(r.sealed).flatMap((m) => Object.keys(m))].filter(holds));
}

/**
 * Is a new attempt of a draw one `me`'s client must refuse? Given the
 * attempt of the same draw it saw before (`prev`, as it last saw it) and
 * whether it opened its part of that one:
 *   { of: prev.id, why: "complete" }   prev was complete, and this one is asked by someone who could have
 *                                      known prev's seed: a reroll by them
 *   { of: prev.id, why: "withheld" }   prev was opened by all but its asker, who asks again: it could work
 *                                      prev's seed out from the others' openings, and chose not to open
 *   { of: prev.id, why: "dropped" }    I opened my part of prev, and this leaves me out
 *   { of: prev.id, why: "withheld" }   (a new draw on the thing prev was drawn for) prev was open to all,
 *                                      and this is asked by the one contributor still to open it
 *   null                               nothing to say (a retry the deadlines call for, or someone else
 *                                      asking again for a draw a round written over it took: they
 *                                      learn nothing of it from the round they replace)
 */
export function faultOf(prev, next, me, { opened = false } = {}) {
  if (!prev || !next || prev.id === next.id) return null;
  if (prev.draw !== next.draw) {
    // a new draw on the same thing: a cup's new shake is the cup's to tell (its holder may peek and shake again);
    // after a draw open to all that's drawn, it's the next roll (its consumer tells one thrown away before it landed)
    if (prev.sealers.length) return null;
    const knew = couldKnow(prev, opened ? me : null);
    return knew !== "all" && knew.includes(next.by) ? { of: prev.id, why: "withheld" } : null;
  }
  const knew = couldKnow(prev, opened ? me : null);
  if (knew === "all" || knew.includes(next.by)) return { of: prev.id, why: complete(prev, opened ? me : null) ? "complete" : "withheld" };
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
 *   draw, id, by, at, of: string[], asked: string[], members, tries, excluded,
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
 *   forged: string[],           // who says a part of it in their name isn't theirs (their "forged" protest): land nothing by it
 *   mustCommit: boolean, mustOpen: boolean,
 *   own: boolean,               // my commit is in it, and it's the one I made (with `by` me: my own attempt)
 *   overwritten: boolean,       // my commit in the doc isn't the one I made
 * }}
 */
export function derive(r, me, { mine = null, learned = null, fault = null } = {}) {
  const contributors = contributorsOf(r);
  const out = {
    draw: r.draw,
    id: r.id,
    by: r.by,
    at: r.at,
    of: r.of,
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
    forged: Object.keys(r.protests).filter((v) => r.protests[v].why === "forged"),
    mustCommit: false,
    mustOpen: false,
    own: false,
    overwritten: false,
  };
  const myCommitOk = !!mine && !!r.commits[me] && commitOf(r.id, me, mine.nonce, r.keys[me] ?? "", r.of) === r.commits[me];
  out.own = myCommitOk;
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
  // the asker opens first: until it has, nobody else does
  const askerFirst = openers.length > 1 && openers.includes(r.by) && !r.opens[r.by];
  out.mustOpen = !fault && openers.includes(me) && !r.opens[me] && myCommitOk && (!askerFirst || me === r.by);
  if (missing.length) {
    out.phase = "opening";
    out.waiting = askerFirst ? [r.by] : missing;
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
