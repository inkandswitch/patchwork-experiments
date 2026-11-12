// For the probe pages: a Lost Cities table set up as the game page does
// (src/tool.js setUpTable), and how a probe reads what several packages put
// in the scene. A probe is where the packages meet, so unlike any package it
// names them all: the scene's seats, tabletop's hands and cards, and the
// keepers' bindings.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { emptyScene } from "../src/empty-scene.js";
import { fill } from "../src/games/lost-cities.js";
import { ensurePieceGLBs } from "../src/pieces.js";
import { tableLayout, writeTable } from "../src/setup.js";
import { containDecks, findSeats } from "../src/table/made-with.js";

/** The stub registry, as a drop context's `registry`. */
export const registry = async (type) => getRegistry(type);

/** Register every plugin of these built packages (each `…/dist/index.js`), optionally as from a package URL. */
export async function install(urls) {
  for (const url of urls) {
    const { plugins } = await import(url);
    for (const p of plugins) getRegistry(p.type).register(p);
  }
}

/**
 * The game page's table: the game's GLBs, each deck's container from a
 * keeper found in the registry (`secure: false` asks for a plain one), the
 * seats from their owner, then the scene.
 * @returns {Promise<{ game, scene, deckUrl: string, kinds: object }>}
 */
export async function lostCitiesTable(repo, { title = "Probe table", secure = true, edit = null } = {}) {
  const game = repo.add({ "@patchwork": { type: "tabletop-game" }, title: "Lost Cities", about: "", pieces: {}, order: [], tables: [] });
  game.change((d) => {
    fill(d);
    if (!secure) d.decks.main.secure = false;
    edit?.(d);
  });
  await ensurePieceGLBs(repo, game);
  const g = game.doc();
  const fileOf = (k) => (g.pieces[k]?.glbUrl ? { url: g.pieces[k].glbUrl, hint: g.pieces[k].bounds ? { bounds: g.pieces[k].bounds } : null } : null);
  const layout = tableLayout(g, { fileOf, gameUrl: game.url });
  const { binds, kinds } = await containDecks({ repo, registry }, layout.decks, (deck) => `${title}: ${deck.title}`);
  const lay = await findSeats(registry);
  const table = emptyScene({ title });
  writeTable(table, layout, binds, { seats: lay });
  const scene = repo.add(table);
  return { game, scene, layout, kinds, deckUrl: deckUrlOf(table.objects) };
}

// ── reading the scene ──
export const SEATS = "scene.seats";
export const seatClaim = (sid) => `scene.seat:${sid}`;
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
  const l = dbg?.looks()?.get(id);
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
