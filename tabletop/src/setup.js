// A game → a table: every piece where it starts, and what each of its decks
// holds. The one writer both ways of making a table use:
//
//   const layout = tableLayout(game, { fileOf, newId, rng, gameUrl });   // pure
//   // a container for each of layout.decks, from a keeper (table/made-with.js containDecks), then, in one change:
//   writeTable(d, layout, binds, { seats: lay });
//
// - The game page's "Set up a table" (tool.js) writes it onto a skeleton
//   scene doc it then creates; each kind shows the game's own GLB doc
//   (`glbUrl`), which redraws when the game changes, and the game is each
//   object's About.
// - The scene's start screen (table/template.js) writes it into the empty
//   scene it was opened on; each kind's GLB is the scene's own file
//   (ctx.file), so the table stands alone.
//
// The scene doc's shape is the scene package's (scene/README.md, "scene —
// the composition"), with this package's traits on it
// (src/table/visibility.js); this package only writes it, it never imports
// the scene. Two things on a table aren't this package's, and are written
// through whoever owns them, found in the registry (table/made-with.js):
// what a hidden card really is (a keeper's container, and its trait on the
// card) and the seats (their owner's `lay`).
//
// - Each visible piece kind with more than one copy gets a group, so the
//   outline stays short; a single piece (the board) sits at the top level.
// - Every copy is a passthrough object showing its kind's GLB file doc
//   (`fileOf(kind)` → { url, hint }), with the kind's box as its load hint,
//   and the game as its About (infoUrl) when there is a game doc.
// - Hidden kinds (`hidden: true`) go into their deck: shuffled together, dealt
//   onto the snap points of the pieces the deck deals to, the rest stacked
//   (or, for a deck that says `spread`, laid out face down in a jumble, as a
//   boneyard of dominoes is: table/wash.js).
//   In the scene each is its `back` piece (name, GLB, box) with the trait
//   tabletop.card (a card: two-sided, piled, shuffled, drawn) and, written
//   by writeTable, its keeper's trait naming a slot of the deck's container:
//   which card it really is goes only there, and ids follow deck order, so
//   nothing in the scene says which is which.
// - Each deck is a container of its own, so a table has as many as the game
//   does. The layout says what it holds, slot by slot (`items`: slot k is
//   what card k really is, { sourceUrl, name }), in the order shuffled here;
//   a keeper whose players shuffle (a `secure` deck's) makes that order
//   mean nothing. Until the container exists, a card names its deck and slot
//   under `tabletop.card` ({ deck, slot }); writeTable swaps that for the
//   keeper's binding.
// - A piece with a `zone` makes its copy a seat's hand (trait tabletop.zone).
// - The game's seats are laid by the seats' owner (`seats`: its lay), which
//   writes them only where the scene has none.
// - A piece's `tags` go on each of its copies (the connectors they fit: a
//   card slot is tagged "card"). A hidden card has its back's tags, so they
//   say nothing about which card it is.
// - The scene opens in play, in the hand, with snapping on and the grid and
//   axes off; the seats' picker sits over the table.
// - Set down on something (placeLayout: a Card table aboard a ship), every
//   piece goes under that object in its frame, and each seat's camera says
//   so (`camera.in`); the scene's view is left alone (writeTable's `view`).
//   (A game with no hands and no cards, such as Santorini, gives the table
//   extension nothing to run on, so there is no play to open in and it
//   opens in the editor, in the hand.)

import { apply, composeMatrix, decompose, multiply } from "./table/frame.js";
import { jumble } from "./table/wash.js";

/** Where the i-th copy of a piece starts: a grid of `cols` from `at`, `gap` apart. [x, 0, z] */
export function supplySpot(supply, i) {
  const cols = Math.max(1, Math.round(Number(supply?.cols) || 1));
  const at = supply?.at ?? [0, 0];
  const gap = supply?.gap ?? [0.05, 0.05];
  const x = Number(at[0]) + (i % cols) * Number(gap[0] ?? 0);
  const z = Number(at[1]) + Math.floor(i / cols) * Number(gap[1] ?? 0);
  return [+x.toFixed(5), 0, +z.toFixed(5)];
}

/** Piece kinds in the game's order (then any it doesn't list). */
export function orderedKinds(game) {
  const pieces = game?.pieces ?? {};
  const listed = (game?.order ?? []).filter((k) => pieces[k]);
  return [...listed, ...Object.keys(pieces).filter((k) => !listed.includes(k))];
}

const copies = (piece) => Math.max(0, Math.round(Number(piece?.count) || 0));

