// scene:extension "ink": ink-scene docs in a scene, drawn by ink's own renderer.
//
// A dropped (or pasted) ink-scene doc becomes an object of the source
// "ink-scene" (source.js: a blocky stand-in GLB, which the scene picks and
// frames) with the marker trait `ink.scene`. For each object with the trait,
// this extension builds the doc's world (running its code, as the tool does),
// plays its clock, and draws it into the stage's own WebGL context with depth
// (layer.js), hiding the stand-in. Everything here is this viewer's: nothing is
// written but the drop.

import * as toolkit from "./generated/toolkit.js";
import { loadScene } from "./load-scene.js";
import { sourceKey } from "./source.js";
import { createLayer } from "./layer.js";
import { inkAtmosphere, waterObjects } from "./atmosphere.js";
import { createLookLayer } from "./look-layer.js";
import { hostedHandle } from "./hosted.js";
import { createSceneEditor } from "./scene-editor.js";

export const TRAIT = "ink.scene";
export const PROVIDER = "ink-scene";

const isInk = (doc) => doc?.["@patchwork"]?.type === "ink-scene";
const options = (trait) => ({ px: Math.max(1, Math.min(8, Math.round(Number(trait?.px) || 3))), atmosphere: trait?.atmosphere === true, look: trait?.look === true });

