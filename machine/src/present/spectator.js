// A running Doom seen from outside the game: its things and doors drawn in
// doom/'s whole map (doom/'s scene:source with `whole: true`: the map as
// one part, a node per door), from the engine's state, every frame.
//
//   const view = new Spectator({ THREE });
//   layer.add(view.group);
//   // every frame:
//   view.draw({ world, state: world.read(queries), frame: api.worldOf(mapId), eye, root: api.content(mapId).root });
//   // when there's nothing to show (another level, the machine gone):
//   view.rest();
//
// - Things are billboards (doom-world.js billboard): an upright quad at each
//   thing's feet, turned to face the eye, its sprite's rotation the one Doom
//   would show a viewer standing there (look()), lit as its sector, in the
//   map's displayed frame (`frame`, the map object's world matrix, scale
//   included), so they move, turn and scale with the map. Each is a Group at
//   the thing's feet named `thing:<id>` (its frame: the quad's right, up and
//   facing) holding the quad, so where a thing stands is read off the scene
//   graph as Doom has it.
// - Doors are the whole map's door nodes (their extras say `door: <sector>`,
//   which three puts in userData), each moved up from where the GLB has it
//   (shut) by how far its sector's ceiling stands above the floor it shuts
//   to (doorAt). This is dressing (scene/STAGE.md, `content`): only a look,
//   each view for itself, on an object that carries the machine's own trait;
//   rest() puts every door back.
//
// three is passed in, never imported: what is drawn has to be made by the
// three.js that draws it (a scene's `api.THREE`).
import { billboard, doorAt, greyOf } from "./doom-world.js";

export class Spectator {
  /** What to add to the scene: the things, placed in the world (their matrices are set here, never composed by three). */
  group;
  /** Counts, for measuring: things drawn on the last frame, sprites decoded and uploaded, doors moved on the last frame. */
  stats = { things: 0, textures: 0, doors: 0 };
  #THREE;
  #quad;
  #things = new Map(); // thing id → { holder, mesh }
  #textures = new Map(); // `${lump}:${translation}` → Texture
  #doors = new Map(); // door node → its y as built (shut)
  #root = null; // the content root the doors are in
  #m;

  constructor({ THREE }) {
    this.#THREE = THREE;
    this.group = new THREE.Group();
    this.group.name = "machine.spectator";
    this.group.userData.noPick = true;
    // a unit quad from (0, 0) to (1, 1), its uv (0, 0) at the bottom left
    this.#quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const { Matrix4, Vector3 } = THREE;
    this.#m = { frame: new Matrix4(), inverse: new Matrix4(), basis: new Matrix4(), quad: new Matrix4(), eye: new Vector3(), r: new Vector3(), u: new Vector3(0, 1, 0), f: new Vector3() };
  }

