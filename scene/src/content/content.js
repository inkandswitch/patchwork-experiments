// A stage's content (README.md, "Content"): how each object of its doc
// becomes something drawn. The stage tells it, object by object, what the
// doc and the display say (`place`) and what has gone (`forget`); it finds
// the source's provider, routes the object (providers.js routeOf), keeps a
// built object's render built and current (render-manager.js), shows a file
// as it is (glb-queue.js), draws a stand-in, and says each object's state.
// This is all the stage knows of content.

import { createRenderManager } from "./render-manager.js";
import { createGLBQueue } from "./glb-queue.js";
import { contentState, statusOf } from "./state.js";
import { contentOf, describeForHumans, describeSource, matchProviders, routeOf, showsContent } from "./providers.js";
import { newRenderDoc, seededRenderDoc } from "../datatype.js";
import { defaultParams } from "../params.js";
import { parseAutomergeLink, parseAutomergeUrl } from "../dnd.js";
import { isGroup, resolveGroups } from "../groups.js";
import { fileBytes } from "../file-content.js";
import { normalizeTransform } from "../transform.js";
import * as ops from "../ops.js";
import { CONTEXT_CHANGED_EVENT, CONTEXT_EVENT, CONTROLS_CLASS, REBUILD_EVENT } from "../embed.js";

/** Load priority of the selected object: before anything else. */
const SELECTED_PRIORITY = 1e12;
/** What addObject settles itself, which its `fields` never override. */
const ADD_OWNS = new Set(["kind", "name", "sourceUrl", "providerId", "renderUrl", "parent", "group", "transform", "claims", "saved"]);
const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

/** An infoUrl / sourceUrl that is really an automerge URL, else null. */
function docUrl(v) {
  return typeof v === "string" && v.startsWith("automerge:") ? parseAutomergeUrl(v) : null;
}