function create(api) {
  const THREE = api.THREE;
  const group = api.world();
  /** id → { url, handle, off, key, world, error, layer, building, gen, proxyHidden } */
  const entries = new Map();
  let stopLoop = null;
  let time = 0;
  // the atmosphere offered (ambient), as JSON text, and when it was last sampled
  let offered = null, sampledAt = -Infinity;
  // ink's look over the whole scene (look-layer.js): made once some object asks, drawn after the stage's picture
  let look = null, stopLook = null;
  // the Open: one object's source over the scene, at most one at a time ({ id, panel, put })
  let editing = null;
  let disposed = false;

  function ensureLoop() {
    if (stopLoop || disposed) return;
    stopLoop = api.loop((dt) => {
      time += dt;
      for (const e of entries.values()) {
        e.world?.anim?.update?.(Math.min(dt, 0.1), time);
        e.layer?.setTime(time);
      }
      // a sky that changes with time (a day passing, a squall) is offered again, twice a second at most
      if (time - sampledAt >= 0.5) {
        sampledAt = time;
        if (JSON.stringify(atmosphere()) !== offered) reoffer();
      }
    });
  }

  async function rebuild(id, e) {
    const doc = e.handle?.doc();
    if (!doc) return;
    const key = sourceKey(doc);
    if (key === e.key) return;
    const gen = ++e.gen;
    e.building = true;
    tell(id);
    try {
      const scene = await loadScene(toolkit, doc);
      const world = await scene.build(scene.seed);
      if (disposed || entries.get(id) !== e || gen !== e.gen) return;
      if (!world?.data) throw new Error("the scene's build() returned no world");
      e.world = world;
      e.error = null;
      world.anim?.update?.(0, time);
      e.layer ??= createLayer({ THREE, toolkit, root: () => api.content(id)?.root ?? null });
      e.layer.setWorld(world);
      if (!e.layer.mesh.parent) group.add(e.layer.mesh);
      ensureLoop();
      hideProxy(id, e);
      syncLook();
      // a flush: update() hides a stand-in that loads later, and ambient() offers this world's sky
      reoffer();
    } catch (err) {
      if (disposed || entries.get(id) !== e || gen !== e.gen) return;
      e.error = String(err?.message ?? err);
      console.error(`[ink-studio] ${id}:`, err);
    } finally {
      if (gen === e.gen) {
        e.key = key;
        e.building = false;
      }
      tell(id);
      api.invalidate();
    }
  }

  async function add(id, o) {
    const e = { url: o.sourceUrl, handle: null, off: null, key: null, world: null, error: null, layer: null, building: false, gen: 0, proxyHidden: null };
    entries.set(id, e);
    let handle;
    try {
      handle = await api.repo.find(o.sourceUrl);
    } catch (err) {
      e.error = `couldn't open ${o.sourceUrl}: ${err?.message ?? err}`;
      return;
    }
    if (disposed || entries.get(id) !== e) return;
    e.handle = handle;
    let soon;
    const onChange = () => {
      clearTimeout(soon);
      soon = setTimeout(() => rebuild(id, e), 600);
    };
    handle.on("change", onChange);
    e.off = () => {
      clearTimeout(soon);
      handle.off("change", onChange);
    };
    rebuild(id, e);
  }

  function remove(id) {
    const e = entries.get(id);
    if (!e) return;
    if (editing?.id === id) stopEditing();
    entries.delete(id);
    e.gen++;
    e.off?.();
    showProxy(e, true);
    if (e.layer) {
      group.remove(e.layer.mesh);
      e.layer.dispose();
    }
  }

  /** The editor's status line, when this object is the one open. */
  function tell(id) {
    const e = entries.get(id);
    if (e && editing?.id === id) editing.panel.status({ splats: e.world?.count ?? null, building: e.building, error: e.error });
  }

  /** Open: the object's source over the scene; the world rebuilds in place as it changes (rebuild, on its handle). */
  function startEditing(id) {
    const e = entries.get(id);
    if (!e?.handle) return;
    const name = api.scene()?.objects?.[id]?.name || e.handle.doc()?.title || "Ink scene";
    const panel = createSceneEditor({
      overlay: api.overlay(),
      handle: hostedHandle(e.handle, () => api.use?.("edits") ?? null),
      name,
      onClose: () => stopEditing(),
    });
    editing = { id, panel, put: null };
    // a tool on the scene's stack: it passes every event (orbit, selection go on), and Escape puts it down
    editing.put = api.hold({ name: `Editing ${name}`, pointer: true }, {
      put() {
        if (editing?.id === id) {
          editing.put = null;
          stopEditing();
        }
      },
    });
    tell(id);
  }
  function stopEditing() {
    const s = editing;
    if (!s) return;
    editing = null;
    s.panel.close();
    s.put?.();
  }

  /** Hide the stand-in once there's a world to draw over it, and again whenever its content reloads. */
  function hideProxy(id, e) {
    const root = api.content(id)?.root ?? null;
    if (e.world && root && e.proxyHidden !== root) {
      e.proxyHidden = root;
      showProxy(e, false);
    }
  }

  /** The stand-in's meshes write no colour or depth while the layer draws (they stay pickable). */
  function showProxy(e, show) {
    const root = e.proxyHidden;
    if (!root) return;
    root.traverse((n) => {
      if (!n.isMesh) return;
      for (const m of [].concat(n.material)) {
        m.colorWrite = show;
        m.depthWrite = show;
      }
    });
    if (show) e.proxyHidden = null;
  }

  /** The first object (in id order) lending the scene its look, or null. */
  function lookSource() {
    for (const id of [...entries.keys()].sort()) {
      const e = entries.get(id);
      if (e.options?.look && e.world) return e;
    }
    return null;
  }
  function syncLook() {
    const want = lookSource() !== null;
    if (want && !stopLook) {
      look ??= createLookLayer({ THREE, toolkit });
      stopLook = api.afterRender((renderer, size) => {
        const e = lookSource();
        if (e) look.draw(renderer, size, e.world, { px: e.options.px, time });
      });
    } else if (!want && stopLook) {
      stopLook();
      stopLook = null;
    }
  }

  function update(scene) {
    const want = new Map();
    for (const [id, o] of Object.entries(scene.objects ?? {})) if (o?.traits?.[TRAIT] && typeof o.sourceUrl === "string") want.set(id, o);
    for (const [id, e] of entries) if (want.get(id)?.sourceUrl !== e.url) remove(id);
    for (const [id, o] of want) {
      if (!entries.has(id)) add(id, o);
      const e = entries.get(id);
      e.options = options(o.traits[TRAIT]);
      e.layer?.setOptions(e.options);
      hideProxy(id, e);
    }
    syncLook();
  }

  // a flush re-reads ambient()
  const reoffer = () => api.schedule?.(() => {});

  /** The first object (in id order) that offers its sky: its atmosphere now, or null. */
  function atmosphere() {
    const ids = [...entries.keys()].sort();
    for (const id of ids) {
      const e = entries.get(id);
      if (!e.options?.atmosphere || !e.world) continue;
      try {
        return inkAtmosphere(toolkit, e.world, time, api.worldOf?.(id) ?? null);
      } catch (err) {
        e.error = `atmosphere: ${err?.message ?? err}`;
      }
    }
    return null;
  }

  // something draws the water trait (its convention, never its provider's id)
  const hasWater = () => !!api.registry?.("scene:extension")?.filter?.((p) => Array.isArray(p?.traits) && p.traits.includes("water"))?.length;

  return {
    update,
    commands: [
      {
        // the object's Open (scene EDITOR.md, "A command"): its source over the scene, the world rebuilt in place
        id: "open",
        name: "Open",
        open: true,
        key: "Enter",
        hand: "edit",
        show: ["menu", "inspector"],
        state(target) {
          if (!entries.has(target)) return null;
          const on = editing?.id === target;
          return { label: on ? "Close" : "Open", title: on ? "Close this scene's source" : "Edit this scene's source here; it rebuilds in place", checked: on };
        },
        run(target) {
          if (!entries.has(target)) return;
          if (editing?.id === target) return stopEditing();
          stopEditing();
          startEditing(target);
        },
      },
      {
        // ink's own water is off in the scene (vendor/PATCHES.md); this gives it to the water package
        id: "water",
        name: "Add this world's water",
        show: ["menu", "inspector"],
        hand: "edit",
        state(target) {
          const e = entries.get(target);
          if (!e?.world?.water?.media?.length) return null;
          if (!hasWater()) return { disabled: true, title: "The water package isn't installed" };
          return { title: "Water boxes where this world's water is, drawn and floated on by the water package" };
        },
        run(target) {
          const objects = waterObjects(entries.get(target)?.world, target);
          if (!objects.length) return;
          api.change((d) => {
            for (const o of objects) {
              const id = api.newId("o");
              d.objects[id] = o;
              d.order.push(id);
            }
          });
        },
      },
    ],
    ambient() {
      const a = atmosphere();
      offered = JSON.stringify(a);
      return a ? { atmosphere: a } : {};
    },
    inspect: () => ({
      editing: editing?.id ?? null,
      look: look?.inspect() ?? null,
      objects: [...entries].map(([id, e]) => ({ id, url: e.url, splats: e.world?.count ?? null, building: e.building, error: e.error, ...(e.layer?.inspect() ?? {}) })),
    }),
    dispose() {
      disposed = true;
      stopEditing();
      for (const id of [...entries.keys()]) remove(id);
      stopLook?.();
      look?.dispose();
      stopLoop?.();
    },
  };
}

export default {
  create,
  async drop(ctx, info) {
    if (!isInk(info?.doc)) return false;
    const at = Array.isArray(info.at?.point) ? info.at.point.map(Number) : [0, 0, 0];
    const id = await ctx.addObject(info.url, {
      name: String(info.doc.title || "Ink scene"),
      group: info.group ?? null,
      render: { providerId: PROVIDER, params: {} },
      transform: { position: at, rotation: [0, 0, 0], scale: 1 },
      fields: { traits: { [TRAIT]: {} } },
    });
    if (id) ctx.select?.(id);
    return true;
  },
};
