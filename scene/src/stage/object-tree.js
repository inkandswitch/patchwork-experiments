// The objects the viewport draws, as a tree under one root: each object's
// entry (./object-content.js) by its key (./paths.js), who hangs under whom,
// the poses held over the doc's transforms, the groups, which objects are
// shown, and their boxes. A link's content is its doc (STAGE.md, "Views,
// stages and links"): the roots of the stage it opens (keys of another
// stage) hang in the link's body, so hiding a link hides its doc, as hiding
// any object hides what it's made of.

import { Box3, Matrix4 } from "three";
import { parseKey } from "./paths.js";
import { bodyBox, disposeObject, newEntry, placeLocal, removePlaceholder } from "./object-content.js";

const stageOf = (key) => parseKey(key)?.n ?? 0;

/**
 * A tree under `root` (a three Group); `changed()` whenever what's shown or
 * where moves (a removal, a pose).
 */
export function createObjectTree({ root, changed = () => {} }) {
  /** key → entry */
  const entries = new Map();
  /** key → a held local transform, shown instead of the doc's */
  const poses = new Map();
  /** stage number → its groups' members (group key → object keys, at any depth) */
  const groupSets = new Map();
  /** the union of groupSets: a group has no node of its own */
  let groupMembers = new Map();

  function ensure(id) {
    let entry = entries.get(id);
    if (!entry) {
      entry = newEntry(id);
      root.add(entry.group);
      entries.set(id, entry);
      const pose = poses.get(id);
      if (pose) placeLocal(entry.group, pose);
    }
    return entry;
  }

  /**
   * Is this object drawn: its body and every node above it visible (groups
   * hide their subtree)? Takes a key or an entry. `inStage`: shown in its
   * own stage, its doc's say only: the walk stops at its stage's root, so a
   * host hiding the link it hangs in doesn't count (a stage's boxes are its
   * own, I7).
   */
  function isShown(entry, { inStage = false } = {}) {
    if (typeof entry === "string") entry = entries.get(entry);
    if (!entry || !entry.body.visible) return false;
    const n = inStage ? stageOf(entry.group.userData.objectId) : null;
    for (let o = entry.group; o && o !== root; o = o.parent) {
      const at = o.userData?.objectId;
      if (inStage && at != null && stageOf(at) !== n) return true; // the link's body: its host's
      if (!o.visible) return false;
    }
    return true;
  }

  /**
   * An object's own geometry (not its attachments'), boxed in world space, or
   * in a frame (`within`: its inverse world matrix, a stage's); its hint box
   * while the GLB is still on its way (unless hints: false). For a group,
   * the union of its shown members' boxes.
   */
  function objectBox(id, { hints = true, within = null, inStage = false } = {}) {
    if (groupMembers.has(id)) return groupBox(id, { hints, within, inStage });
    const entry = entries.get(id);
    if (!entry || entry.kind === "group" || !isShown(entry, { inStage })) return null;
    entry.body.updateWorldMatrix(true, false);
    const world = within ? new Matrix4().fromArray(within).multiply(entry.body.matrixWorld) : entry.body.matrixWorld;
    return bodyBox(entry, world, hints);
  }

  /** A group's box: the union of what's shown of what's in it. */
  function groupBox(gid, { hints = true, within = null, inStage = false } = {}) {
    const box = new Box3();
    for (const id of groupMembers.get(gid) ?? []) {
      const b = objectBox(id, { hints, within, inStage });
      if (b) box.union(b);
    }
    return box.isEmpty() ? null : box;
  }

  return {
    entries,
    poses,
    ensure,
    isShown,
    objectBox,
    groupBox,

    /** Put an object's group under its parent's (null: the root); a linked doc's root, in its link's body. Never makes a loop. */
    setParent(id, parentId) {
      const entry = entries.get(id);
      if (!entry) return;
      let target = root;
      if (parentId && parentId !== id) {
        const pe = ensure(parentId);
        const p = stageOf(id) !== stageOf(parentId) ? pe.body : pe.group;
        let loops = false;
        for (let o = p; o; o = o.parent) if (o === entry.group) loops = true;
        if (!loops) target = p;
      }
      if (entry.group.parent !== target) target.add(entry.group);
    },

    /** Take an object out, disposing what's in its body; what hangs under it (attachments, a link's doc) goes to the root. */
    remove(id) {
      const entry = entries.get(id);
      if (!entry) return;
      poses.delete(id);
      entry.gen++;
      // attachments outlive their parent (the scene doc gives them their new transforms)
      for (const child of [...entry.group.children]) if (child !== entry.body) root.add(child);
      // (and a link's doc, hung in its body: its stage closes on its own)
      for (const child of [...entry.body.children]) if (entries.get(child.userData?.objectId)?.group === child) root.add(child);
      removePlaceholder(entry);
      disposeObject(entry.body);
      entry.group.removeFromParent();
      entries.delete(id);
      changed();
    },

    /**
     * Show an object at a local transform ({ position, rotation, scale }, as
     * the doc stores it, under its current parent) instead of the doc's,
     * until it's set to null, which puts the doc's back. Kept for an object
     * that isn't here yet.
     */
    setPose(id, transform) {
      if (transform) poses.set(id, transform);
      else if (!poses.delete(id)) return;
      const entry = entries.get(id);
      if (!entry) return;
      placeLocal(entry.group, transform ?? entry.display?.transform ?? {});
      changed();
    },

    /** An object's displayed world matrix (held poses included): 16 numbers, column-major; null if it isn't here. */
    worldOf(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      entry.group.updateWorldMatrix(true, false);
      return Array.from(entry.group.matrixWorld.elements);
    },

    /** Is what hangs in this node's body (a link's doc) drawn now? */
    contentShown: (key) => !entries.has(key) || isShown(key),

    /** Who is in each of stage `n`'s groups (group key → object keys, at any depth). @returns {boolean} whether that changed */
    setGroups(members, n = 0) {
      const next = new Map([...members].map(([g, ids]) => [g, [...ids]]));
      const was = groupSets.get(n) ?? new Map();
      const same = next.size === was.size && [...next].every(([g, ids]) => {
        const w = was.get(g);
        return w && w.length === ids.length && w.every((x, i) => x === ids[i]);
      });
      if (same) return false;
      if (next.size) groupSets.set(n, next);
      else groupSets.delete(n);
      groupMembers = new Map([...groupSets.values()].flatMap((m) => [...m]));
      return true;
    },

    /** Every shown object that isn't a group, with its world box: `{ id, entry, box }`. */
    *shown() {
      for (const [id, entry] of entries) {
        if (entry.kind === "group") continue;
        const box = objectBox(id);
        if (box) yield { id, entry, box };
      }
    },

    /** The bodies picking looks at, where they are now: shown objects with content, less any `skip(id)` says to. */
    bodies(skip = null) {
      root.updateMatrixWorld();
      const out = [];
      for (const [id, e] of entries) if (e.kind !== "group" && e.content && isShown(e) && !skip?.(id)) out.push(e.body);
      return out;
    },

    /** The union of every shown object's box (an empty Box3 when nothing is shown); `stage`: one stage's, as its doc shows them. */
    sceneBox({ hints = true, within = null, stage = null } = {}) {
      const box = new Box3();
      for (const [id, e] of entries) {
        if (e.kind === "group" || (stage != null && stageOf(id) !== stage)) continue;
        const b = objectBox(id, { hints, within, inStage: stage != null });
        if (b) box.union(b);
      }
      return box;
    },
  };
}