/** A snap point as { position, yaw } (it may be written as a bare [x, y, z]). */
const point = (p) => (Array.isArray(p) ? { position: p, yaw: null } : { position: p?.position ?? [0, 0, 0], yaw: p?.yaw ?? null });

/** Fisher–Yates, with the caller's random numbers (so tests can fix them). */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The trait of a card: two-sided, piled, shuffled and drawn (table/visibility.js CARD). */
const CARD = "tabletop.card";

/** The piece kinds a table of this game shows: every visible kind it has copies of, and each card of a deck with its back. */
export function kindsUsed(game) {
  const pieces = game?.pieces ?? {};
  const decks = game?.decks ?? {};
  const used = new Set();
  for (const kind of orderedKinds(game)) {
    const p = pieces[kind];
    if (!copies(p)) continue;
    if (!p.hidden) used.add(kind);
    else if (Object.hasOwn(decks, p.deck ?? "")) {
      used.add(kind);
      if (p.back && pieces[p.back]) used.add(p.back);
    }
  }
  return [...used];
}

const copyBounds = (b) => (Array.isArray(b?.min) && Array.isArray(b?.max) ? { min: [...b.min], max: [...b.max] } : null);

/**
 * Lay a game out. Pure: it writes nothing and makes no docs.
 * @param {object} game  the tabletop-game doc (or one a game's fill() filled)
 * @param {{
 *   fileOf: (kind: string) => { url: string, hint?: { bounds? } | null } | null,
 *   newId?: (prefix: string) => string,
 *   rng?: () => number,
 *   gameUrl?: string | null,
 * }} o  fileOf: the GLB file doc a kind shows, and its box; gameUrl: the game,
 *   as each object's About (none for a template's table)
 * @returns {{ objects, order, seats, decks: { [deckId]: { title, secure, items } }, view }} the scene's
 *   objects (each card naming its deck and slot under tabletop.card until writeTable binds
 *   it), their order, its seats ({ [seatId]: { name, camera? } }, {} for none), what each
 *   deck's container is to hold (slot k: items[k]), and its view settings
 */
