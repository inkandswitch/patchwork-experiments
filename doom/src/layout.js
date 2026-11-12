// A .wad file doc dropped into a scene: its first map, laid out as references
// into that one file doc (STAGE.md, "Drops"). Nothing is copied out of the
// WAD; each object is the same file doc seen through the map provider with
// params of its own, so the scene is rebuilt from the WAD and its params:
//
//   group "<map>"            its About: what was made, what doesn't work here, the WAD's notice
//   └ <map>                  { map, door: null }, locked
//     ├ Door <sector> × n    { map, door: <sector> }, locked; a slide joint (joints.slide) that opens it
//     └ Spawn point          arena's, at the player 1 start (only when the map is the scene: below)
//
// Doors are attached to the static part, so moving or resizing the map
// moves and resizes them (the stage composes a parent's transform into its
// children's), and a door's slide is along its parent's up, in its frame.
//
// Dropped into an EMPTY scene, the map is the scene: it becomes a walkable
// level (arena.level, with just a sky), and the player 1 start an arena
// spawn point, made by the arena's own part ("arena.spawn", looked up in the
// registry by id). Dropped into a scene that has something in it already, it
// is a piece of that scene, and leaves the scene's game, if any, to it.
//
// The doom package depends on neither joints nor arena: it writes the slide
// in the shape joints documents and the level trait in the shape arena
// documents, and asks for arena's spawn part by id; without arena, there is
// no spawn (and no level to spawn in), which is nothing lost.

import { freedoomVersion, noticeOf, originOf } from "./freedoom.js";
import { anchorOf, mapModel, thingAt, UNITS_PER_METRE } from "./parts.js";
import { wadOf } from "./source.js";

export const PROVIDER = "doom-map";
/** The part that makes a spawn point (arena's), by id. */
export const SPAWN_PART = "arena.spawn";

/** A part's place in its parent's frame (metres, Y up), from the two anchors (map units). */
export function placeIn(parentAnchor, anchor) {
  const k = UNITS_PER_METRE;
  return [(anchor[0] - parentAnchor[0]) / k, (anchor[2] - parentAnchor[2]) / k, -(anchor[1] - parentAnchor[1]) / k];
}

/** A Doom angle (degrees, 0 east, counter-clockwise) as a turn about +Y that faces an object's -z that way. */
export const yawOf = (angle) => ((angle - 90) * Math.PI) / 180;

/** The slide that opens a door: up its parent's +Y by its travel, at its speed, closing itself after its wait (joints.slide). */
export function slideOf(door) {
  return {
    axis: [0, 1, 0],
    stops: { closed: 0, open: round((door.open - door.closed) / UNITS_PER_METRE) },
    speed: round(door.speed / UNITS_PER_METRE),
    ...(door.wait != null ? { wait: round(door.wait) } : {}),
    at: "closed",
  };
}
const round = (x) => Math.round(x * 1e6) / 1e6;

/** What the About document says (markdown). `freedoom`: the Freedoom release the WAD says it is, or null. */
export function aboutText({ fileName, map, model, origin, freedoom = null, start = false }) {
  const { specials } = model;
  const doors = specials.doors.map((d) => d.sector);
  const ajar = specials.doors.filter((d) => d.ajar > 0);
  const notice = noticeOf(origin);
  const lines = [
    `# ${map}`,
    "",
    `Map ${map} of ${fileName}, laid out by the doom package as references into that one WAD file document: each object is the WAD seen with params of its own (the map, and which door), and is rebuilt from it.`,
    "",
    "- **The map**: everything that doesn't move.",
    `- **${doors.length} door${doors.length === 1 ? "" : "s"}** (sector${doors.length === 1 ? "" : "s"} ${doors.join(", ")}): each slides up when opened and closes itself after its wait.`,
    ...(ajar.length ? [`  ${ajar.map((d) => `Sector ${d.sector}`).join(", ")} ${ajar.length === 1 ? "is" : "are"} left ajar in the map, and imported shut.`] : []),
    start ? "- **Player 1 start**: a spawn point, where play starts." : "- No spawn point: the player 1 start is only made one in a scene that is just this map.",
    "",
    "## Not working here",
    "",
  ];
  if (specials.resting.length) lines.push(...specials.resting.map((r) => `- ${cap(r.kind)}: sector${r.sectors.length === 1 ? "" : "s"} ${r.sectors.join(", ")} (line${r.lines.length === 1 ? "" : "s"} ${r.lines.join(", ") || "none"}), imported where ${r.sectors.length === 1 ? "it rests" : "they rest"}.`));
  if (specials.inert.length) lines.push(...specials.inert.map((r) => `- ${cap(r.kind)}: line${r.lines.length === 1 ? "" : "s"} ${r.lines.join(", ")}, not imported.`));
  const things = model.map.things.length - (start ? 1 : 0);
  lines.push(`- Things: ${things} (monsters, items, decorations${start ? ", the other starts" : ""}), not imported.`);
  lines.push("", "## Where it comes from", "");
  if (origin?.name || origin?.urls?.length) lines.push(`${origin.name ?? fileName}${origin.urls?.length ? `: ${origin.urls.join(", ")}` : ""}`, "");
  if (notice) lines.push("```", notice.trim(), "```", "");
  else if (freedoom) lines.push(`${fileName} says it is Freedoom ${freedoom}, whose terms ship beside it in its release (COPYING.txt) and aren't known here: check them, and add them to the WAD's document as \`origin.notice\`, before sharing this scene.`, "");
  else lines.push(`${fileName} says nothing of its licence: check it before sharing this scene.`, "");
  if (freedoom) lines.push("This scene is made from Freedoom's data. It is not Freedoom, and neither the Freedoom project nor its contributors endorse it.", "");
  return lines.join("\n");
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * Lay out a WAD's first map in a scene (the drop context's api).
 * @param {object} ctx   the drop context (STAGE.md): repo, change, newId, addObject, registry, doc, notify
 * @param {{ url: string, doc: object, handle: object, group?: string | null, at?: { point } | null }} info
 * @returns {Promise<string | null>} the static part's id
 */
