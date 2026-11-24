// Widget layers (STAGE.md, `world()`): the groups extensions draw in, one
// set per owner, kept in a Map the caller holds (owner → Set of groups);
// what's picked among their meshes. A layer of a linked stage hangs under
// an anchor that follows the node its root hangs under.

import { Group } from "three";
import { drawn } from "./picking.js";
import { disposeObject } from "./object-content.js";

/**
 * A new world-space group for `owner` to draw in, added to `parent` (the
 * widgets' group, or the on-top scene for onTop ones; none without WebGL).
 * Its meshes are widgets: widgetAt finds them (not subtrees with
 * userData.noPick, not hidden ones). `under`: the key of the node it hangs
 * under (a link's), followed by followLayers.
 * @returns {Group}
 */
export function addLayer(layers, owner, { onTop = false, under = null } = {}, parent = null) {
  const g = new Group();
  g.name = `layer:${owner}`;
  g.userData.owner = owner;
  g.userData.onTop = !!onTop;
  // a stage's layer hangs where its root does: an anchor the viewport owns follows that node's world
  // matrix and is drawn only while the link's content is (a hidden link hides its doc's drawing
  // too); what's in the layer is the owner's
  let top = g;
  if (under != null) {
    top = new Group();
    top.name = `anchor:${owner}`;
    top.userData.owner = owner;
    top.userData.onTop = !!onTop;
    top.matrixAutoUpdate = false;
    top.add(g);
    g.userData.under = under;
  }
  parent?.add(top);
  let set = layers.get(owner);
  if (!set) layers.set(owner, (set = new Set()));
  set.add(g);
  return g;
}

/**
 * Put every layer that hangs under a node where that node is drawn now
 * (`worldOf(key)`: its world matrix or null), drawn only while `shown(key)`.
 */
export function followLayers(layers, worldOf, shown) {
  for (const set of layers.values())
    for (const g of set) {
      const anchor = g.userData.under != null ? g.parent : null;
      if (!anchor) continue;
      const m = worldOf(g.userData.under);
      if (m) anchor.matrix.fromArray(m);
      else anchor.matrix.identity();
      anchor.visible = shown(g.userData.under);
      anchor.matrixWorldNeedsUpdate = true;
    }
}

/** Remove and dispose every group this owner made (geometry, materials, textures). @returns {boolean} whether it had any */
export function removeLayers(layers, owner) {
  const set = layers.get(owner);
  if (!set) return false;
  layers.delete(owner);
  for (const g of set) {
    const top = g.userData.under != null ? (g.parent ?? g) : g;
    top.removeFromParent();
    disposeObject(top);
  }
  return true;
}

/** Every pickable mesh in the layers: shown, and not under a noPick. */
export function layerMeshes(layers) {
  const meshes = [];
  const collect = (o) => {
    if (!o.visible || o.userData?.noPick) return;
    if (o.isMesh) meshes.push(o);
    for (const c of o.children) collect(c);
  };
  for (const set of layers.values()) for (const g of set) collect(g);
  return meshes;
}

/**
 * The widget the raycaster (aimed, matrices current) meets among `meshes`:
 * the nearest whose layer is drawn; an onTop widget beats any other,
 * whatever the distances. `userData` merges the hit mesh's and its
 * ancestors' up to the layer (nearer wins), so data can sit on the mesh or
 * on a group above it.
 * @returns {{ owner, onTop: boolean, distance: number, point: number[], object, userData: object } | null}
 */
export function widgetAt(meshes, raycaster) {
  let best = null;
  for (const h of raycaster.intersectObjects(meshes, false)) {
    let layer = h.object;
    const chain = [];
    while (layer && layer.userData?.owner === undefined) {
      chain.push(layer);
      layer = layer.parent;
    }
    if (!layer || !drawn(layer)) continue;
    const onTop = !!layer.userData.onTop;
    if (best && (best.onTop || !onTop)) continue; // hits come nearest first
    const userData = {};
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(userData, chain[i].userData);
    best = { owner: layer.userData.owner, onTop, distance: h.distance, point: h.point.toArray(), object: h.object, userData };
    if (onTop) break;
  }
  return best;
}
