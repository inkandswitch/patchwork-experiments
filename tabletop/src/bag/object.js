// A scene object as the bag keeps it, and as it goes back. Pure.
//
// What goes in is the object's whole record except where it was: its
// transform's position and rotation, its parent and its group (a bag has no
// "where"), and `claims` (the stage's runtime state; scene/STAGE.md,
// "Copying objects": RUNTIME_FIELDS). Everything else is kept as it is:
// name, sourceUrl, providerId, renderUrl, traits, tags, colour, hint, `at`…
// Its size (the transform's scale) is part of what it is, so that is kept
// too, beside the record.
//
// This is a MOVE, not the stage's copy: the object that comes out is the one
// that went in (the same id where it can be, the same render doc), so a
// trait that knows it by id (a deck's hidden card) still does. A draw with
// replacement is a copy, and goes through the stage's own rule
// (api.addObject with `fields` and `render`; extension.js).

/** The fields of an object that say where it is, or are the stage's runtime state: never kept. */
export const LEFT_BEHIND = Object.freeze(["transform", "parent", "group", "claims"]);

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** An object's record for the bag: a fresh plain copy without where it was. */
export function recordOf(o) {
  const out = plain(o) ?? {};
  for (const k of LEFT_BEHIND) delete out[k];
  return out;
}

/** An object's size: its transform's uniform scale. */
export const scaleOf = (o) => {
  const s = Number(o?.transform?.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
};

/**
 * The object a record goes back as, at `pose` ({ position, rotation }) under
 * `parent`, in `group`: the record itself, fresh, with its scale.
 */
export function objectFrom(record, scale, { position = [0, 0, 0], rotation = [0, 0, 0], parent = null, group = null } = {}) {
  return {
    ...plain(record),
    parent,
    group,
    transform: { position: position.map(Number), rotation: rotation.map(Number), scale: Number(scale) > 0 ? Number(scale) : 1 },
  };
}

/** What kind of thing a record is, for counting: things that look alike and are named alike. */
export function kindOf(record) {
  const name = String(record?.name || "Object");
  return { key: `${record?.sourceUrl ?? ""}\u0000${name}`, name };
}

/** Is this object a group (scene/src/groups.js isGroup)? */
export const isGroup = (o) => o?.kind === "group";
