// A game → a table: every thing where the game's setup says it starts, and
// what each deck and bag holds. The one writer every way of making a table
// uses (GAME-FORMAT.md §8):
//
//   const layout = tableLayout(game, { fileOf, newId, rng, gameUrl });   // pure
//   const made = await makeHolders(host, layout);                       // table/made-with.js: keepers, bags
//   writeTable(d, layout, made, { seats: lay });                         // in one change
//
// - The game page's "Set up a table" (tool.js) writes it onto a fresh scene
//   doc; each kind shows the game's own GLB doc, which redraws when the game
//   changes, and the game is each object's About.
// - A template (table/template.js) writes it into the scene it was opened
//   in, and a game's part into a game doc of its own that it links onto what
//   it was put on; each kind's GLB is that doc's own file, so the table
//   stands alone.
//
// The scene doc's shape is the scene package's (scene/README.md), with this
// package's traits on it (src/table/visibility.js); this package only writes
// it, it never imports the scene. What isn't this package's is written
// through whoever owns it, found in the registry by metadata
// (table/made-with.js): what a card really is (a keeper's container, and its
// trait on the card), what a bag holds (a bag maker's document, and its
// trait on the bag) and the seats (their owner's `lay`).
//
// - A thing of several copies (`count`) is a group, so the outline stays
//   short; a single thing sits at the top level. A deck is a group of its
//   cards.
// - Every copy is a file object showing its kind's GLB file doc
//   (`fileOf(kind)` → { url, hint }), with the kind's box as its load hint,
//   and the game as its About (infoUrl) when there is a game doc.
// - A card (a piece with a `back`) is kept, wherever it lies: in the scene
//   it is its back piece (name, GLB, box, tags) with the trait tabletop.card,
//   and what it really is goes only into a container, slot by slot (a
//   container per deck, one more for the game's loose cards). Until the
//   containers exist a card names its container and slot under
//   tabletop.card ({ deck, slot }); writeTable swaps that for the keeper's
//   binding. Ids follow the order things are laid out in, so nothing in the
//   scene says which card is which.
// - A piece with a `zone`, placed for a seat, is that seat's hand (trait
//   tabletop.zone). A piece with `bag` is a bag: what the setup puts in it
//   goes into a bag document (layout.bags), never the scene.
// - A piece's `tags` and `traits` go on each of its copies; whatever isn't
//   locked carries the scene's `scene.carry`, so it can be picked up.
// - The seats are laid by their owner, which adds them to the scene's
//   (under other ids where another table's seats have these; each hand
//   follows its seat's id). A game with seats (every built-in one) starts
//   people in the seat body (view.start); one without in Look (the stage's
//   orbit camera, no body named), never in Edit.

import { apply, composeMatrix, decompose, multiply } from "./table/frame.js";
import { jumble } from "./table/wash.js";

/** The trait of a card: two-sided, piled, shuffled and drawn (table/visibility.js CARD). */
const CARD = "tabletop.card";
/** The trait of a hand: a seat's box on the table (table/visibility.js zones). */
const ZONE = "tabletop.zone";
/** The scene's trait for what can be picked up (scene/TOOLS.md §1). */
const CARRY = "scene.carry";
/** The container the game's loose cards (those in no deck) are kept in. */
export const LOOSE = "cards";

const copy = (v) => JSON.parse(JSON.stringify(v));
const tidy = (v) => Math.round(Number(v) * 1e6) / 1e6 + 0;
const ZERO = [0, 0, 0];

/** Fisher–Yates, with the caller's random numbers (so tests can fix them). */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Is this piece kind a card (two-sided: kept, shown as its back)? */
export const isCard = (game, kind) => typeof game?.pieces?.[kind]?.back === "string";

/**
 * A pose inside another: where `local` (in a frame placed at `outer`) is in
 * outer's parent, as a scene transform, its position to the micrometre. A
 * turn about Y followed by one with no tilt about X adds exactly ([0, a, 0]
 * then [0, b, c] is [0, a + b, c]), so a level table's numbers stay as
 * written; anything else goes through matrices.
 */
export function composePose(outer, local) {
  const op = outer?.position ?? ZERO;
  const or = outer?.rotation ?? ZERO;
  const lp = local?.position ?? ZERO;
  const lr = local?.rotation ?? ZERO;
  const M = composeMatrix({ position: op, rotation: or, scale: 1 });
  const position = apply(M, lp).map(tidy);
  if (!Number(or[0]) && !Number(or[2]) && !Number(lr[0])) return { position, rotation: [0, Number(or[1]) + Number(lr[1]) + 0, Number(lr[2]) + 0], scale: 1 };
  return { position, rotation: decompose(multiply(M, composeMatrix({ position: lp, rotation: lr, scale: 1 }))).rotation, scale: 1 };
}

