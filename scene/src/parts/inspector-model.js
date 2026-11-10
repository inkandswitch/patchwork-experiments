// scene.inspector's pure side: what the panel shows, worked out from the
// stage's snapshot (api.scene()) and a few lookups passed in. No DOM, no api.

import { groupChain, groupTargets, inheritedDisplay, isGroup, outlineParents } from "../groups.js";
import { attachTargets, treeOrder } from "../hierarchy.js";
import { parseAutomergeUrl } from "../dnd.js";

export const DEG = 180 / Math.PI;
const NBSP = " ";

/** A GLB shown as it is (no render doc). */
export const isPassthrough = (o) => !!o && !isGroup(o) && !o.renderUrl && !!o.sourceUrl;

/** An infoUrl / sourceUrl that is really an automerge URL, else null. */
export function docUrl(v) {
  return typeof v === "string" && v.startsWith("automerge:") ? parseAutomergeUrl(v) : null;
}

/**
 * What the About section shows (README.md, "Using it"): the object's own infoUrl, else the
 * nearest group's, labelled with that group's name; null when neither has one.
 * @param {{ objects: object, groups: Map }} scene
 * @returns {{ url: string, toolId: string | null, label: string, from: string } | null}
 */
export function aboutFor(scene, id) {
  const objects = scene?.objects ?? {};
  const o = objects[id];
  if (!o) return null;
  const own = docUrl(o.infoUrl);
  if (own) return { url: own, toolId: o.infoToolId || null, label: "About", from: id };
  for (const p of groupChain(scene.groups ?? new Map(), id)) {
    const g = objects[p];
    const u = docUrl(g?.infoUrl);
    if (u) return { url: u, toolId: g.infoToolId || null, label: `About ${g.name || "group"}`, from: p };
  }
  return null;
}

/** The outline's tree order for a snapshot: [{ id, depth }]. */
export function outlineTree(scene) {
  const objects = scene?.objects ?? {};
  const outline = outlineParents(objects, scene.parents, scene.groups);
  return treeOrder(objects, scene.ids ?? Object.keys(objects), outline);
}

/**
 * "In group": the groups `id` can be filed in, as a tree (outline order,
 * indented by depth with no-break spaces); a group can't go in itself.
 * @returns {[string, string][]} [group id, label]
 */
export function groupOptions(scene, id) {
  const objects = scene?.objects ?? {};
  const o = objects[id];
  const allowed = new Set(isGroup(o) ? groupTargets(objects, id, scene.groups) : Object.keys(objects).filter((x) => isGroup(objects[x])));
  return outlineTree(scene)
    .filter(({ id: g }) => allowed.has(g))
    .map(({ id: g }) => [g, `${NBSP.repeat(Math.min(groupChain(scene.groups, g).length, 8))}${objects[g].name || "Group"}`]);
}

/**
 * "Attached to": every object `id` could be attached to (not itself, nothing
 * attached to it, no group), in attachment-tree order.
 * @param {(id: string) => string | null} nameOf  what this viewer sees
 * @returns {[string, string][]} [object id, label]
 */
export function attachOptions(scene, id, nameOf = (x) => scene?.objects?.[x]?.name ?? null) {
  const objects = scene?.objects ?? {};
  if (!objects[id] || isGroup(objects[id])) return [];
  const allowed = new Set(attachTargets(objects, id, scene.parents));
  return treeOrder(objects, scene.ids ?? Object.keys(objects), scene.parents)
    .filter(({ id: t }) => allowed.has(t) && !isGroup(objects[t]))
    .map(({ id: t }) => [t, nameOf(t) || "Object"]);
}

/** Is it shown: its own visible, and no group it's in hides it. */
export function shownIn(scene, id) {
  const objects = scene?.objects ?? {};
  const o = objects[id];
  if (!o || o.visible === false) return false;
  const inherited = inheritedDisplay(objects, outlineParents(objects, scene.parents, scene.groups));
  return inherited.get(id)?.visible ?? true;
}

/**
 * Is the name a lens's (read-only: a revealed secret's name is shown, never
 * written back as the public one)? The stage only says what this viewer sees
 * (nameOf), so a lens name is one that differs from the doc's.
 */
export function lensNamed(seen, o) {
  return seen != null && seen !== (o?.name ?? null);
}

export function formatCount(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : String(n);
}