/** How big an object's hint says it is (bigger loads first). */
function hintVolume(o) {
  const b = o?.hint?.bounds;
  if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return 0;
  const v = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * @param {{
 *   repo: object,                      // the stage's (read-only for a read-only stage)
 *   time: object,                      // the stage's one time (stage/time.js)
 *   readOnly: boolean,                 // build nothing, write nothing
 *   announce: object | null,           // told which docs it shows live (stage/announce.js)
 *   root: HTMLElement,                 // where embedded build controls ask (embed.js)
 *   scope: object,                     // the viewport as the stage sees it: setGLB, setHint, contentOf, ok
 *   sources: object,                   // the scene:source registry
 *   registry: (type: string) => object | null,
 *   doc: () => object,
 *   selected: () => string | null,     // this stage's element of the viewer's selection: it loads first
 *   writable: () => boolean,
 *   onStatus: () => void,              // an object's state changed
 *   onDrawn: () => void,               // something new is drawn (a GLB arrived)
 *   onSources: () => void,             // the sources changed: place every object again
 *   onProviders: () => void,           // which provider a render doc names is known, or changed
 * }} o
 */
export function createContent({ repo, time, readOnly, announce, root, scope, sources, registry, doc, selected, writable, onStatus, onDrawn, onSources, onProviders }) {
  let dead = false;
  const routes = new Map(); // id → where its content was routed at the last place: "built", "file", "scene" or null
  // id → what is known of its content, by route: { content: "built", ...what the manager said },
  // { content: "file", file: the queue's word }, { content: null, missing: a provider id }
  const objState = new Map();
  const placed = new Map(); // id → the object as last placed
  const hintKeys = new Map(); // id → hint bounds last given to the viewport
  const drawn = new Map(); // id → the stand-in bytes drawn for it
  const createdHere = new Set(); // render docs made here, this session: nothing to wait to sync before building
  // has the manager said which provider this object's render doc names? (not before the doc has loaded)
  const said = (st) => st?.content === "built" && st.loaded;
  /** An object's state (./state.js), from what is known of it. */
  function stateOf(id) {
    const s = objState.get(id);
    if (!s) return null;
    if (s.content === "built") return s.state;
    return contentState({ route: s.content, file: s.file, missing: s.missing });
  }

  const listProviders = () => {
    try {
      return sources?.filter?.(() => true) ?? [];
    } catch {
      return [];
    }
  };
  /** The kind of content a registered provider makes (providers.js contentOf), else null. */
  const kindOf = (providerId) => contentOf(sources.get(providerId));
  const unusable = new Set(); // sources already warned about: they declare no content kind
  /** Say once of each registered source that declares no content kind: it is never used. */
  function warnUnusable() {
    for (const p of listProviders()) {
      if (!p?.id || contentOf(p) || unusable.has(p.id)) continue;
      unusable.add(p.id);
      console.warn(`[scene] source “${p.id}” declares no content kind ("file" or "built"), so it isn't used`);
    }
  }
  const offSources = sources.on?.("changed", () => {
    manager.providersChanged();
    if (dead) return;
    warnUnusable();
    onSources();
  });

  async function loadProvider(id) {
    if (!sources.has(id)) return null;
    const p = await sources.load(id);
    if (!p?.module) return null;
    return { id, name: p.name ?? id, params: p.params ?? [], cost: p.cost, version: p.version, module: p.module };
  }

  function setState(id, s) {
    objState.set(id, s);
    onStatus();
  }
  function clearState(id) {
    if (objState.delete(id)) onStatus();
  }

  /** Give the viewport a placeholder box (only when it changed); true if there is one. */
  function applyHint(id, b) {
    const hk = b ? `${b.min}|${b.max}` : "";
    if (hintKeys.get(id) !== hk) {
      hintKeys.set(id, hk);
      scope.setHint(id, b ?? null);
    }
    return !!hk;
  }

  const manager = createRenderManager({
    repo,
    time,
    readOnly,
    announce,
    loadProvider,
    onState: (id, s) => {
      const was = objState.get(id);
      const before = was?.bounds;
      // the provider its render doc names is one the scene calls for (packages)
      const providerNews = said(was) !== said({ ...s, content: "built" }) || was?.providerId !== s.providerId;
      objState.set(id, { ...s, content: "built" });
      if (providerNews) onProviders();
      // a render doc's own bounds stand in until its GLB loads (unless the scene has a hint)
      if (String(before?.min) + String(before?.max) !== String(s.bounds?.min) + String(s.bounds?.max)) {
        const o = placed.get(id);
        if (o && !o.hint?.bounds) applyHint(id, s.bounds);
      }
      tellControls();
      onStatus();
    },
    // (a GLB that can't be parsed is the manager's to say: it rejects)
    onGLB: async (id, bytes) => {
      try {
        await scope.setGLB(id, bytes);
      } catch (err) {
        console.warn("[scene] GLB failed to parse", err);
        throw err;
      } finally {
        if (!dead) onDrawn();
      }
    },
  });

  const queue = createGLBQueue({
    time,
    find: (url) => repo.find(url),
    read: (h) => fileBytes(h.doc()),
    parse: async (id, bytes) => {
      try {
        await scope.setGLB(id, bytes);
      } catch (err) {
        console.warn("[scene] GLB failed to parse", err);
        throw new Error(`GLB failed to load: ${err?.message ?? err}`);
      }
      if (!dead) onDrawn();
    },
    onState: (id, st) => setState(id, { content: "file", file: { phase: st.phase, error: st.error } }),
  });

  // what is shown loads biggest first, the selection first of all
  const priorityOf = (id, o) => (id === selected() ? SELECTED_PRIORITY : hintVolume(o));

  // The embedded build controls (../embed.js) show a built object's state
  // and whether it's fixed, which they ask for with CONTEXT_EVENT (below):
  // when either changes, they're told to ask again.
  let contextQueued = false;
  function tellControls() {
    if (contextQueued) return;
    contextQueued = true;
    queueMicrotask(() => {
      contextQueued = false;
      if (dead) return;
      for (const c of root.querySelectorAll(`.${CONTROLS_CLASS}`)) c.dispatchEvent(new CustomEvent(CONTEXT_CHANGED_EVENT));
    });
  }

  /** What the manager tracks an object with: its docs, whether this scene made the render, and its fixed version. */
  const trackSpec = (o) => ({ sourceUrl: o.sourceUrl, renderUrl: o.renderUrl, createdHere: createdHere.has(o.renderUrl), at: o.at ?? null });

  /** Stop loading an object's own content (it shows something else, or nothing). */
  function unload(id) {
    manager.untrack(id);
    queue.remove(id);
  }

  /**
   * Draw object `id` as the doc and the display say: `o` as it is in the doc,
   * `shown` whether it's visible, `show` what an extension displays as its
   * content (a file doc's URL, or a stand-in's GLB bytes), `opened` whether a
   * stage is open under it. Only what is shown loads; once loaded it stays
   * loaded. → true when its route moved (what's shown changed).
   */
  function place(id, o, { shown, show = undefined, opened = false }) {
    placed.set(id, o);
    const route = typeof show === "string" ? "file" : routeOf(o, kindOf);
    const moved = routes.has(id) && routes.get(id) !== route;
    routes.set(id, route);
    // what was said about content of another kind no longer applies
    if (objState.has(id) && objState.get(id).content !== route) clearState(id);
    // a stand-in (the veil) is drawn through the GLB path, so box and picking go by it; nothing of the object's own loads
    if (show instanceof Uint8Array) {
      unload(id);
      applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
      if (drawn.get(id) !== show) {
        drawn.set(id, show);
        clearState(id);
        Promise.resolve(scope.setGLB(id, show))
          .catch((err) => console.warn("[scene] a stand-in failed to draw", err))
          .then(() => dead || onDrawn());
      }
      return moved;
    }
    // (its own content loads again below, and the stand-in stays up until that has)
    drawn.delete(id);
    if (route === "built") {
      queue.remove(id);
      applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
      if (o.sourceUrl && (shown || manager.has(id))) manager.track(id, trackSpec(o));
      return moved;
    }
    if (route === "file") {
      // what this viewer sees: a displayed source, or the object's own
      const src = docUrl(show ?? o.sourceUrl);
      if (!src) return moved;
      manager.untrack(id);
      applyHint(id, o.hint?.bounds);
      if (shown) queue.ensure(id, src, priorityOf(id, o));
      // dropped before it loaded: "not asked for" again, not loading or failing
      else if (queue.cancel(id)) clearState(id);
      return moved;
    }
    if (route === "scene") {
      // its content is a stage (a link's doc, opened by a view plugin): with
      // one open under it, that is what's drawn; else its hint, the room the host gives it
      unload(id);
      applyHint(id, opened ? null : o.hint?.bounds);
      clearState(id);
      return moved;
    }
    // Nothing to load (no provider here says what it is): drawn as its
    // hint, as anything is while its content hasn't arrived; "no provider"
    // while the registry lacks the one it names (the packages prompt offers it).
    unload(id);
    applyHint(id, o.hint?.bounds);
    const want = typeof o.providerId === "string" && o.providerId && !sources.has(o.providerId) ? o.providerId : null;
    if (!want) clearState(id);
    else if (objState.get(id)?.missing !== want) setState(id, { content: null, missing: want });
    return moved;
  }

  /** Object `id` is gone, or is a group: nothing of it loads or is said. */
  function forget(id) {
    unload(id);
    routes.delete(id);
    placed.delete(id);
    hintKeys.delete(id);
    drawn.delete(id);
    clearState(id);
  }

  /** The ids content holds anything for. */
  const ids = () => new Set([...manager.ids(), ...queue.ids(), ...routes.keys()]);

  /** Every object's state for people, as local.status: { [id]: { state, reason?, text, title } }. */
  function status() {
    const objects = doc().objects ?? {};
    const out = {};
    for (const id of objState.keys()) {
      const st = objects[id] && !isGroup(objects[id]) ? statusOf(stateOf(id)) : null;
      if (st) out[id] = Object.freeze(st);
    }
    return out;
  }

  /** Has the content shown loaded (or failed)? Without WebGL nothing loads: yes. */
  function allIn() {
    if (!scope.ok) return true;
    const objects = doc().objects ?? {};
    for (const [oid, o] of Object.entries(objects)) {
      // (an object with nothing to load, its shape its traits' data, is in)
      if (!showsContent(o) || o.visible === false) continue;
      // a link's content is its doc's, whose stage answers for it
      if (routes.get(oid) === "scene") continue;
      if (scope.contentOf(oid)?.loaded) continue;
      const st = stateOf(oid)?.state;
      if (st === "failed" || st === "no-provider") continue;
      return false;
    }
    return true;
  }

  async function titleOf(sourceDoc, datatype) {
    try {
      const reg = datatype ? await registry("patchwork:datatype") : null;
      const dt = reg ? await reg.load(datatype) : null;
      const t = dt?.module?.getTitle?.(sourceDoc);
      if (t) return String(t);
    } catch {
      // fall back below
    }
    return String(sourceDoc?.title || sourceDoc?.name || datatype || "Object");
  }

  /**
   * Add a document to the scene as an object: through `providerId` (else the
   * best match), with a render doc of its own when the provider's content is
   * "built", and none when it is "file".
   * @param {string} input  an automerge URL (or anything parseAutomergeLink reads)
   * @param {{ id?, providerId?, name?, group?, parent?, before?, transform?, heads?, hint?, fields?, render? }} [opts]
   *   id: the new object's id, made with newId beforehand (a copy maps every
   *   id before it writes anything, so its references are written once);
   *   refused when the scene has it;
   *   parent: attach to that object (and join its group, unless `group` says);
   *   group: file in that group; before: its place in the order; heads (or
   *   heads in the URL itself): add it fixed at that version of its source (`at`);
   *   fields: more of the object, written in the same change (a copy's traits,
   *   tags, colour…; never the fields above, nor `claims` or `saved`); render: a render
   *   doc to start the new one from (a copy's: its params, and its build when
   *   it was of this source by this provider; transfer.js renderSeed)
   * @returns {Promise<Function>} the write, a change function with the new
   *   object's `id`, for the caller to make (api.change); rejects with a
   *   sentence to show
   */
  async function addObject(input, opts = {}) {
    if (!writable()) throw new Error("This scene is read-only here.");
    const link = parseAutomergeLink(input);
    if (!link) throw new Error("That doesn't look like an automerge URL.");
    const url = link.url;
    const heads = opts.heads?.length ? opts.heads : link.heads;
    let source;
    try {
      source = await repo.find(url);
    } catch (err) {
      throw new Error(`Couldn't open that document: ${err?.message ?? err}`);
    }
    const sourceDoc = source.doc();
    const info = describeSource(sourceDoc);
    if (dead) throw new Error("The scene was closed.");
    const providers = matchProviders(listProviders(), info);
    const provider = opts.providerId ? (providers.find((p) => p.id === opts.providerId) ?? null) : (providers[0] ?? null);
    if (!provider) {
      if (opts.providerId) throw new Error(`The provider “${opts.providerId}” can't show ${describeForHumans(info)}.`);
      throw new Error(`No scene provider is installed for ${describeForHumans(info)}.`);
    }
    const name = opts.name || (await titleOf(sourceDoc, info.datatype));
    // A "file" provider's source already is a GLB: no render doc, no copy (README.md, "`scene` — the composition").
    const renderHandle = contentOf(provider) !== "built" ? null : await repo.create2(seededRenderDoc(newRenderDoc({ title: name, parent: url, providerId: provider.id, params: defaultParams(provider.params) }), opts.render));
    if (renderHandle) createdHere.add(renderHandle.url);
    if (dead) throw new Error("The scene was closed.");
    const id = typeof opts.id === "string" && opts.id ? opts.id : newId("o");
    if (doc().objects?.[id]) throw new Error(`This scene already has an object “${id}”.`);
    const transform = opts.transform ? normalizeTransform(opts.transform) : IDENTITY();
    const hint = opts.hint && typeof opts.hint === "object" ? JSON.parse(JSON.stringify(opts.hint)) : null;
    // fresh copies: automerge won't take a value that is already in a document
    const fields = opts.fields && typeof opts.fields === "object" ? JSON.parse(JSON.stringify(opts.fields)) : null;
    const add = (d) => {
      // only what is still there can be a place (someone may have removed it meanwhile)
      const parent = opts.parent && d.objects[opts.parent] && !isGroup(d.objects[opts.parent]) ? opts.parent : null;
      const groupWanted = opts.group !== undefined ? opts.group : parent ? (resolveGroups(d.objects).get(parent) ?? null) : null;
      const group = groupWanted && isGroup(d.objects[groupWanted]) ? groupWanted : null;
      d.objects[id] = ops.newObjectRecord({ name, sourceUrl: url, providerId: provider.id, renderUrl: renderHandle?.url ?? null, parent, group, transform });
      // the rest of a copied object: its traits, tags, colour… (never what's settled above)
      if (fields) for (const [k, v] of Object.entries(fields)) if (!ADD_OWNS.has(k) && v !== undefined) d.objects[id][k] = v;
      // what the file's maker said about it (ctx.file's hint): a placeholder box until it loads
      if (hint) d.objects[id].hint = hint;
      // A URL with heads names a version: show that one. (A file object is
      // shown straight from its file, so it has nothing to fix.)
      // A link with heads is a pinned value of that scene (links.js).
      if (heads?.length && (renderHandle || contentOf(provider) === "scene")) d.objects[id].at = { heads: [...heads] };
      const at = opts.before ? d.order.indexOf(opts.before) : -1;
      if (at >= 0) d.order.splice(at, 0, id);
      else d.order.push(id);
    };
    return ops.planned(add, { id });
  }

  /** Build an object's render doc now (loading it first if it's hidden). @returns {boolean} whether there was one */
  function rebuild(id) {
    const o = doc().objects?.[id];
    if (!o?.renderUrl) return false;
    if (manager.has(id)) {
      manager.rebuild(id);
      return true;
    }
    // Hidden, so not loaded yet (README.md, "Using it": only what is shown
    // loads): an explicit rebuild loads it first. It then stays tracked,
    // like anything that has loaded.
    if (!o.sourceUrl) return false;
    const url = o.renderUrl;
    Promise.resolve(manager.track(id, trackSpec(o)))
      .then(() => {
        if (!dead && doc().objects?.[id]?.renderUrl === url) manager.rebuild(id);
      })
      .catch((err) => console.warn("[scene] rebuild failed to start", err));
    return true;
  }

  /**
   * The `at` that would fix an object at exactly what its render was last
   * built from, or null (not built here yet, not tracked, or not built content).
   * Writing it is the caller's: `ops.setField(scene, id, "at", point)`.
   */
  function fixPoint(id) {
    const o = doc().objects?.[id];
    if (!o?.renderUrl || !manager.has(id)) return null;
    const point = manager.fixPoint(id);
    if (!point) return null;
    // fresh arrays: automerge won't take a value that is already in a document
    const out = { heads: [...point.heads] };
    const deps = Object.entries(point.deps ?? {});
    if (deps.length) out.deps = Object.fromEntries(deps.map(([u, h]) => [u, [...h]]));
    return out;
  }

  /**
   * What object `id` shows and how it got there (API.md, `content(id)`): what
   * is drawn (`loaded`, `box`, `extras`, `stats`, `root`: the viewport's),
   * where its content was routed (`route`), its `state` (./state.js), for
   * built content what is known of its render (`render`: providerId,
   * providerName, pinned, builtAt, builtHeads, bounds, at, notes) and `fix`,
   * the `at` that fixes it at what it shows; null when there is none of it.
   */
  function of(id) {
    const drawn = scope.contentOf(id);
    const s = objState.get(id);
    if (!drawn && !s && !routes.has(id)) return null;
    const built = s?.content === "built";
    const { content: _c, loaded: _l, state: _s, ...render } = built ? s : {};
    return Object.freeze({
      loaded: drawn?.loaded ?? false,
      box: drawn?.box ?? null,
      extras: drawn?.extras ?? null,
      stats: drawn?.stats ?? null,
      root: drawn?.root ?? null,
      route: routes.get(id) ?? null,
      state: stateOf(id),
      render: built ? Object.freeze(render) : null,
      get fix() {
        return fixPoint(id);
      },
    });
  }

  // rebuild requests from embedded controls (../embed.js)
  const onRebuild = (e) => {
    const url = e.detail?.renderUrl;
    const entry = Object.entries(doc().objects ?? {}).find(([, o]) => o?.renderUrl === url);
    if (!entry) return;
    e.preventDefault();
    rebuild(entry[0]);
  };
  // embedded controls asking for their render's object's state, and whether it's fixed at a version
  const onContext = (e) => {
    const url = e.detail?.renderUrl;
    if (!url) return;
    const entry = Object.entries(doc().objects ?? {}).find(([, x]) => x?.renderUrl === url);
    if (!entry) return;
    e.detail.at = entry[1].at ?? null;
    e.detail.state = stateOf(entry[0]);
  };
  root.addEventListener(REBUILD_EVENT, onRebuild);
  root.addEventListener(CONTEXT_EVENT, onContext);

  return Object.freeze({
    place,
    forget,
    ids,
    status,
    allIn,
    of,
    /** where an object's content was routed ("built", "file", "scene": a stage), or null */
    route: (id) => routes.get(id) ?? null,
    /** the providers named by the render docs it has heard from */
    providerIds: () => [...objState.values()].map((s) => s?.providerId),
    /** has every shown built object with a source said which provider its render doc names? */
    rendersKnown() {
      const objects = doc().objects ?? {};
      for (const [id, route] of routes) if (route === "built" && objects[id]?.sourceUrl && !said(objState.get(id))) return false;
      return true;
    },
    addObject,
    rebuild,
    /** say once of each registered source that declares no content kind */
    warnUnusable,
    debug: Object.freeze({ manager, queue }),
    dispose() {
      dead = true;
      if (typeof offSources === "function") offSources();
      root.removeEventListener(REBUILD_EVENT, onRebuild);
      root.removeEventListener(CONTEXT_EVENT, onContext);
      queue.dispose();
      manager.dispose();
    },
  });
}