  /**
   * One frame.
   * @param o.world   doomWorld(wads, map, frame) for the map shown
   * @param o.state   world.read(...) of the engine's state now
   * @param o.frame   the map object's displayed world matrix (16 numbers, column-major: api.worldOf)
   * @param o.eye     where the viewer is, in the world ([x, y, z])
   * @param o.root    the map's content root (api.content(id).root), whose door nodes are moved; null: none yet
   */
  draw({ world, state, frame, eye, root = null }) {
    const m = this.#m;
    m.frame.fromArray(frame);
    m.inverse.copy(m.frame).invert();
    const local = m.eye.fromArray(eye).applyMatrix4(m.inverse).toArray();
    const seen = new Set();
    for (const s of world.look(state, local)) {
      if (!s.lump) continue; // a sprite the WADs don't have (Doom would have refused to start)
      seen.add(s.id);
      const t = this.#thing(s.id);
      const b = billboard(s, local);
      m.basis.makeBasis(m.r.fromArray(b.right), m.u, m.f.fromArray(b.facing)).setPosition(...b.feet);
      t.holder.matrix.multiplyMatrices(m.frame, m.basis);
      t.holder.matrixWorldNeedsUpdate = true;
      const [x0, x1] = b.x;
      const [y0, y1] = b.y;
      // mirrored: the quad runs right to left over the same span, so its picture is flipped and its place isn't
      m.quad.makeScale(b.flip ? x0 - x1 : x1 - x0, y1 - y0, 1).setPosition(b.flip ? x1 : x0, y0, 0);
      t.mesh.matrix.copy(m.quad);
      t.mesh.matrixWorldNeedsUpdate = true;
      const mat = t.mesh.material;
      mat.map = this.#texture(world, s.lump, s.translation);
      if (s.shadow) {
        // a spectre: Doom draws it as a fuzz that darkens what's behind; here a dark, see-through shape
        mat.color.setScalar(0);
        mat.transparent = true;
        mat.opacity = 0.45;
      } else {
        mat.color.setScalar(greyOf(s.light));
        mat.transparent = false;
        mat.opacity = 1;
      }
      t.holder.userData.lump = s.lump;
      t.holder.visible = true;
    }
    for (const [id, t] of this.#things) if (!seen.has(id)) this.#drop(id, t);
    this.stats.things = seen.size;
    this.#dress(root, state);
  }

  /** Nothing to show: no things, every door back where its GLB has it. */
  rest() {
    for (const [id, t] of this.#things) this.#drop(id, t);
    this.stats.things = 0;
    this.#dress(null, null);
  }

  dispose() {
    this.rest();
    for (const tex of this.#textures.values()) tex.dispose();
    this.#textures.clear();
    this.#quad.dispose();
    this.group.removeFromParent();
  }

  #thing(id) {
    let t = this.#things.get(id);
    if (t) return t;
    const T = this.#THREE;
    const holder = new T.Group();
    holder.name = `thing:${id}`;
    holder.matrixAutoUpdate = false;
    holder.userData.id = id;
    const mesh = new T.Mesh(this.#quad, new T.MeshBasicMaterial({ side: T.DoubleSide, alphaTest: 0.5, toneMapped: false }));
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {}; // a sprite is a look: a press finds the map behind it
    holder.add(mesh);
    this.group.add(holder);
    t = { holder, mesh };
    this.#things.set(id, t);
    return t;
  }

  #drop(id, t) {
    t.holder.removeFromParent();
    t.mesh.material.dispose();
    this.#things.delete(id);
  }

  // A sprite lump's picture, as Doom colours it for that player, decoded and uploaded once.
  #texture(world, lump, translation) {
    const key = `${lump}:${translation}`;
    let tex = this.#textures.get(key);
    if (tex) return tex;
    const T = this.#THREE;
    const p = world.image(lump, translation);
    tex = new T.DataTexture(p.rgba, p.width, p.height, T.RGBAFormat, T.UnsignedByteType);
    tex.colorSpace = T.SRGBColorSpace;
    tex.magFilter = tex.minFilter = T.NearestFilter;
    tex.generateMipmaps = false;
    // the picture's top row first: shown upright on a quad whose uv (0, 0) is its bottom left
    tex.repeat.set(1, -1);
    tex.offset.set(0, 1);
    tex.needsUpdate = true;
    this.#textures.set(key, tex);
    this.stats.textures++;
    return tex;
  }

  // Each door node of `root` at its sector's height in `state`; the doors of a root no longer shown put back.
  #dress(root, state) {
    if (root !== this.#root) {
      for (const [node, y] of this.#doors) node.position.y = y;
      this.#doors.clear();
      this.#root = root;
      root?.traverse((n) => {
        if (Number.isInteger(n.userData?.door)) this.#doors.set(n, n.position.y);
      });
    }
    let moved = 0;
    for (const [node, y] of this.#doors) {
      const s = state?.sectors[node.userData.door];
      node.position.y = s ? y + doorAt(s) : y;
      if (s) moved++;
    }
    this.stats.doors = moved;
  }
}
