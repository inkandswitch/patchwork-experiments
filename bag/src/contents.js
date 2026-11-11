// What is in a bag: the ONE module that reads and writes a bag doc's
// contents. Everything else (the tool, the scene extension, the moves) goes
// through these functions and never touches `doc.items` itself.
//
// THE SEAM FOR SECRECY. This is the "plain" keeper: the contents are plain
// data in the bag doc, so anyone who can open the doc can read what is in the
// bag (and, since a draw's choice is made by the drawer, could choose). A
// jointly kept secret (no one can read the contents alone) is planned as a
// stage-level capability; it replaces the storage behind these functions
// (`inside`, `outside`, `putIn`, `takeOut`, `verdict`, `forget`), and their
// callers stay as they are. What a keeper must provide is exactly this file's
// exports.
//
// ── the shape ───────────────────────────────────────────────────────────────
//
//   doc.items: { [tag]: put }             made with the doc, never by a peer
//   put = {                               one PUT of one item: written once, whole
//     id,      the object's id in the scene it came from
//     from,    that scene's URL (null: put in outside any scene)
//     object,  its record (object.js recordOf: everything but where it was)
//     scale,   its size
//     n,       a stamp: one more than every stamp its writer had seen
//     out?,    { by, n }: this put was taken out, by that view (a session
//              id), at that stamp. A tombstone: the record stays, so nothing
//              a bag ever held is forgotten until someone says Forget
//   }
//   tag = "<item>#<nonce>": unique to this put.   item = itemKey(from, id):
//   one per object per scene, the same on every peer.
//
// An ITEM is listed while any of its puts has no `out`, and INSIDE when it
// is listed and not a stray (below). However many live puts it has, it is
// one item.
//
// ── why this shape: two docs that don't merge together ─────────────────────
//
// A put and a draw each change two docs, the scene and the bag, and the two
// reach a peer separately, in either order, perhaps seconds apart. Nothing
// makes that atomic, so the shape is chosen so that every merge of every
// interleaving is harmless.
//
// 1. A PUT ADDS; A DRAW REMOVES ONLY THE PUTS IT SAW. Every put is a new
//    entry under a tag nobody else can write, so no merge can replace it,
//    and `takeOut` marks exactly the item's puts that are in the drawer's
//    own copy. A put the drawer hadn't heard of stays live. (This is an
//    observed-remove set: add wins.) So NOTHING IS LOST, by construction: an
//    object leaves the scene only in the same hand's put, that put can only
//    be marked out by a take that saw it, and a take is always the same
//    hand's write of the item somewhere else (the scene, for a draw; the
//    other bag, for a pour).
//    Two shapes were tried first and the search in moves.test.js found the
//    loss in each: one entry per item, replaced by each put (two puts that
//    haven't heard of each other are two assignments to one key, and the
//    merge may keep the older one, already drawn: a tombstone, and no
//    object), and a "left" mark written by whoever SAW an entry's object in
//    the scene (the mark and a peer's put of that object merge into a marked
//    entry and no object). Nobody here ever marks an entry because of what
//    they see elsewhere.
// 2. ONE KEY PER ITEM IN THE SCENE. A drawn item is `objects[id]` in the
//    scene it came from: the same key for every drawer. Two draws of one
//    item at once both write that key, Automerge keeps one whole value
//    there, and so the scene has it ONCE, by construction. (Never a list to
//    splice, where two splices of one index take two items or one twice.)
// 3. WHO DREW IT IS DECIDED BY THE DOC, THE SAME FOR EVERYONE. Each take is
//    stamped (`out.n`, a Lamport stamp; ties by session id). Where two takes
//    marked the same put, the merge keeps one mark; a drawer none of whose
//    marks survived has lost, and of the drawers whose marks did survive the
//    lowest stamp has it (`verdict`). Exactly one drawer reads "mine" once
//    the bag doc has merged; the others draw again.
//
// THE INVARIANT: once both docs have reached a peer, each item is in exactly
// one place by the readers' rule below: an object in the scene, or inside
// one bag. Never in two, never in none. moves.test.js checks it at every end
// state of every interleaving of two peers' puts, draws and pours, with real
// Automerge merges.
//
// ── STRAYS: the readers' rule ───────────────────────────────────────────────
//
// Some interleavings leave an item both listed here and an object in its
// scene: a draw that hadn't heard of a put-back (the put stays live, the
// draw's object is in the scene), a pour racing a draw, or simply a put
// whose bag half has arrived and whose scene half hasn't yet. One rule, the
// same for every reader, covers them all:
//
//     THE SCENE WINS. A listed item whose object is in its scene is a
//     stray: it is not inside. It isn't counted, shown or drawn.
//     (And an item listed in two bags of one scene is inside the first by
//     URL only: `shadowsFor`.)
//
// It is a rule for reading, applied with every read (`inside(doc, shadow)`),
// and nothing is ever written for it, so it can't race anything. What it
// costs, honestly:
//   - a stray stays listed in the bag doc. A reader with no scene to check
//     against (the bag's tool opened on its own) shows it as inside;
//   - if the stray's object is then deleted from the scene, the item is
//     inside again: the token is back in the bag rather than gone. Drawing
//     it, once it's inside, or putting the object into the bag and drawing
//     that, ends the stray.

