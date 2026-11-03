// A TTS save → the scene's starting table. Pure, in two steps:
//
//   plan(save, options)                 what goes where, in TTS world space, and
//                                       the distinct kinds to draw (kinds.js)
//   secretsDocs(plan, built)            a scene-secrets doc per hidden deck
//   sceneDoc(plan, built, options)      the `scene` doc (scene/README.md)
//
// `built` maps a kind key to { glbUrl, bounds } once the GLBs exist.
//
// What a table looks like:
//   - every drawn object at its own transform; locked objects locked;
//   - a deck is a group of its cards, stacked where the deck is, top card
//     highest; a face-down deck's cards are hidden objects (below);
//   - a stack (Custom_Tile_Stack, Number > 1) is a group of its copies, stacked;
//   - a bag is drawn, and what is in it is a hidden group laid out in a grid
//     beside it (shown from the outline when wanted; costs nothing until then);
//   - an object's other States are a hidden group where it is;
//   - a table under it all (the mod's table image, if it has one) carrying the
//     mod's free snap points; HandTriggers become seats.
//
// Hidden cards: a face-down card shows only its back (a kind drawn with the
// back on both sides) and is named "Card"; what it really is goes in a
// `scene-secrets` doc, one per TTS deck (and one for loose face-down cards).
// The scene object says which with `hidden: { by: <secrets doc url> }` (see
// hideObject: the one place that knows that shape).

import { convertPosition, convertTransform, readTransform, ttsUp } from "./convert.js";
import { CARD, kindKey, kindOf } from "./kinds.js";
import { walk } from "./tts.js";

const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
const r = (v, p = 5) => +Number(v).toFixed(p);

/** The scene object's hidden-ness: the one function to change if that contract moves. */
export function hideObject(obj, secretsUrl) {
  obj.hidden = { by: secretsUrl };
  return obj;
}

const faceDown = (rotation) => ttsUp(rotation)[1] < 0;

/** Rotation with its tilt squared to the nearest half turn (for things taken out of bags). */
const settle = ([x, y, z]) => [Math.round(x / 180) * 180, y, Math.round(z / 180) * 180];

/**
 * @param {ReturnType<import("./tts.js").readSave>} save
 * @param {{ includeContents?: boolean, includeStates?: boolean, hideFaceDown?: boolean, maxObjects?: number }} [options]
 */
