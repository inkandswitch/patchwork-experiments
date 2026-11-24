// For the probe pages: a Lost Cities table set up as the game page does
// (src/tool.js setUpTable), and how a probe reads what several packages put
// in the scene. A probe is where the packages meet, so unlike any package it
// names them all: the seats package's seats, tabletop's hands and cards, and
// the keepers' bindings.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { emptyScene } from "../src/empty-scene.js";
import lostCities from "../games/lost-cities.json" with { type: "json" };
import { pieceDrawer } from "../src/pieces.js";
import { kindsLaid, tableLayout, writeTable } from "../src/setup.js";
import { prepareTable } from "../src/table/made-with.js";
import { TabletopGameDatatype } from "../src/datatype.js";
import { gameOf, writeGame } from "../src/game.js";

/** The stub registry, as a drop context's `registry`. */
export const registry = async (type) => getRegistry(type);

/** The URLs the three packages are published at (src/scene-package.js PUBLISHED): where a viewer who has them got them. */
const FROM = { scene: "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F", seats: "automerge:2rZNSyrVf5YKPTGLAHuqso4BxoXJ", tabletop: "automerge:3uPxcveQxJkJ6D2GKPnrS7uTh2h2" };

/**
 * Register every plugin of these built packages (each `…/dist/index.js`) as a
 * viewer who has them installed does: from the package's URL, so the scene
 * (which lists the packages a table is made from) has nothing to ask about.
 */
export async function install(urls) {
  for (const url of urls) {
    const { plugins } = await import(url);
    const from = url.includes("scene/dist") ? FROM.scene : url.includes("seats/dist") ? FROM.seats : FROM.tabletop;
    for (const p of plugins) getRegistry(p.type).register(p, from);
  }
}

/**
 * The game page's table: the game (games/lost-cities.json) in a game doc, its
 * GLBs, each container from its keeper (`secure: false`: the plain one), the
 * seats from their owner, then the scene.
 * @returns {Promise<{ game, scene, deckUrl: string, kinds: object }>}
 */
export async function lostCitiesTable(repo, { title = "Probe table", secure = true, edit = null } = {}) {
  const init = { "@patchwork": { type: "tabletop-game" } };
  TabletopGameDatatype.init(init);
  const game = repo.add(init);
  game.change((d) => {
    writeGame(d, lostCities);
    if (!secure) delete d.setup.find((t) => t.deck).deck.secure;
    edit?.(d);
  });
  // as the game page sets a table up: what it lays out drawn now, each card's face when it's first shown
  await pieceDrawer({ repo, handle: game }).ensure(kindsLaid(gameOf(game.doc())));
  const g = game.doc();
  const fileOf = (k) => (g.drawn?.[k]?.url ? { url: g.drawn[k].url, hint: g.drawn[k].bounds ? { bounds: g.drawn[k].bounds } : null } : null);
  const layout = tableLayout(gameOf(g), { fileOf, faceOf: (kind) => ({ game: game.url, kind }), gameUrl: game.url });
  const made = await prepareTable({ repo, registry }, layout);
  const table = emptyScene({ title });
  writeTable(table, layout, made);
  const scene = repo.add(table);
  return { game, scene, layout, kinds: made.kinds, deckUrl: deckUrlOf(table.objects) };
}

// ── reading the scene ──
export const SEATS = "seats";
export const seatClaim = (sid) => `seat:${sid}`;
export const PICKER = ".seats-pick";
export const SEAT_TAG = ".label.seat-tag";
export const seatsOf = (doc) => doc?.traits?.[SEATS] ?? {};
export const isCard = (o) => !!o?.traits?.["tabletop.card"];
/** A kept object's binding, whichever keeper keeps it: { trait, by, slot } | null. */
export function kept(o) {
  for (const [trait, v] of Object.entries(o?.traits ?? {})) if (v && typeof v === "object" && typeof v.by === "string" && Number.isInteger(v.slot)) return { trait, by: v.by, slot: v.slot };
  return null;
}
export const cardIds = (objects) => Object.keys(objects).filter((id) => isCard(objects[id]));
export const deckUrlOf = (objects) => Object.values(objects).map((o) => kept(o)?.by).find(Boolean) ?? null;

/**
 * What a view shows a card as, from the stage's merged looks: "face" (a
 * look with a source: what it really is), "veil" (the stage's stand-in:
 * kept from you), or "back" (no look: the object's own).
 */
export function shownAs(dbg, id) {
  // the veil is bytes with no name; a face drawn here, before its doc is kept, is bytes with its name (pieces.js)
  const l = new Map([...(dbg?.displayed() ?? [])].map(([i, o]) => [i, o.content instanceof Uint8Array && !o.name ? { veil: true } : { name: o.name, sourceUrl: o.content }])).get(id);
  if (!l) return "back";
  if (l.veil === true) return "veil";
  return l.sourceUrl ? "face" : "back";
}

/**
 * What a view has really drawn for an object, from its three.js content:
 * "veil" when it is the stage's veil mesh, else the content's mesh names
 * joined (a card's face or back), or null before anything is drawn.
 */
export function drawnAs(dbg, id) {
  const root = dbg?.viewport?.contentOf(id)?.root;
  if (!root) return null;
  const names = new Set();
  root.traverse((o) => o.isMesh && names.add(o.name || o.parent?.name || ""));
  if (names.has("veil") || [...names].some((n) => /^veil/.test(n))) return "veil";
  return [...names].sort().join(",");
}
