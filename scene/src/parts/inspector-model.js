// scene.inspector's pure side: what the panel shows, worked out from the
// stage's snapshot (api.scene()) and a few lookups passed in. No DOM, no api.

import { groupChain, groupTargets, inheritedDisplay, isGroup, outlineParents } from "../groups.js";
import { attachTargets, treeOrder } from "../hierarchy.js";
import { docKey, parseAutomergeUrl } from "../dnd.js";

export const DEG = 180 / Math.PI;
const NBSP = " ";

/** What the stage routed an object's content to, from its load state (api.loadState): "file", "built" or null. */
export const contentKind = (load) => load?.content ?? null;

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
 * For a file (a GLB shown as it is, `load.content` "file"): triangles, draw
 * calls, KB, loading / not loaded (hidden), and its load error. Otherwise
 * (built, or a provider this viewer doesn't have): build notes, a missing
 * provider, a contested build, and what was built that can't be shown (the
 * build's own errors are its controls' to show).
 *
 * @param {object} o  the object
 * @param {{ status?: { state, text, title } | null, load?: object | null, content?: object | null, shown?: boolean }} at
 *   load: api.loadState(id) (its `state`: README.md, "Content"); status:
 *   local.status[id], what that state says to people; content: api.content(id)
 */
/** A missing provider, said for what it costs: a built object keeps what was built, anything else isn't shown. */
const noProviderText = (providerId, content) =>
  content === "built" ? `Provider “${providerId}” is not installed, so this object can't be rebuilt here.` : `Provider “${providerId}” is not installed, so this object can't be shown here.`;

export function statusParts(o, { status = null, load = null, content = null, shown = true } = {}) {
  const out = [];
  if (!o || isGroup(o)) return out;
  const st = load?.state ?? null;
  if (contentKind(load) === "file") {
    const cs = content?.stats ?? null;
    const tris = cs?.triangles ?? o.hint?.triangles;
    const bits = [];
    if (Number.isFinite(tris)) bits.push(`${formatCount(tris)} triangle${tris === 1 ? "" : "s"}`);
    if (cs && Number.isFinite(cs.drawCalls)) bits.push(`${cs.drawCalls} draw call${cs.drawCalls === 1 ? "" : "s"}${cs.instanced ? ` (${cs.nodes} parts)` : ""}`);
    if (Number.isFinite(o.hint?.bytes)) bits.push(`${(o.hint.bytes / 1024).toFixed(o.hint.bytes < 10240 ? 1 : 0)} KB`);
    if (st?.state === "loading") bits.push("loading…");
    else if (!st && !content?.loaded && !shown) bits.push("not loaded (hidden)");
    if (bits.length) out.push({ kind: "notes", text: bits.join(" · ") });
    if (st?.state === "failed" && st.error) out.push({ kind: "error", text: String(st.error) });
    return out;
  }
  if (load?.notes) out.push({ kind: "notes", text: String(load.notes) });
  if (st?.state === "no-provider") out.push({ kind: "error", text: noProviderText(st.providerId ?? o.providerId, load.content) });
  if (st?.state === "stale" && st.hold === "contested" && status?.title) out.push({ kind: "warn", text: String(status.title) });
  if (st?.state === "failed" && st.in === "load" && st.error) out.push({ kind: "error", text: String(st.error) });
  return out;
}

/** How long ago `at` was, said briefly ("just now", "4 min ago"); `now` in the same clock. Pure. */
export function ago(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * A built object's build in a line, from its load state (api.loadState):
 * building, never built, up to date, out of date (pinned or not), waiting
 * for a linked document, or fixed at a version; null for content that isn't
 * built (a file, a link) or a missing provider (statusParts says that). Pure.
 */
export function buildSummary(load, now) {
  const st = load?.state;
  if (contentKind(load) !== "built" || !st || st.state === "no-provider") return null;
  if (st.state === "building") return "Building…";
  if (!load.builtAt) return load.pinned ? "Not built (pinned)" : "Not built yet";
  const when = ago(load.builtAt, now);
  if (load.at) return `Built ${when} · fixed version`;
  if (st.state === "stale" || st.state === "failed") return `Built ${when} · out of date${load.pinned ? " (pinned)" : ""}`;
  if (st.state === "waiting") return `Built ${when} · waiting for a linked document`;
  return `Up to date · built ${when}`;
}

// ─── what extensions contribute: commands ───────────────────────────────────

/**
 * Walk what api.collect gathered, `first`'s own first, then the rest in
 * running order: pick(ext, entry) → what to keep, or null. One extension's
 * value that isn't a list (or whose iterator throws) contributes nothing.
 * @param {{ id: string, value: any }[]} collected
 */
function contributed(collected, first, pick) {
  const mine = [];
  const rest = [];
  for (const { id: ext, value } of collected ?? []) {
    let list;
    try {
      list = Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === "function" ? [...value] : [];
    } catch {
      continue;
    }
    for (const entry of list) {
      const kept = entry ? pick(ext, entry) : null;
      if (kept) (ext === first ? mine : rest).push(kept);
    }
  }
  return [...mine, ...rest];
}

/** An entry's state(target, ctx); one that throws doesn't apply, and says so. */
function stateOf(ext, kind, entry, target, ctx) {
  try {
    return entry.state(target, ctx);
  } catch (err) {
    console.warn(`[scene] “${ext}” ${kind} “${entry.id}” failed`, err);
    return null;
  }
}

// ─── commands ────────────────────────────────────────────────────────────────

const shownOnInspector = (c) => (Array.isArray(c?.show) ? c.show.includes("inspector") : typeof c?.show === "string" ? c.show === "inspector" : true);

/**
 * The commands that apply to `target` and are meant for the inspector, as
 * [{ ext, command, state }]: `first`'s own first, then the rest in running
 * order. A command without state() applies only to the scene, so never here;
 * one whose state throws doesn't apply (with a warning).
 * @param {{ id: string, value: any }[]} collected  api.collect("commands")
 */
export function commandsFor(collected, target, ctx, first = null) {
  if (target == null) return [];
  return contributed(collected, first, (ext, command) => {
    if (command.id == null || typeof command.run !== "function" || typeof command.state !== "function") return null;
    if (!shownOnInspector(command)) return null;
    const state = stateOf(ext, "command", command, target, ctx);
    if (state == null || state === false) return null;
    return { ext, command, state: typeof state === "object" ? state : {} };
  });
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
      Array.isArray(state.options) ? state.options.map((c) => [c?.value ?? null, c?.label ?? ""]) : null,
    ]),
  );
}