export function plan(save, { includeContents = true, includeStates = true, hideFaceDown = true, maxObjects = 5000 } = {}) {
  let n = 0;
  const id = (prefix) => `${prefix}${(n++).toString(36).padStart(4, "0")}`;
  const objects = []; // placements
  const groups = []; // { id, name, parent, visible }
  const kinds = new Map(); // key → { kind, name, count }
  const counts = { placed: 0, skipped: {}, approximated: {}, hidden: 0 };
  const seats = [];
  const warnings = [];
  let truncated = 0;

  const skip = (node, why) => (counts.skipped[`${node.name || "?"}${why ? ` (${why})` : ""}`] = (counts.skipped[`${node.name || "?"}${why ? ` (${why})` : ""}`] ?? 0) + 1);
  const useKind = (kind, name) => {
    const key = kindKey(kind);
    const k = kinds.get(key);
    if (k) k.count++;
    else kinds.set(key, { kind, name, count: 1 });
    return key;
  };
  const group = (name, parent, visible = true) => {
    const gid = id("g");
    groups.push({ id: gid, name, parent, visible });
    return gid;
  };
  const nameOf = (node, fallback) => node.nickname || fallback || node.name || "Object";

  /**
   * Place one drawable object. `at` = { position, rotation, scale } in TTS world
   * (position[1] = null: rest it on the table), `stackIndex` lifts it.
   */
  const place = (node, at, { parent = null, deck = null, hiddenBy = null, rest = 0, nameFallback } = {}) => {
    if (objects.length >= maxObjects) {
      truncated++;
      return null;
    }
    const scaled = { ...node, transform: { ...node.transform, scaleX: at.scale[0], scaleY: at.scale[1], scaleZ: at.scale[2] } };
    const kind = kindOf(scaled, { deck });
    if (!kind) return null;
    const name = nameOf(node, nameFallback);
    const key = useKind(kind, name);
    if (kind.type === "placeholder") counts.approximated[node.name || "?"] = (counts.approximated[node.name || "?"] ?? 0) + 1;
    if (kind.type === "piece") counts.approximated[node.name] = (counts.approximated[node.name] ?? 0) + 1;
    const p = { id: id("o"), name, key, at, rest, parent, locked: node.locked, pdf: node.kind === "pdf" ? String(node.pdf?.PDFUrl ?? "").trim() || null : null };
    if (hiddenBy && hideFaceDown) {
      const pub = kindOf(scaled, { deck, publicCard: true });
      p.secret = { by: hiddenBy, key, name };
      p.key = useKind(pub, "Card");
      p.name = "Card";
      counts.hidden++;
    }
    objects.push(p);
    counts.placed++;
    return p;
  };

  const tts = (node) => readTransform(node.transform);

  /** A deck at `at`: its cards as a stack in a group. */
  const placeDeck = (deck, at, parent, rest = null) => {
    const cards = deck.contents.filter((c) => c.kind === "card");
    const ids = cards.length ? null : deck.deckIds ?? [];
    const list = cards.length ? cards : ids.map((cid, i) => ({ ...deck, kind: "card", name: "Card", nickname: "", cardId: cid, contents: [], path: `${deck.path}/${i}` }));
    if (!list.length) return skip(deck, "empty");
    const gid = group(`${nameOf(deck, "Deck")} (${list.length})`, parent);
    const down = faceDown(at.rotation);
    const hiddenBy = down ? `deck:${deck.path}` : null;
    const t = CARD.t * at.scale[1];
    list.forEach((card, i) => {
      // ContainedObjects[0] is the top card
      const lift = (list.length - 1 - i) * t;
      const position = rest == null ? [at.position[0], at.position[1] - ((list.length - 1) * t) / 2 + lift, at.position[2]] : [at.position[0], null, at.position[2]];
      place({ ...card, locked: false }, { position, rotation: at.rotation, scale: at.scale }, { parent: gid, deck, hiddenBy, rest: rest == null ? 0 : rest + lift, nameFallback: "Card" });
    });
    for (const c of deck.contents) if (c.kind !== "card") skip(c, "in a deck");
  };

  /** Something taken out of a bag (or another state): laid at `cell`, resting on the table. */
  const placeLoose = (node, cell, parent) => {
    const own = tts(node);
    const at = { position: [cell[0], null, cell[2]], rotation: settle(own.rotation), scale: own.scale };
    placeNode(node, at, parent, 0);
  };

  /** Any node at a TTS world pose. `rest` != null: rest it on the table, that far up. */
  const placeNode = (node, at, parent, rest = null) => {
    switch (node.kind) {
      case "deck":
        return placeDeck(node, at, parent, rest);
      case "zone":
        if (node.name === "HandTrigger" && node.handColor) seats.push({ color: node.handColor, position: at.position, rotation: at.rotation });
        return skip(node, node.name === "HandTrigger" ? "a seat" : null);
      default: {
        const count = node.number > 1 && /_Stack$/.test(node.name) ? node.number : 1;
        let target = parent;
        if (count > 1) target = group(`${nameOf(node)} (${count})`, parent);
        let p = null;
        const step = node.kind === "tile" || node.kind === "token" ? (Number((node.image?.CustomTile ?? node.image?.CustomToken)?.Thickness) || 0.2) * at.scale[1] : 0.5 * at.scale[1];
        for (let i = 0; i < count; i++) {
          const position = rest == null ? [at.position[0], at.position[1] + i * step, at.position[2]] : [at.position[0], null, at.position[2]];
          p = place(node, { ...at, position }, { parent: target, rest: rest == null ? 0 : rest + i * step }) ?? p;
          if (!p) {
            if (i === 0 && node.kind !== "deck") skip(node, objects.length >= maxObjects ? "over the limit" : "not drawn");
            break;
          }
        }
        if (p) placeChildren(node, at, parent, p);
        return p;
      }
    }
  };

  /** A bag's contents and an object's other states, as hidden groups beside / at it. */
  const placeChildren = (node, at, parent, placed) => {
    if (includeContents && node.contents.length && node.kind !== "deck") {
      const gid = group(`${nameOf(node)}: contents (${node.contents.length})`, parent, false);
      const cols = Math.ceil(Math.sqrt(node.contents.length));
      node.contents.forEach((c, i) => {
        const cell = [at.position[0] + 3 + (i % cols) * 3.4, 0, at.position[2] - Math.floor(i / cols) * 3.6];
        placeLoose(c, cell, gid);
      });
    }
    if (includeStates && node.states.length) {
      const gid = group(`${nameOf(node)}: other states (${node.states.length})`, parent, false);
      for (const s of node.states) placeNode(s, { ...at, scale: tts(s).scale }, gid, null);
    }
    for (const c of node.children) placeNode(c, tts(c), parent, null);
    void placed;
  };

  for (const node of save.objects) {
    const at = tts(node);
    if (node.kind === "card") {
      // a lone card; face down, it is hidden like a deck's
      const hiddenBy = faceDown(at.rotation) ? "loose" : null;
      place(node, at, { hiddenBy });
      continue;
    }
    placeNode(node, at, null, null);
  }
  if (truncated) warnings.push(`stopped at ${maxObjects} objects: ${truncated} more were left out`);
  for (const { node } of walk(save.objects)) if (node.mesh?.NormalURL) {
    warnings.push("normal maps (NormalURL) are not used");
    break;
  }

  return { title: save.saveName, objects, groups, kinds, counts, seats, warnings, snapPoints: save.snapPoints, tableURL: save.tableURL, table: save.table };
}

