// Water's parts (scene:part, STAGE.md "Parts"): open water, and a pond. Each
// is one object with no source: its shape is the `water` trait's data, and
// the extension draws it. The object's origin is the surface at rest, where
// the part was put; the pond is level whatever it was put on.

/** A water object: no source, its shape in its trait. Pure. */
export function waterObject({ name, position, yaw = 0, size, parent = null }) {
  return {
    name,
    sourceUrl: null,
    providerId: null,
    renderUrl: null,
    parent,
    group: null,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    transform: { position: [...position], rotation: [0, yaw, 0], scale: 1 },
    traits: { water: size ? { size: [...size] } : {} },
  };
}

/** A pond's size: 10 m across, 1.5 m deep. */
export const POND = Object.freeze([10, 1.5, 10]);

function place(name, size) {
  return {
    async create(ctx, at) {
      // where it was put, in the world (the stage's at.world: a transform); always at the root, level
      const w = at?.world ?? {};
      const position = [0, 1, 2].map((i) => Number(w.position?.[i]) || 0);
      const id = ctx.newId("o");
      ctx.change((d) => {
        d.objects[id] = waterObject({ name, position, yaw: size ? Number(w.rotation?.[1]) || 0 : 0, size });
        d.order.push(id);
      });
      return id;
    },
  };
}

export const open = place("Water", null);
export const pond = place("Pond", POND);