export function tableLayout(game, { fileOf, newId, rng = Math.random, gameUrl = null } = {}) {
  let n = 0;
  const id = newId ?? ((prefix) => `${prefix}${(n++).toString(36).padStart(4, "0")}`);
  const objects = {};
  const order = [];
  const deckDocs = {};
  const pieces = game?.pieces ?? {};
  // every piece is filed in a group (or none), never attached to another
  const base = (name, group) => ({ name, parent: null, group, visible: true, color: null, opacity: 1, wireframe: false });
  const files = new Map();
  /** A kind's file: { url, bounds }, or it throws. */
  const drawn = (kind) => {
    if (!files.has(kind)) {
      const p = pieces[kind];
      const f = fileOf?.(kind);
      if (!f?.url) throw new Error(`“${p?.name || kind}” has no GLB yet`);
      files.set(kind, { url: f.url, bounds: copyBounds(f.hint?.bounds) });
    }
    return files.get(kind);
  };
  const group = (name) => {
    const gid = id("g");
    objects[gid] = { kind: "group", name, group: null, visible: true, opacity: 1 };
    order.push(gid);
    return gid;
  };
  const place = (kind, { name, parent, transform }) => {
    const piece = pieces[kind];
    const file = drawn(kind);
    const oid = id("o");
    objects[oid] = {
      ...base(name, parent),
      sourceUrl: file.url,
      providerId: "file-glb",
      renderUrl: null,
      transform,
      ...(gameUrl ? { infoUrl: gameUrl, infoToolId: "tabletop-game" } : {}),
      ...(piece.locked ? { locked: true } : {}),
      // what connectors it fits (a card: the card slots); public, so only ever a kind's, never a card's own
      ...(Array.isArray(piece.tags) && piece.tags.length ? { tags: [...piece.tags] } : {}),
      ...(file.bounds ? { hint: { bounds: copyBounds(file.bounds) } } : {}),
    };
    order.push(oid);
    return oid;
  };

  // what everyone sees as it is
  const kinds = orderedKinds(game);
  for (const kind of kinds) {
    const piece = pieces[kind];
    const count = copies(piece);
    if (!count || piece.hidden) continue;
    drawn(kind);
    const parent = count > 1 ? group(`${piece.name || kind} (${count})`) : null;
    for (let i = 0; i < count; i++) {
      const yaw = Number(piece.supply?.yaw) || 0;
      const oid = place(kind, {
        name: count > 1 ? `${piece.name || kind} ${i + 1}` : piece.name || kind,
        parent,
        transform: { position: supplySpot(piece.supply, i), rotation: [0, yaw, 0], scale: 1 },
      });
      const z = piece.zone;
      if (z?.seat && Array.isArray(z.min) && Array.isArray(z.max)) objects[oid].traits = { "tabletop.zone": { seat: z.seat, min: [...z.min], max: [...z.max] } };
    }
  }

  // the decks: hidden kinds, shuffled, dealt, stacked
  for (const [deckId, deck] of Object.entries(game?.decks ?? {})) {
    const cards = [];
    for (const kind of kinds) {
      const piece = pieces[kind];
      if (piece.hidden && (piece.deck ?? null) === deckId) for (let i = 0; i < copies(piece); i++) cards.push(kind);
    }
    if (!cards.length) continue;
    const backKinds = new Set(cards.map((k) => pieces[k].back));
    if (backKinds.size !== 1) throw new Error(`the cards in “${deck.name || deckId}” don't share one back`);
    const backKind = [...backKinds][0];
    const back = backKind && pieces[backKind];
    if (!back) throw new Error(`“${deck.name || deckId}” has no back to show its cards as`);
    const backFile = drawn(backKind);
    for (const k of cards) drawn(k);
    const parent = group(`${deck.name || deckId} (${cards.length})`);
    const shuffled = shuffle(cards, rng);
    const items = []; // slot k: what card k really is
    const card = (kind, transform) => {
      const oid = place(backKind, { name: back.name || "Card", parent, transform });
      objects[oid].traits = { [CARD]: { deck: deckId, slot: items.length } };
      items.push({ sourceUrl: drawn(kind).url, name: pieces[kind].name || kind });
    };
    // dealt face up onto the first copy of each target's snap points
    let next = 0;
    for (const deal of deck.deal ?? []) {
      const target = pieces[deal.to];
      const slots = (target?.snapPoints ?? []).map(point);
      const origin = supplySpot(target?.supply, 0);
      const count = Math.min(Math.max(0, Math.round(Number(deal.count) || 0)), slots.length, shuffled.length - next);
      for (let i = 0; i < count; i++) {
        const s = slots[i];
        card(shuffled[next++], {
          position: [origin[0] + s.position[0], s.position[1], origin[2] + s.position[2]].map((v) => +v.toFixed(5)),
          rotation: [0, Number(s.yaw) || 0, 0],
          scale: 1,
        });
      }
    }
    // the rest in a stack, bottom first; face down is a half turn about the card's length
    const h = Number(backFile.bounds?.max?.[1]) || 0;
    const [ax, az] = deck.at ?? [0, 0];
    if (deck.spread) {
      // or spread out where it lies, as washing leaves tiles: a jumble of cells round `at`, each at a turn of its own
      const b = backFile.bounds;
      const reach = b ? Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), Math.max(Math.abs(b.min[2]), Math.abs(b.max[2]))) : 0;
      const spots = jumble(shuffled.length - next, { centre: [Number(ax), Number(az)], cols: deck.spread.cols, cell: Number(deck.spread.cell) || 0, reach, rng });
      for (const s of spots) {
        card(shuffled[next++], { position: [s.x, deck.faceDown ? h : 0, s.z], rotation: [0, s.yaw, deck.faceDown ? Math.PI : 0], scale: 1 });
      }
    }
    for (let j = 0; next < shuffled.length; j++) {
      card(shuffled[next++], {
        position: [Number(ax), +(j * h + (deck.faceDown ? h : 0)).toFixed(6), Number(az)],
        rotation: [0, Number(deck.yaw) || 0, deck.faceDown ? Math.PI : 0],
        scale: 1,
      });
    }
    deckDocs[deckId] = { title: deck.name || deckId, secure: !!deck.secure, items };
  }

  const seats = {};
  for (const [sid, s] of Object.entries(game?.seats ?? {})) {
    seats[sid] = { name: s?.name || sid, ...(s?.camera ? { camera: JSON.parse(JSON.stringify(s.camera)) } : {}) };
  }
  // Play only where the table has something to play with: hands or cards
  // are what start the table extension and so put play on offer. A table
  // with none (Santorini: everything in plain sight) opens in the editor,
  // with the hand as its tool, rather than claiming a play it can't start
  // ("Starts in: Play" over an editor).
  const playable = Object.values(objects).some((o) => o?.traits?.["tabletop.zone"] || o?.traits?.[CARD]);
  return {
    objects,
    order,
    seats,
    decks: deckDocs,
    view: {
      units: "cm", grid: false, axes: false, bounds: false, snap: true, tool: "hand",
      ...(playable ? { activity: "play" } : {}),
      home: game?.camera ? JSON.parse(JSON.stringify(game.camera)) : { position: [0, 0.72, 0.6], target: [0, 0, -0.04] },
    },
  };
}