/** Where the i-th copy of a thing lies: its `at`, moved along its grid (in its own frame). */
export function copyPose(thing, i) {
  const at = thing?.at ?? { position: ZERO };
  const g = thing?.grid;
  if (!g || !i) return composePose(at, { position: ZERO });
  const cols = Math.max(1, Math.round(Number(g.cols) || 1));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const off = [0, 1, 2].map((k) => col * Number(g.across?.[k] ?? 0) + row * Number(g.down?.[k] ?? 0));
  return composePose(at, { position: off });
}

/** Every piece kind a table of this game shows: each thing's piece, a card's back, each deck's cards; contents too. */
export function kindsUsed(game) {
  const used = new Set();
  const pieces = game?.pieces ?? {};
  const add = (k) => {
    if (!pieces[k] || used.has(k)) return;
    used.add(k);
    if (isCard(game, k)) add(pieces[k].back);
  };
  const walk = (things) => {
    for (const t of things ?? []) {
      if (t.deck) for (const k of t.deck.cards ?? []) add(k);
      else add(t.piece);
      walk(t.contents);
    }
  };
  walk(game?.setup);
  return [...used];
}

const copyBounds = (b) => (Array.isArray(b?.min) && Array.isArray(b?.max) ? { min: [...b.min], max: [...b.max] } : null);

/**
 * Lay a game out. Pure: it writes nothing and makes no docs.
 * @param {object} game  a tabletop-game (GAME-FORMAT.md), valid
 * @param {{
 *   fileOf: (kind: string) => { url: string, hint?: { bounds? } | null } | null,
 *   newId?: (prefix: string) => string,
 *   rng?: () => number,
 *   gameUrl?: string | null,
 * }} o  fileOf: the GLB file doc a kind shows, and its box; gameUrl: the game,
 *   as each object's About (none for a template's table)
 * @returns {{ objects, order, seats, containers, bags, view, origin }} the scene's
 *   objects (each card naming its container and slot under tabletop.card until
 *   writeTable binds it) and their order; its seats ({ [seatId]: { name, camera? } });
 *   what each container is to hold ({ [key]: { title, secure, items } }: slot k is
 *   items[k], { sourceUrl, name }); what each bag is to hold ({ [bag's object id]:
 *   { title, rule, items: [{ id, object }] } }: objects that are never in the scene);
 *   its view settings; and where the game came from (its `origin`, or null)
 */
