// A game → a fresh `scene` doc with every piece where it starts, and a doc
// for each of its decks. Pure. The scene doc's shape is the scene package's
// (scene/README.md, "scene — the composition"), with this package's traits
// on it (src/table/visibility.js); this package only writes it, it never
// imports the scene.
//
// - Each visible piece kind with more than one copy gets a group, so the
//   outline stays short; a single piece (the board) sits at the top level.
// - Every copy is a passthrough object showing the kind's GLB file doc, with
//   the game as its About (infoUrl), and the kind's box as its load hint.
// - Hidden kinds (`hidden: true`) go into their deck: shuffled together, dealt
//   onto the snap points of the pieces the deck deals to, the rest stacked.
//   In the scene each is its `back` piece (name, GLB, box) with the trait
//   tabletop.hidden: { by: <its deck's doc> }: which card it really is goes only in that doc,
//   and ids follow deck order, so nothing in the scene says which is which.
// - Each deck is a doc of its own, so a table has as many as the game does:
//   a `plain-deck` doc, or for a `secure` deck a `secure-deck` (the
//   card-table package's; card-table/README.md), which lists the cards and
//   which object is which position, and which the seated players shuffle
//   between them so that nobody knows the order.
// - A piece with a `zone` makes its copy a seat's private area (trait tabletop.zone).
// - The game's seats become the scene's (trait tabletop.seats).
// - The scene opens in the hand, with snapping on, the grid and axes off, and
//   the Table panel first.


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

/**
 * @param {object} game     the tabletop-game doc; every piece must have its glbUrl
 * @param {string} gameUrl
 * @param {{ newId?: (prefix: string) => string, title?: string, rng?: () => number }} [o]
 * @returns {{ scene: object, decks: { [deckId]: object } }} docs ready for repo.create2:
 *   create each deck, then pass their urls to linkDecks(scene, urls) before creating the scene
 */
export function tableScene(game, gameUrl, { newId, title, rng = Math.random } = {}) {
  let n = 0;
  const id = newId ?? ((prefix) => `${prefix}${(n++).toString(36).padStart(4, "0")}`);
  const objects = {};
  const order = [];
  const deckDocs = {};
  const pieces = game?.pieces ?? {};
  // every piece is filed in a group (or none), never attached to another
  const base = (name, group) => ({ name, parent: null, group, visible: true, color: null, opacity: 1, wireframe: false });
  const drawn = (kind) => {
    const p = pieces[kind];
    if (!p?.glbUrl) throw new Error(`“${p?.name || kind}” has no GLB yet`);
    return p;
  };
  const group = (name) => {
    const gid = id("g");
    objects[gid] = { kind: "group", name, group: null, visible: true, opacity: 1 };
    order.push(gid);
    return gid;
  };
  const place = (piece, { name, parent, transform }) => {
    const oid = id("o");
    objects[oid] = {
      ...base(name, parent),
      sourceUrl: piece.glbUrl,
      providerId: "file-glb",
      renderUrl: null,
      transform,
      infoUrl: gameUrl,
      infoToolId: "tabletop-game",
      ...(piece.locked ? { locked: true } : {}),
      ...(piece.bounds ? { hint: { bounds: { min: [...piece.bounds.min], max: [...piece.bounds.max] } } } : {}),
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
      const oid = place(piece, {
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
    drawn(backKind);
    for (const k of cards) drawn(k);
    const parent = group(`${deck.name || deckId} (${cards.length})`);
    const shuffled = shuffle(cards, rng);
    const secretObjects = {};
    const card = (kind, transform) => {
      const oid = place(back, { name: back.name || "Card", parent, transform });
      objects[oid].traits = { "tabletop.hidden": { by: `${DECK_PREFIX}${deckId}` } };
      secretObjects[oid] = { sourceUrl: pieces[kind].glbUrl, name: pieces[kind].name || kind };
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
    const h = Number(back.bounds?.max?.[1]) || 0;
    const [ax, az] = deck.at ?? [0, 0];
    for (let j = 0; next < shuffled.length; j++) {
      card(shuffled[next++], {
        position: [Number(ax), +(j * h + (deck.faceDown ? h : 0)).toFixed(6), Number(az)],
        rotation: [0, Number(deck.yaw) || 0, deck.faceDown ? Math.PI : 0],
        scale: 1,
      });
    }
    const deckTitle = deck.name || deckId;
    if (deck.secure) {
      // positions in the deck are its objects in the order they were made; the players' shuffle decides which card each is
      const ids = Object.keys(secretObjects);
      deckDocs[deckId] = {
        "@patchwork": { type: "secure-deck" },
        title: deckTitle,
        group: "rfc3526-2048",
        faces: ids.map((oid) => ({ ...secretObjects[oid] })),
        back: { sourceUrl: back.glbUrl, name: back.name || "Card", ...(back.bounds ? { bounds: { min: [...back.bounds.min], max: [...back.bounds.max] } } : {}) },
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
  const name = title ?? `${game?.title || "Game"} table`;
  return {
    scene: {
      "@patchwork": { type: "scene" },
      title: name,
      objects,
      order,
      dimensions: {},
      view: { units: "cm", grid: false, axes: false, bounds: false, snap: true, defaultMode: "hand", panels: ["tabletop.table", "inspector"] },
      camera: game?.camera ? JSON.parse(JSON.stringify(game.camera)) : { position: [0, 0.72, 0.6], target: [0, 0, -0.04] },
      ...(Object.keys(seats).length ? { traits: { "tabletop.seats": seats } } : {}),
    },
    decks: deckDocs,
  };
}

const DECK_PREFIX = "deck:";

/** Point each hidden object at its deck's doc, now that the decks exist (in place; returns the scene). */
export function linkDecks(scene, urls) {
  for (const o of Object.values(scene.objects)) {
    const by = o.traits?.["tabletop.hidden"]?.by;
    if (typeof by === "string" && by.startsWith(DECK_PREFIX)) {
      const url = urls[by.slice(DECK_PREFIX.length)];
      if (!url) throw new Error(`no doc for deck “${by.slice(DECK_PREFIX.length)}”`);
      o.traits["tabletop.hidden"] = { by: url };
    }
  }
  return scene;
}