// ─── documents: the inspector's sections ────────────────────────────────────

/** The tool the inspector shows a render doc in: the build controls (src/controls-tool.js). */
export const CONTROLS_TOOL = "scene-render-controls";

/**
 * The inspector's documents that go with `target`, one section each
 * (EDITOR.md, "The interface"), as [{ ext, id, label, url, toolId, folded }],
 * in `entries`' order, `ext` being the inspector's id. Dropped: an entry that
 * doesn't apply (state null or false), one whose url isn't an automerge URL,
 * one whose state throws (with a warning), and a repeat of a url and tool
 * already listed (the first one stays). Unlike a command, a document may go
 * with the scene (target null).
 * @param {{ id: string, name?: string, state: Function }[]} entries  inspectorDocuments(…)
 */
export function documentsFor(entries, target, ctx, ext) {
  const shown = new Set();
  const out = [];
  for (const entry of entries) {
    const state = stateOf(ext, "document", entry, target, ctx);
    if (state == null || state === false || typeof state !== "object") continue;
    const url = docUrl(state.url);
    if (!url) continue;
    const toolId = typeof state.toolId === "string" && state.toolId ? state.toolId : null;
    const k = docKey(url, toolId);
    if (shown.has(k)) continue;
    shown.add(k);
    out.push({ ext, id: String(entry.id), label: String(state.label ?? entry.name ?? entry.id), url, toolId, folded: !!state.folded });
  }
  return out;
}

/**
 * The inspector's own documents, which every related document of an object
 * is shown as: the doc it shows, in that doc's own tool, as its Source (built
 * from it), its File (a GLB shown as it is) or its Linked scene, the last two
 * folded, since what they show is already in the scene, and each a section
 * of its own, so each keeps its own fold; its Build (the render doc, in the build controls) and About (its infoUrl,
 * else its nearest group's). The source is the doc's own `sourceUrl`, never
 * what is displayed instead, so nothing veiled is offered.
 * @param {(id: string) => "file" | "built" | "scene" | null} contentOf  what the stage routed an object's content to
 */
export function inspectorDocuments(contentOf) {
  const objectOf = (target, scene) => (target != null ? scene?.objects?.[target] ?? null : null);
  /** A section of the object's source, for the kinds of content `is` says, folded as `folded(kind)` says. */
  const sourceEntry = (id, name, is, folded) => ({
    id,
    name,
    state(target, { scene }) {
      const o = objectOf(target, scene);
      const url = !o || isGroup(o) ? null : docUrl(o.sourceUrl);
      const kind = url ? contentOf(target) : null;
      return url && is(kind) ? { url, label: name, folded: folded(kind) } : null;
    },
  });
  return [
    // one doc, three sections (each its own fold): what it was built from;
    // or, routed nowhere (its provider isn't installed), folded
    sourceEntry("source", "Source", (kind) => kind !== "file" && kind !== "scene", (kind) => kind !== "built"),
    sourceEntry("file", "File", (kind) => kind === "file", () => true),
    sourceEntry("link", "Linked scene", (kind) => kind === "scene", () => true),
    {
      id: "build",
      name: "Build",
      state(target, { scene }) {
        const o = objectOf(target, scene);
        const url = !o || isGroup(o) ? null : docUrl(o.renderUrl);
        return url ? { url, toolId: CONTROLS_TOOL, label: "Build" } : null;
      },
    },
    {
      id: "about",
      name: "About",
      state(target, { scene }) {
        const about = target != null ? aboutFor(scene, target) : null;
        return about ? { url: about.url, toolId: about.toolId, label: about.label } : null;
      },
    },
  ];
}