export function tableLayout(game, { fileOf, newId, rng = Math.random, gameUrl = null } = {}) {
  let n = 0;
  const id = newId ?? ((prefix) => `${prefix}${(n++).toString(36).padStart(4, "0")}`);
  const pieces = game?.pieces ?? {};
  const objects = {};
  const order = [];
  const containers = {};
  const bags = {};
  const title = game?.title || "Game";

  const files = new Map();
  /** A kind's file: { url, bounds }, or it throws. */
  const drawn = (kind) => {
    if (!files.has(kind)) {
      const f = fileOf?.(kind);
      if (!f?.url) throw new Error(`“${pieces[kind]?.name || kind}” has no GLB yet`);
      files.set(kind, { url: f.url, bounds: copyBounds(f.hint?.bounds) });
    }
    return files.get(kind);
  };
  /** Where an object goes: into the scene (and a group), or into a bag. */
  const put = (oid, o, into) => {
    if (into.bag) bags[into.bag].items.push({ id: oid, object: o });
    else {
      objects[oid] = { ...o, group: into.group ?? null };
      order.push(oid);
    }
    return oid;
  };
  const group = (name, into) => {
    if (into.bag) return into; // a bag holds members, never a group
    const gid = id("g");
    objects[gid] = { kind: "group", name, group: into.group ?? null, visible: true, opacity: 1 };
    order.push(gid);
    return { group: gid };
  };
  const object = (kind, name, transform) => {
    const piece = pieces[kind];
    const file = drawn(kind);
    const traits = { ...(piece.traits ? copy(piece.traits) : {}), ...(piece.locked ? {} : { [CARRY]: {} }) };
    return {
      name,
      parent: null,
      visible: true,
      color: null,
      opacity: 1,
      wireframe: false,
      sourceUrl: file.url,
      providerId: "file-glb",
      renderUrl: null,
      transform,
      ...(gameUrl ? { infoUrl: gameUrl, infoToolId: "tabletop-game" } : {}),
      ...(piece.locked ? { locked: true } : {}),
      // its own traits, and what isn't fixed to the table can be picked up (the scene's carry trait)
      ...(Object.keys(traits).length ? { traits } : {}),
      // what connectors it fits (a card: the card slots); public, so only ever a kind's, never a card's own
      ...(Array.isArray(piece.tags) && piece.tags.length ? { tags: [...piece.tags] } : {}),
      ...(file.bounds ? { hint: { bounds: copyBounds(file.bounds) } } : {}),
    };
  };
  /** A container's next slot: what card `kind` really is. */
  const contain = (key, kind) => {
    const items = containers[key].items;
    items.push({ sourceUrl: drawn(kind).url, name: pieces[kind].name || kind });
    return items.length - 1;
  };
  /** A card: its back, kept in container `key`. */
  const card = (kind, transform, key, into) => {
    const backKind = pieces[kind].back;
    const back = pieces[backKind];
    const o = object(backKind, back.name || "Card", transform);
    o.traits = { ...o.traits, [CARD]: { deck: key, slot: contain(key, kind) } };
    return put(id("o"), o, into);
  };
  const thingPose = new Map(); // a thing's id → where its first copy lies
  const walkIds = (things) => {
    for (const t of things ?? []) {
      if (t.id != null && !thingPose.has(t.id)) thingPose.set(t.id, { thing: t, pose: copyPose(t, 0) });
      walkIds(t.contents);
    }
  };
  walkIds(game?.setup);

  const layThing = (t, into) => {
    if (t.deck) return layDeck(t, into);
    const piece = pieces[t.piece];
    const count = Math.max(1, Math.round(Number(t.count) || 1));
    const name = t.name || piece.name || t.piece;
    const where = count > 1 ? group(`${name} (${count})`, into) : into;
    for (let i = 0; i < count; i++) {
      const pose = copyPose(t, i);
      const label = count > 1 ? `${name} ${i + 1}` : name;
      if (isCard(game, t.piece)) {
        if (!containers[LOOSE]) containers[LOOSE] = { title: `${title}: Cards`, secure: false, items: [] };
        card(t.piece, pose, LOOSE, where);
        continue;
      }
      const o = object(t.piece, label, pose);
      if (piece.zone && t.seat != null) o.traits = { ...o.traits, "tabletop.zone": { seat: t.seat, min: [...piece.zone.min], max: [...piece.zone.max] } };
      const oid = id("o");
      if (piece.bag) bags[oid] = { title: label, rule: piece.bag.rule, items: [] };
      put(oid, o, where);
      if (piece.bag) for (const c of t.contents ?? []) layThing(c, { bag: oid });
    }
  };

  let decks = 0;
  const layDeck = (t, into) => {
    const deck = t.deck;
    const key = `deck${decks++}`;
    containers[key] = { title: `${title}: ${deck.name}`, secure: !!deck.secure, items: [] };
    const list = deck.shuffle ? shuffle(deck.cards, rng) : [...deck.cards]; // top first
    const where = group(`${deck.name} (${list.length})`, into);
    const at = t.at ?? { position: ZERO };
    // a stack steps by its thickest back (its cards may have different backs, as two decks shuffled together do)
    const backs = [...new Set(list.map((k) => pieces[k].back))];
    const h = Math.max(...backs.map((b) => Number(drawn(b).bounds?.max?.[1]) || 0));
    const flip = deck.faceDown ? Math.PI : 0;
    let next = 0;
    // dealt face up onto the snap points of the things it deals to, top card first
    const dealt = new Map(); // a target's id → how many of its snap points are taken
    for (const deal of deck.deal ?? []) {
      const target = thingPose.get(deal.to);
      const slots = pieces[target?.thing?.piece]?.snapPoints ?? [];
      const used = dealt.get(deal.to) ?? 0;
      let i = 0;
      for (; i < deal.count && next < list.length && used + i < slots.length; i++) {
        const s = slots[used + i];
        card(list[next++], composePose(target.pose, { position: s.position, rotation: s.rotation ?? ZERO }), key, where);
      }
      dealt.set(deal.to, used + i);
    }
    const rest = list.slice(next);
    if (deck.spread) {
      // spread out where it lies, as washing leaves tiles: a jumble of cells round `at`, each at a turn of its own
      const reach = Math.max(
        ...backs.map((k) => {
          const b = drawn(k).bounds;
          return b ? Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), Math.max(Math.abs(b.min[2]), Math.abs(b.max[2]))) : 0;
        }),
      );
      const spots = jumble(rest.length, { centre: [0, 0], cols: deck.spread.cols, cell: Number(deck.spread.cell) || 0, reach, rng });
      rest.forEach((k, i) => card(k, composePose(at, { position: [spots[i].x, deck.faceDown ? h : 0, spots[i].z], rotation: [0, spots[i].yaw, flip] }), key, where));
      return;
    }
    // the rest in a stack, the top card highest, made bottom first; face down is a half turn about the card's length
    for (let j = rest.length - 1; j >= 0; j--) {
      const level = rest.length - 1 - j;
      card(rest[j], composePose(at, { position: [0, tidy(level * h + (deck.faceDown ? h : 0)), 0], rotation: [0, 0, flip] }), key, where);
    }
  };

  for (const t of game?.setup ?? []) layThing(t, {});
  for (const k of Object.keys(containers)) if (!containers[k].items.length) delete containers[k];

  const seats = {};
  for (const [sid, s] of Object.entries(game?.seats ?? {})) seats[sid] = { name: s?.name || sid, ...(s?.camera ? { camera: copy(s.camera) } : {}) };
  return {
    objects,
    order,
    seats,
    containers,
    bags,
    view: {
      units: "cm",
      grid: false,
      axes: false,
      bounds: false,
      snap: true,
      // where people start (scene TOOLS.md §2): at a game with seats (every
      // built-in one), the seat body (back in your own seat, else watching
      // from the first seat's view), where pressing a piece picks it up or
      // uses it; a game laid out with none starts in Look (no body named) at the home view
      start: {
        ...(Object.keys(seats).length ? { body: "seat" } : {}),
        home: game?.camera ? copy(game.camera) : { position: [0, 0.72, 0.6], target: [0, 0, -0.04] },
      },
    },
    origin: game?.origin ? copy(game.origin) : null,
  };
}