/**
 * A layout set down on something: the same table, every piece placed in the
 * frame of `parent` (an object id) at `transform` there, rather than at the
 * scene's root. Each piece the layout puts at the root goes under `parent`,
 * its transform composed with `transform`; each seat's camera is moved the
 * same way and says it's in `parent`'s frame (`camera.in`), so a seat's view
 * goes where the table goes (a table aboard a ship). Pure: a new layout.
 * @param {ReturnType<typeof tableLayout>} layout
 * @param {{ parent?: string | null, transform?: { position?, rotation?, scale? } | null }} [at]
 */
export function placeLayout(layout, { parent = null, transform = null } = {}) {
  const t = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...(transform ?? {}) };
  const plain = t.rotation.every((v) => !Number(v)) && (Number(t.scale) || 1) === 1;
  // a turn or a scale: whole matrices; a plain shift: just added, so the numbers stay as they were
  const M = plain ? null : composeMatrix(t);
  const shift = (p) => p.map((v, i) => +(Number(v) + Number(t.position[i] ?? 0)).toFixed(6));
  const place = (tr) => (plain ? { ...tr, position: shift(tr.position ?? [0, 0, 0]) } : decompose(multiply(M, composeMatrix(tr))));
  const point = (p) => (plain ? shift(p) : apply(M, p).map((v) => +v.toFixed(6)));
  const objects = {};
  for (const [oid, o] of Object.entries(layout.objects)) {
    const c = JSON.parse(JSON.stringify(o));
    if (c.kind !== "group" && (c.parent ?? null) === null) {
      c.parent = parent;
      c.transform = place(c.transform ?? {});
    }
    objects[oid] = c;
  }
  const seats = {};
  for (const [sid, s] of Object.entries(layout.seats ?? {})) {
    const c = JSON.parse(JSON.stringify(s));
    if (c.camera) {
      c.camera = { ...c.camera, position: point(c.camera.position), target: point(c.camera.target ?? [0, 0, 0]) };
      if (parent) c.camera.in = parent;
      else delete c.camera.in;
    }
    seats[sid] = c;
  }
  const home = layout.view?.home;
  const view = { ...layout.view, ...(home ? { home: { ...home, position: point(home.position), target: point(home.target ?? [0, 0, 0]) } } : {}) };
  return { ...layout, objects, seats, view };
}

/** The deck and slot a card names before its container exists ({ deck, slot } under tabletop.card), or null. */
const deckRef = (o) => {
  const c = o?.traits?.[CARD];
  return c && typeof c.deck === "string" && Number.isInteger(c.slot) ? c : null;
};

/**
 * Write a layout into a scene doc (inside a change, or onto a plain skeleton):
 * its objects and their order, each card bound to its slot of its deck's
 * container by that keeper's own trait (`binds[deckId](slot)`), beside a
 * bare tabletop.card; the seats, through their owner's `lay` (which writes
 * them only where the scene has none); and the view (not with `view: false`:
 * a table set down in a scene that's already somewhere, such as aboard a
 * ship, leaves that scene's view, home and units as they are). Throws,
 * writing nothing, if a deck has no binding.
 * @param {object} d  the scene doc (a draft)
 * @param {ReturnType<typeof tableLayout>} layout
 * @param {{ [deckId]: (slot: number) => object }} binds  each deck's container's bind, made already
 * @param {{ view?: boolean, seats?: ((d: object, seats: object) => unknown) | null }} [o]
 *   seats: the seats owner's lay (table/made-with.js findSeats); without one no seats are written
 */
export function writeTable(d, layout, binds = {}, { view = true, seats = null } = {}) {
  for (const o of Object.values(layout.objects)) {
    const ref = deckRef(o);
    if (ref && typeof binds[ref.deck] !== "function") throw new Error(`no container for deck “${ref.deck}”`);
  }
  for (const oid of layout.order) {
    const o = JSON.parse(JSON.stringify(layout.objects[oid]));
    const ref = deckRef(o);
    if (ref) o.traits = { ...o.traits, [CARD]: {}, ...JSON.parse(JSON.stringify(binds[ref.deck](ref.slot))) };
    d.objects[oid] = o;
    d.order.push(oid);
  }
  if (typeof seats === "function") seats(d, JSON.parse(JSON.stringify(layout.seats ?? {})));
  if (!view) return;
  for (const [k, v] of Object.entries(layout.view ?? {})) d.view[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}