import { drawIndex } from "./draw.js";

/** A bag doc's datatype id. */
export const BAG = "bag";

const plain = (v) => JSON.parse(JSON.stringify(v));
const itemsOf = (doc) => (doc?.items && typeof doc.items === "object" ? doc.items : {});
const isPut = (e) => !!e && typeof e === "object" && !!e.object && e.id != null;

/** The automerge doc id in a URL (heads and path dropped), or the string itself. */
const docId = (url) => String(url ?? "").replace(/^automerge:/, "").split(/[#/?]/)[0];

/** The key of an item (an object from a scene): the same for every peer. */
export const itemKey = (from, id) => (from ? `${id}@${docId(from)}` : String(id));
const keyOf = (e) => itemKey(e.from, e.id);

/** A nonce no other put has: random (this is not a draw: nothing rides on it). */
const nonce = () => Math.random().toString(36).slice(2, 10);

/** One more than every stamp in the doc: a put's `n`, a take's `out.n`. */
function nextStamp(doc) {
  let n = 0;
  for (const e of Object.values(itemsOf(doc))) n = Math.max(n, Number(e?.n) || 0, Number(e?.out?.n) || 0);
  return n + 1;
}

const byStamp = (a, b) => (Number(a.entry.n) || 0) - (Number(b.entry.n) || 0) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);

/** Every item with its puts: Map item key → [{ tag, entry }], oldest put first. */
function byItem(doc) {
  const out = new Map();
  for (const [tag, entry] of Object.entries(itemsOf(doc))) {
    if (!isPut(entry)) continue;
    const key = keyOf(entry);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ tag, entry });
  }
  for (const puts of out.values()) puts.sort(byStamp);
  return out;
}

/**
 * What is inside, in put order (oldest first): [{ key, entry, tags }], one
 * per item: its key, its newest live put, and the tags of all its live puts.
 * @param {(key: string, entry: object) => boolean} [shadow]  the reader's
 *   rule for an item that is listed but is really elsewhere (its object is
 *   in the scene; another bag of the scene has it): such an item isn't inside
 */
export function inside(doc, shadow = null) {
  const list = [];
  for (const [key, puts] of byItem(doc)) {
    const live = puts.filter((p) => !p.entry.out);
    if (!live.length) continue;
    const newest = live.at(-1);
    if (shadow?.(key, newest.entry)) continue;
    list.push({ key, entry: newest.entry, tag: newest.tag, tags: live.map((p) => p.tag) });
  }
  return list.sort(byStamp);
}

/** The items that were taken out and are still remembered (not listed now): [{ key, entry }], newest first. */
export function outside(doc) {
  const list = [];
  for (const [key, puts] of byItem(doc)) {
    if (puts.some((p) => !p.entry.out)) continue;
    const newest = puts.at(-1);
    list.push({ key, entry: newest.entry, tag: newest.tag });
  }
  return list.sort(byStamp).reverse();
}

/** How many are inside. This is the bag's public number. */
export const count = (doc, shadow = null) => inside(doc, shadow).length;

/**
 * Put objects in (inside a change of the bag doc). Each is a new entry
 * under a tag of its own, written whole.
 * @param {object} d  the bag doc's draft
 * @param {{ id: string, object: object, scale?: number, from?: string | null }[]} things
 * @param {{ from?: string | null, tag?: () => string }} [o]  the scene they came from (a thing may say its own); how to make a nonce (tests)
 * @returns {string[]} their item keys
 */
export function putIn(d, things, { from = null, tag = nonce } = {}) {
  let n = nextStamp(d);
  const keys = [];
  for (const t of things) {
    const entry = { id: String(t.id), from: t.from ?? from ?? null, object: plain(t.object), scale: Number(t.scale) > 0 ? Number(t.scale) : 1, n: n++ };
    const key = keyOf(entry);
    let name = `${key}#${tag()}`;
    while (d.items[name]) name = `${key}#${tag()}`;
    d.items[name] = entry;
    keys.push(key);
  }
  return keys;
}