export async function layOutMap(ctx, { url, doc, handle, group = null, at = null }) {
  const wad = wadOf(doc);
  const map = wad.maps[0];
  if (!map) throw new Error("this WAD has no maps");
  const model = mapModel(wad, map);
  const fileName = String(doc.name ?? "the WAD");
  // the map is the scene when the scene was empty: then it is a level, with a spawn
  const alone = Object.keys(ctx.doc?.()?.objects ?? {}).length === 0;

  // where it comes from: what the doc says, else a Freedoom release's terms;
  // a notice found goes on the file doc too, so every place it's shared carries it
  const origin = originOf(doc, wad);
  if (!doc.origin && noticeOf(origin)) {
    handle?.change?.((d) => {
      if (!d.origin) d.origin = origin;
    });
  }
  const start = alone ? model.specials.starts.find((s) => s.player === 1) : null;
  const spawnPart = start ? await partOf(ctx, SPAWN_PART) : null;

  const about = await ctx.repo.create2({ "@patchwork": { type: "markdown" }, content: aboutText({ fileName, map, model, origin, freedoom: freedoomVersion(wad), start: !!spawnPart }) });
  const gid = ctx.newId("g");
  ctx.change((d) => {
    d.objects[gid] = { kind: "group", name: map, group: group ?? null, visible: true, opacity: 1, infoUrl: about.url };
    d.order.push(gid);
    if (!alone) return;
    if (!d.traits) d.traits = {};
    // a level to walk, under a sky of its own (its light is baked in)
    if (!d.traits["arena.level"]) d.traits["arena.level"] = { look: "sky" };
  });

  const render = (door) => ({ providerId: PROVIDER, params: { map, door } });
  const origin0 = anchorOf(model, null);
  const p = Array.isArray(at?.point) ? at.point.map(Number) : [0, 0, 0];
  const root = await ctx.addObject(url, { name: map, group: gid, render: render(null), transform: { position: p, rotation: [0, 0, 0], scale: 1 }, fields: { locked: true } });
  for (const door of model.specials.doors) {
    await ctx.addObject(url, {
      name: `Door ${door.sector}`,
      group: gid,
      parent: root,
      render: render(door.sector),
      transform: { position: placeIn(origin0, anchorOf(model, door.sector)), rotation: [0, 0, 0], scale: 1 },
      fields: { locked: true, traits: { "joints.slide": slideOf(door) } },
    });
  }
  if (spawnPart) {
    const thing = model.map.things[start.thing];
    const transform = { position: placeIn(origin0, thingAt(model, start.thing)), rotation: [0, yawOf(thing.angle), 0], scale: 1 };
    // arena's spawn point, as its part puts one: under the map (in its group), facing the way the start does
    await spawnPart.create(ctx, { parent: root, transform });
  }
  return root;
}

/** A scene:part's module by id, from the registry (late-bound: null when it isn't installed). */
async function partOf(ctx, id) {
  try {
    const reg = await ctx.registry?.("scene:part");
    const loaded = await reg?.load?.(id);
    const mod = loaded?.module?.default ?? loaded?.module;
    return typeof mod?.create === "function" ? mod : null;
  } catch {
    return null;
  }
}

/** A dropped doc is ours when it's a file whose name or extension says .wad. */
export const isWad = (doc) => doc?.["@patchwork"]?.type === "file" && (String(doc.extension ?? "").toLowerCase() === "wad" || /\.wad$/i.test(String(doc.name ?? "")));
