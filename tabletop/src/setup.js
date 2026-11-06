// A game → a table: every piece where it starts, and a doc for each of its
// decks. The one writer both ways of making a table use:
//
//   const layout = tableLayout(game, { fileOf, newId, rng, gameUrl });   // pure
//   // make each of layout.decks with repo.create2, then, in one change:
//   writeTable(d, layout, deckUrls);
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
// the scene.
//
// - Each visible piece kind with more than one copy gets a group, so the
//   outline stays short; a single piece (the board) sits at the top level.
// - Every copy is a passthrough object showing its kind's GLB file doc
//   (`fileOf(kind)` → { url, hint }), with the kind's box as its load hint,
//   and the game as its About (infoUrl) when there is a game doc.
// - Hidden kinds (`hidden: true`) go into their deck: shuffled together, dealt
//   onto the snap points of the pieces the deck deals to, the rest stacked.
//   In the scene each is its `back` piece (name, GLB, box) with the trait
//   tabletop.hidden: { by: <its deck's doc> }: which card it really is goes only in that doc,
//   and ids follow deck order, so nothing in the scene says which is which.
// - Each deck is a doc of its own, so a table has as many as the game does:
//   a `plain-deck` doc, or for a `secure` deck a `secure-deck` (the
//   card-table package's; card-table/README.md), which lists the cards and
//   which object is which position, and which the seated players shuffle
//   between them so that nobody knows the order. With `secure: false`
//   every deck is plain (a template where no secure deck is installed).
//   Until the decks exist, a hidden card names its deck `deck:<id>`;
//   writeTable puts each deck's url there.
// - A piece with a `zone` makes its copy a seat's private area (trait tabletop.zone).
// - The game's seats become the scene's (trait tabletop.seats), unless the
//   scene already has seats (a shared map is made once: scene/STAGE.md).
// - A piece's `tags` go on each of its copies (the connectors they fit: a
//   card slot is tagged "card"). A hidden card has its back's tags, so they
//   say nothing about which card it is.
// - The scene opens in play, in the hand, with snapping on and the grid and
//   axes off; the table extension's seat picker sits over the table.
//   (A game with no seats, zones or hidden cards, such as Santorini, gives
//   the table extension nothing to run on, so there is no play to open in
//   yet and it opens in the editor, in the hand.)

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

const DECK_PREFIX = "deck:";

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
 *   secure?: boolean,
 * }} o  fileOf: the GLB file doc a kind shows, and its box; gameUrl: the game,
 *   as each object's About (none for a template's table); secure: false makes
 *   every deck plain
 * @returns {{ objects, order, seats, decks: { [deckId]: object }, view }} the scene's
 *   objects (hidden ones naming their deck `deck:<id>`), their order, its seats
 *   ({} for none), the deck docs to create, and its view settings
 */
export function tableLayout(game, { fileOf, newId, rng = Math.random, gameUrl = null, secure = true } = {}) {
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
    const secretObjects = {};
    const card = (kind, transform) => {
      const oid = place(backKind, { name: back.name || "Card", parent, transform });
      objects[oid].traits = { "tabletop.hidden": { by: `${DECK_PREFIX}${deckId}` } };
      secretObjects[oid] = { sourceUrl: drawn(kind).url, name: pieces[kind].name || kind };
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
    for (let j = 0; next < shuffled.length; j++) {
      card(shuffled[next++], {
        position: [Number(ax), +(j * h + (deck.faceDown ? h : 0)).toFixed(6), Number(az)],
        rotation: [0, Number(deck.yaw) || 0, deck.faceDown ? Math.PI : 0],
        scale: 1,
      });
    }
    const deckTitle = deck.name || deckId;
    if (deck.secure && secure) {
      // positions in the deck are its objects in the order they were made; the players' shuffle decides which card each is
      const ids = Object.keys(secretObjects);
      deckDocs[deckId] = {
        "@patchwork": { type: "secure-deck" },
        title: deckTitle,
        group: "rfc3526-2048",
        faces: ids.map((oid) => ({ ...secretObjects[oid] })),
        back: { sourceUrl: backFile.url, name: back.name || "Card", ...(backFile.bounds ? { bounds: copyBounds(backFile.bounds) } : {}) },
        slots: Object.fromEntries(ids.map((oid, k) => [oid, k])),
        phase: "waiting",
        participants: [],
        cards: null,
        epochs: {},
        queue: [],
        op: null,
        shares: {},
      };
    } else {
      deckDocs[deckId] = { "@patchwork": { type: "plain-deck" }, title: deckTitle, objects: secretObjects };
    }
  }

  const seats = {};
  for (const [sid, s] of Object.entries(game?.seats ?? {})) {
    seats[sid] = { name: s?.name || sid, player: null, ...(s?.camera ? { camera: JSON.parse(JSON.stringify(s.camera)) } : {}) };
  }
  // Play only where the table has something to play with: seats, private
  // zones or hidden cards are what start the table extension and so put play
  // on offer. A table with none (Santorini: everything in plain sight, no
  // seats) opens in the editor, with the hand as its tool, rather than
  // claiming a play it can't start ("Starts in: Play" over an editor).
  const playable = Object.keys(seats).length > 0 || Object.values(objects).some((o) => o?.traits?.["tabletop.zone"] || o?.traits?.["tabletop.hidden"]);
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

/** The deck a hidden object names before its doc exists (`deck:<id>`), or null. */
const deckRef = (o) => {
  const by = o?.traits?.["tabletop.hidden"]?.by;
  return typeof by === "string" && by.startsWith(DECK_PREFIX) ? by.slice(DECK_PREFIX.length) : null;
};

/**
 * Write a layout into a scene doc (inside a change, or onto a plain skeleton):
 * its objects and their order, each hidden card naming its deck's url; the
 * seats, only if the scene has none; and the view. Throws, writing nothing,
 * if a deck has no url.
 * @param {object} d  the scene doc (a draft)
 * @param {ReturnType<typeof tableLayout>} layout
 * @param {{ [deckId]: string }} deckUrls  each deck's doc, made already
 */
export function writeTable(d, layout, deckUrls = {}) {
  for (const o of Object.values(layout.objects)) {
    const deckId = deckRef(o);
    if (deckId != null && !deckUrls[deckId]) throw new Error(`no doc for deck “${deckId}”`);
  }
  if (!d.objects) d.objects = {};
  if (!d.order) d.order = [];
  for (const oid of layout.order) {
    const o = JSON.parse(JSON.stringify(layout.objects[oid]));
    const deckId = deckRef(o);
    if (deckId != null) o.traits["tabletop.hidden"] = { by: deckUrls[deckId] };
    d.objects[oid] = o;
    d.order.push(oid);
  }
  if (!d.traits) d.traits = {};
  if (Object.keys(layout.seats ?? {}).length && !d.traits["tabletop.seats"]) d.traits["tabletop.seats"] = JSON.parse(JSON.stringify(layout.seats));
  if (!d.view) d.view = {};
  for (const [k, v] of Object.entries(layout.view ?? {})) d.view[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}