/**
 * The status line under the inspector: [{ kind: "notes" | "error" | "warn", text }].
 *
 * For a passthrough GLB: triangles, draw calls, KB, loading / not loaded
 * (hidden), and its load error. For a render-doc object: build notes, a
 * missing provider, a contested build, and the scene's own GLB errors (the
 * build's own errors are the embedded controls' to show).
 *
 * @param {object} o  the object
 * @param {{ status?: { state, text, title } | null, load?: object | null, content?: object | null, shown?: boolean }} at
 *   status: local.status[id]; load: the raw load state, when the stage gives
 *   it (notes, phase, contested, …); content: api.content(id)
 */
export function statusParts(o, { status = null, load = null, content = null, shown = true } = {}) {
  const out = [];
  if (!o || isGroup(o)) return out;
  if (isPassthrough(o)) {
    const cs = content?.stats ?? null;
    const tris = cs?.triangles ?? o.hint?.triangles;
    const bits = [];
    if (Number.isFinite(tris)) bits.push(`${formatCount(tris)} triangle${tris === 1 ? "" : "s"}`);
    if (cs && Number.isFinite(cs.drawCalls)) bits.push(`${cs.drawCalls} draw call${cs.drawCalls === 1 ? "" : "s"}${cs.instanced ? ` (${cs.nodes} parts)` : ""}`);
    if (Number.isFinite(o.hint?.bytes)) bits.push(`${(o.hint.bytes / 1024).toFixed(o.hint.bytes < 10240 ? 1 : 0)} KB`);
    if (status?.state === "loading") bits.push("loading…");
    else if (!status && !content?.loaded && !shown) bits.push("not loaded (hidden)");
    if (bits.length) out.push({ kind: "notes", text: bits.join(" · ") });
    if (status?.state === "error" && status.title) out.push({ kind: "error", text: String(status.title) });
    return out;
  }
  if (load) {
    // the stage's raw state
    if (load.notes) out.push({ kind: "notes", text: String(load.notes) });
    if (load.phase === "no-provider") out.push({ kind: "error", text: `Provider “${load.providerId ?? o.providerId}” is not installed, so this object can't be rebuilt here.` });
    if (load.stale && load.contested && !load.building && status?.title) out.push({ kind: "warn", text: String(status.title) });
    const err = load.glbError || load.parseError || (load.phase === "error" ? load.error : null);
    if (err) out.push({ kind: "error", text: String(err) });
    return out;
  }
  // only local.status: { state, text, title }
  if (status?.state === "warn") out.push({ kind: "error", text: `Provider “${o.providerId}” is not installed, so this object can't be rebuilt here.` });
  else if (status?.state === "stale" && status.reason === "contested") out.push({ kind: "warn", text: String(status.title) });
  else if (status?.state === "error" && status.title) out.push({ kind: "error", text: String(status.title) });
  return out;
}

// ─── commands ────────────────────────────────────────────────────────────────

const shownOnInspector = (c) => (Array.isArray(c?.show) ? c.show.includes("inspector") : typeof c?.show === "string" ? c.show === "inspector" : true);

/**
 * The commands that apply to `target` and are meant for the inspector, as
 * [{ ext, command, state }]: `first`'s own first, then the rest in running
 * order. A command without state() applies only to the scene, so never here.
 * @param {{ id: string, value: any }[]} collected  api.collect("commands")
 */
export function commandsFor(collected, target, ctx, first = null) {
  const mine = [];
  const rest = [];
  if (target == null) return [];
  for (const { id: ext, value } of collected ?? []) {
    let list;
    try {
      list = Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === "function" ? [...value] : [];
    } catch {
      continue;
    }
    for (const command of list) {
      if (!command || command.id == null || typeof command.run !== "function" || typeof command.state !== "function") continue;
      if (!shownOnInspector(command)) continue;
      let state = null;
      try {
        state = command.state(target, ctx);
      } catch {
        state = null;
      }
      if (state == null || state === false) continue;
      (ext === first ? mine : rest).push({ ext, command, state: typeof state === "object" ? state : {} });
    }
  }
  return [...mine, ...rest];
}

/** A key that changes when the command buttons would. */
export function commandsKey(list) {
  return JSON.stringify(
    list.map(({ ext, command, state }) => [
      ext,
      command.id,
      command.name ?? "",
      state.label ?? null,
      state.title ?? "",
      !!state.disabled,
      state.checked ?? null,
      state.value ?? null,
      Array.isArray(state.choices) ? state.choices.map((c) => [c?.value ?? null, c?.label ?? ""]) : null,
    ]),
  );
}