/** Distinct hidden groups: [{ key, name }]. */
export function secretKeys(p) {
  const seen = new Map();
  for (const o of p.objects) if (o.secret && !seen.has(o.secret.by)) seen.set(o.secret.by, o.secret.by === "loose" ? "Face-down cards" : (p.groups.find((g) => p.objects.some((x) => x.parent === g.id && x.secret?.by === o.secret.by))?.name ?? "Deck"));
  return [...seen].map(([key, name]) => ({ key, name }));
}

/** The scene-secrets docs: [{ key, doc }], to create before the scene. */
export function secretsDocs(p, built, { title = p.title } = {}) {
  return secretKeys(p).map(({ key, name }) => {
    const objects = {};
    for (const o of p.objects)
      if (o.secret?.by === key) {
        const glb = built.get(o.secret.key)?.glbUrl;
        if (glb) objects[o.id] = { sourceUrl: glb, name: o.secret.name };
      }
    return { key, doc: { "@patchwork": { type: "scene-secrets" }, title: `${title}: ${name}`, objects } };
  });
}

/**
 * Where the table top is in TTS y: the commonest resting height of the
 * top-level objects that lie flat (bottom of their box), else 0.96 (TTS's
 * usual tables). Ignores things stored far below or above.
 */
export function tableHeight(p, built, unit) {
  const bins = new Map();
  for (const o of p.objects) {
    if (o.at.position[1] == null || o.parent != null) continue;
    const b = built.get(o.key)?.bounds;
    if (!b) continue;
    const up = ttsUp(o.at.rotation);
    if (Math.abs(up[1]) < 0.99) continue;
    const bottom = o.at.position[1] + (up[1] > 0 ? b.min[1] : -b.max[1]) / unit;
    if (bottom < -2 || bottom > 10) continue;
    const k = Math.round(bottom / 0.05);
    const bin = bins.get(k) ?? { n: 0, min: Infinity };
    bin.n++;
    bin.min = Math.min(bin.min, bottom);
    bins.set(k, bin);
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return best ? r(best.min, 4) : 0.96;
}

const percentile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** The table's extent in TTS x/z: where most top-level things are, plus a margin. */
export function tableExtent(p) {
  const xs = [], zs = [];
  for (const o of p.objects)
    if (o.parent == null || p.groups.find((g) => g.id === o.parent)?.visible) {
      if (o.at.position[1] == null) continue;
      xs.push(o.at.position[0]);
      zs.push(o.at.position[2]);
    }
  if (!xs.length) return { cx: 0, cz: 0, hx: 20, hz: 15 };
  const x0 = percentile(xs, 0.03), x1 = percentile(xs, 0.97), z0 = percentile(zs, 0.03), z1 = percentile(zs, 0.97);
  return { cx: r((x0 + x1) / 2, 3), cz: r((z0 + z1) / 2, 3), hx: r(Math.max(10, (x1 - x0) / 2 + 6), 3), hz: r(Math.max(8, (z1 - z0) / 2 + 6), 3) };
}

/** The table's kind (drawn like a board: kinds/build "table"). */
export function tableKind(p, extent) {
  return {
    type: "table",
    scale: [1, 1, 1],
    hx: extent.hx,
    hz: extent.hz,
    image: p.tableURL || null,
    snaps: (p.snapPoints ?? []).map((s) => ({ position: [r(s.position[0] - extent.cx, 4), 0, r(s.position[2] - extent.cz, 4)], yaw: s.rotation ? r(s.rotation[1], 4) : null })),
  };
}

/**
 * The scene doc.
 * @param {object} p           plan()
 * @param {Map} built          kind key → { glbUrl, bounds }
 * @returns {{ scene: object, stats: { tableY: number, skipped: number } }}
 * @param {{ unit: number, infoUrl?: string, infoToolId?: string, title?: string,
 *           secretUrls?: Map<string, string>, pdfUrls?: Map<string, string>,
 *           table?: { key: string, extent } }} o
 */
export function sceneDoc(p, built, { unit, infoUrl = null, infoToolId = null, title = p.title, secretUrls = new Map(), pdfUrls = new Map(), table = null }) {
  const tableY = tableHeight(p, built, unit);
  const objects = {};
  const order = [];
  const base = (name, parent, visible = true) => ({ name, parent, visible, color: null, opacity: 1, wireframe: false });
  for (const g of p.groups) {
    objects[g.id] = { ...base(g.name, g.parent, g.visible), kind: "group", sourceUrl: null, providerId: null, renderUrl: null, transform: IDENTITY() };
    order.push(g.id);
  }
  if (table) {
    const b = built.get(table.key);
    if (b?.glbUrl) {
      const tid = "table";
      objects[tid] = {
        ...base("Table", null),
        sourceUrl: b.glbUrl,
        providerId: "file-glb",
        renderUrl: null,
        transform: { position: convertPosition([table.extent.cx, tableY, table.extent.cz], { unit, tableY }), rotation: [0, 0, 0], scale: 1 },
        locked: true,
        ...(infoUrl ? { infoUrl, ...(infoToolId ? { infoToolId } : {}) } : {}),
        ...(b.bounds ? { hint: { bounds: b.bounds } } : {}),
      };
      order.unshift(tid);
    }
  }
  let skipped = 0;
  for (const o of p.objects) {
    const b = built.get(o.key);
    if (!b?.glbUrl) {
      skipped++;
      continue;
    }
    let at = o.at;
    if (at.position[1] == null) {
      // resting on the table: its box's bottom (after its rotation) at the table top, then `rest` up
      const up = ttsUp(at.rotation);
      const lift = b.bounds ? (up[1] >= 0 ? -b.bounds.min[1] : b.bounds.max[1]) / unit : 0;
      at = { ...at, position: [at.position[0], tableY + lift + (o.rest ?? 0), at.position[2]] };
    }
    const transform = convertTransform({ posX: at.position[0], posY: at.position[1], posZ: at.position[2], rotX: at.rotation[0], rotY: at.rotation[1], rotZ: at.rotation[2] }, { unit, tableY });
    const info = o.pdf && pdfUrls.get(o.pdf) ? { infoUrl: pdfUrls.get(o.pdf) } : infoUrl ? { infoUrl, ...(infoToolId ? { infoToolId } : {}) } : {};
    const obj = {
      ...base(o.name, o.parent),
      sourceUrl: b.glbUrl,
      providerId: "file-glb",
      renderUrl: null,
      transform,
      ...info,
      ...(o.locked ? { locked: true } : {}),
      ...(b.bounds ? { hint: { bounds: b.bounds } } : {}),
    };
    if (o.secret && secretUrls.get(o.secret.by)) hideObject(obj, secretUrls.get(o.secret.by));
    objects[o.id] = obj;
    order.push(o.id);
  }

  // seats from the hands; each looks at the table from its hand, a little back and up
  const ext = table?.extent ?? tableExtent(p);
  const seats = {};
  for (const s of p.seats) {
    const sid = String(s.color).toLowerCase();
    if (seats[sid]) continue;
    const dx = s.position[0] - ext.cx, dz = s.position[2] - ext.cz;
    const len = Math.hypot(dx, dz) || 1;
    const eye = [s.position[0] + (dx / len) * 6, tableY + 28, s.position[2] + (dz / len) * 6];
    const target = [s.position[0] - (dx / len) * 14, tableY, s.position[2] - (dz / len) * 14];
    seats[sid] = { name: s.color, player: null, camera: { position: convertPosition(eye, { unit, tableY }), target: convertPosition(target, { unit, tableY }) } };
  }
  const span = Math.max(ext.hx, ext.hz) * unit;
  const centre = convertPosition([ext.cx, tableY, ext.cz], { unit, tableY });
  const scene = {
    "@patchwork": { type: "scene" },
    title,
    objects,
    order,
    dimensions: {},
    view: { units: "cm", grid: false, axes: false, bounds: false, snap: true, defaultGizmo: "hand" },
    camera: { position: [centre[0], r(span * 1.1), r(centre[2] + span * 1.0)], target: centre },
    ...(Object.keys(seats).length ? { seats } : {}),
  };
  return { scene, stats: { tableY, skipped } };
}