/**
 * Take an item out (inside a change): every live put of it that is in this
 * copy of the doc is marked, with one stamp.
 * @returns {{ key: string, tags: string[], seen: string[], stamp: number } | null}
 *   what `verdict` needs later: the puts this take marked, the puts of the
 *   item that were out already, and its stamp. Null when it isn't listed.
 */
export function takeOut(d, key, by) {
  const puts = byItem(d).get(key) ?? [];
  const live = puts.filter((p) => !p.entry.out);
  if (!live.length) return null;
  const take = { key, tags: live.map((p) => p.tag), seen: puts.filter((p) => p.entry.out).map((p) => p.tag), stamp: nextStamp(d) };
  for (const tag of take.tags) d.items[tag].out = { by: String(by), n: take.stamp };
  return take;
}

/**
 * Whose a taken item is, once the bag doc has merged: "mine" or "lost".
 * `take` is what `takeOut` returned. It is lost when
 *   - every put this take marked now carries someone else's mark (where two
 *     takes marked one put, the merge kept the other's), or
 *   - another take of the same item, one this take hadn't seen, has a lower
 *     stamp (ties: the lower session id).
 * Every peer reads the same marks, so of the takes made at one moment
 * exactly one reads "mine". (A put that Forget has since dropped says
 * nothing either way.)
 */
export function verdict(doc, take, by) {
  const me = String(by);
  const items = itemsOf(doc);
  const mine = (o) => o.by === me && o.n === take.stamp;
  const marks = take.tags.map((t) => items[t]?.out).filter(Boolean);
  if (marks.length && marks.every((o) => !mine(o))) return "lost";
  const seen = new Set(take.seen);
  for (const { tag, entry } of byItem(doc).get(take.key) ?? []) {
    const o = entry.out;
    if (!o || seen.has(tag) || o.by === me) continue;
    if (o.n < take.stamp || (o.n === take.stamp && String(o.by) < me)) return "lost";
  }
  return "mine";
}

/** Forget what was taken out (inside a change): the tombstones go. */
export function forget(d) {
  for (const [tag, e] of Object.entries(itemsOf(d))) if (e?.out) delete d.items[tag];
}

/**
 * The strays among a scene's objects: the keys of items from this scene
 * that are listed while their object is in it (STRAYS: the scene wins).
 * @param {object} doc  the bag doc
 * @param {{ sceneUrl: string, has: (id: string) => boolean }} scene
 * @returns {string[]}
 */
export function strays(doc, { sceneUrl, has }) {
  const mine = docId(sceneUrl);
  return inside(doc)
    .filter(({ entry }) => entry.from && docId(entry.from) === mine && has(entry.id))
    .map(({ key }) => key);
}

/**
 * Which item a draw takes, by the bag's rule: { key, entry, tags } or null
 * when nothing is inside. The choice is draw.js drawIndex's, over put order.
 */
export function choose(doc, rule, { random = Math.random, shadow = null } = {}) {
  const list = inside(doc, shadow);
  const i = drawIndex(rule, list.length, random);
  return i < 0 ? null : list[i];
}

/** The contents by kind, for showing: [{ key, name, n }], by name. */
export function kinds(list, kindOf) {
  const out = new Map();
  for (const { entry } of list) {
    const k = kindOf(entry.object);
    const have = out.get(k.key);
    if (have) have.n++;
    else out.set(k.key, { key: k.key, name: k.name, n: 1 });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
}

/**
 * The reader's rule for every bag of one scene at once: which items are
 * listed but not inside. An item whose object is in the scene isn't (STRAYS:
 * the scene wins); and an item listed in two bags (put into both at the same
 * moment, or mid-pour) is inside the first by URL only. Every view of the
 * scene computes the same sets from the same docs, with no write.
 * @param {{ url: string, doc: object }[]} bags  the scene's bags, any order
 * @param {{ sceneUrl: string, has: (id: string) => boolean }} scene
 * @returns {Map<string, (key: string) => boolean>} bag URL → its shadow test (pass to `inside`)
 */
export function shadowsFor(bags, { sceneUrl, has }) {
  const out = new Map();
  const taken = new Set(); // items an earlier bag holds
  for (const { url, doc } of [...bags].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
    if (out.has(url)) continue;
    const hidden = new Set(strays(doc, { sceneUrl, has }));
    for (const { key } of inside(doc)) if (taken.has(key)) hidden.add(key);
    const test = (key) => hidden.has(key);
    out.set(url, test);
    for (const { key } of inside(doc, test)) taken.add(key);
  }
  return out;
}
