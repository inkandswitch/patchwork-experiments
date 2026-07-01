// Layers — a sketch is an ordered STACK of layers, each a coordinate SPACE.
//
// Nothing about a SPECIFIC space (camera pan/zoom, viewport-pinned chrome, a map's
// lat/lon) is hardcoded here. A layer's coordinate behaviour comes from a registered
// `sketchy:layer-transform`; what KIND of layer it is comes from a `sketchy:layer-kind`.
// The core only ever asks the registry. camera + viewport ship as plugins below; a map
// (or anything) gains a coordinate space by REGISTERING a transform — never by extending
// a switch in here. That is the whole point: no `transform === "geo"` lives in the core.
//
// A transform plugin — the ENTIRE API, deliberately tiny + reactive + dommy:
//   { type:"sketchy:layer-transform", id,
//     use(env) -> {                      // env = { camera, viewport, layer } — reactive accessors
//       transform(): string              // CSS transform for the layer's container ("dommy")
//       toItem(sx, sy): {x, y}           // screen px → this layer's stored item coords
//       toScreen(ix, iy): {x, y}         // stored item coords → screen px
//       scale(): number                  // px per item-unit (stroke widths, hit slop)
//     } }
//
// A kind plugin — what a layer IS:
//   { type:"sketchy:layer-kind", id, name, transform:<transform id>, frost?:bool, ... }
import { getRegistry } from "@inkandswitch/patchwork-plugins";

const list = (type) => {
  try {
    const r = getRegistry(type);
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch { return []; }
};

export const listLayerTransforms = () => list("sketchy:layer-transform");
export const listLayerKinds = () => list("sketchy:layer-kind");
// resolve by id: the host registry FIRST (so a map's `geo` is found dynamically), then
// the built-ins we ship — so camera/viewport never depend on registry timing (a momentary
// empty registry must NOT stop the base canvas panning). BUILTIN_* are defined at the foot.
export const layerKind = (id) => listLayerKinds().find((k) => k.id === id) || BUILTIN_KINDS[id] || null;
export const layerTransformPlugin = (id) => listLayerTransforms().find((t) => t.id === id) || BUILTIN_TRANSFORMS[id] || null;

// the always-available fallback: screen IS item space (so resolution NEVER throws)
const IDENTITY_BINDING = {
  transform: () => "none",
  toItem: (sx, sy) => ({ x: sx, y: sy }),
  toScreen: (ix, iy) => ({ x: ix, y: iy }),
  scale: () => 1,
};

// resolve + bind the transform a layer uses: its own `transform` override, else its
// kind's default, else identity. Returns the LIVE binding from `use(env)`.
export function useLayerTransform(layer, env) {
  const id = (layer && layer.transform) || (layerKind(layer && layer.kind) || {}).transform;
  const plugin = (id && layerTransformPlugin(id)) || null;
  if (!plugin || typeof plugin.use !== "function") return IDENTITY_BINDING;
  try { return plugin.use(env) || IDENTITY_BINDING; } catch { return IDENTITY_BINDING; }
}

// which layer an item belongs to (un-tagged ⇒ the base canvas layer)
export const itemLayer = (it) => (it && it.layer) || "canvas";

// the default stack a fresh sketch gets (drawn bottom → top)
export const defaultLayers = () => [
  { id: "canvas", kind: "canvas" },
  { id: "overlay", kind: "overlay" },
];

// ── the two BUILT-IN plugins (registered from index.jsx, exactly like a map would) ──
export const cameraTransform = {
  type: "sketchy:layer-transform",
  id: "camera",
  use(env) {
    return {
      transform: () => { const c = env.camera(); return `translate(${c.x}px, ${c.y}px) scale(${c.z})`; },
      toItem: (sx, sy) => { const c = env.camera(); return { x: (sx - c.x) / c.z, y: (sy - c.y) / c.z }; },
      toScreen: (ix, iy) => { const c = env.camera(); return { x: ix * c.z + c.x, y: iy * c.z + c.y }; },
      scale: () => env.camera().z,
    };
  },
};

export const viewportTransform = {
  type: "sketchy:layer-transform",
  id: "viewport",
  use() { return IDENTITY_BINDING; },
};

export const canvasKind = { type: "sketchy:layer-kind", id: "canvas", name: "Canvas", transform: "camera" };
export const overlayKind = { type: "sketchy:layer-kind", id: "overlay", name: "Overlay", transform: "viewport", frost: true };

export const layerTransformPlugins = [cameraTransform, viewportTransform];
export const layerKindPlugins = [canvasKind, overlayKind];

// the built-in fallbacks (used by the resolvers above when the host registry is empty)
const BUILTIN_TRANSFORMS = { camera: cameraTransform, viewport: viewportTransform };
const BUILTIN_KINDS = { canvas: canvasKind, overlay: overlayKind };