/** The container and slot a card names before its container exists ({ deck, slot } under tabletop.card), or null. */
const deckRef = (o) => {
  const c = o?.traits?.[CARD];
  return c && typeof c.deck === "string" && Number.isInteger(c.slot) ? c : null;
};

/**
 * An object as it is written: a card bound to its slot by its keeper's own
 * trait (`binds[key](slot)`), beside a bare tabletop.card; a bag given its
 * document by the bag maker's trait (`bags[id]`). A fresh copy. A card
 * whose container has no binding throws.
 */
export function bound(oid, o, { binds = {}, bags = {} } = {}) {
  const c = copy(o);
  const ref = deckRef(c);
  if (ref) {
    if (typeof binds[ref.deck] !== "function") throw new Error(`no container for “${ref.deck}”`);
    c.traits = { ...c.traits, [CARD]: {}, ...copy(binds[ref.deck](ref.slot)) };
  }
  if (bags[oid]) c.traits = { ...c.traits, ...copy(bags[oid]) };
  return c;
}

/**
 * Write a layout into a scene doc (inside a change, or onto a plain
 * skeleton): its objects and their order, each bound (above); the seats,
 * through their owner's `lay`; and the view and the game's origin. A game is
 * a doc of its own (scene/COMPOSITION.md: a game part makes one and links it
 * onto what it was put on), so all of it is the game's to write. Throws,
 * writing nothing, if a card's container has no binding.
 * @param {object} d  the scene doc (a draft)
 * @param {ReturnType<typeof tableLayout>} layout
 * @param {{ binds?: { [key]: (slot: number) => object }, bags?: { [oid]: object } }} made  what makeHolders made
 * @param {{ seats?: ((d: object, seats: object) => unknown) | null }} [o]
 *   seats: the seats owner's lay (table/made-with.js findSeats); without one no seats are written
 */
export function writeTable(d, layout, made = {}, { seats = null } = {}) {
  const written = layout.order.map((oid) => [oid, bound(oid, layout.objects[oid], made)]);
  for (const [oid, o] of written) {
    d.objects[oid] = o;
    d.order.push(oid);
  }
  if (typeof seats === "function") seats(d, copy(layout.seats ?? {}));
  for (const [k, v] of Object.entries(layout.view ?? {})) d.view[k] = v && typeof v === "object" ? copy(v) : v;
  if (layout.origin) d.origin = copy(layout.origin);
}
