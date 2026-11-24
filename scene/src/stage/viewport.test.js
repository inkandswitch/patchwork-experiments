// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import { keyOf } from "./paths.js";
import { scopeViewport } from "./scope.js";
import { applyMatrix } from "../transform.js";
import { LIGHTS } from "./atmosphere.js";
import { ladderRadius } from "./shadows.js";
import { Viewport } from "./viewport.js";

/** Rounded, and without -0, for comparing vectors. */
const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);

// happy-dom has no WebGL, so the renderer can't be built. Everything that
// doesn't draw (the camera rig, picking, layers, poses, depth) runs on a
// viewport put together from the same init steps the constructor uses.
function headless({ w = 200, h = 100 } = {}) {
  const port = document.createElement("div");
  document.body.append(port);
  const vp = Object.create(Viewport.prototype);
  vp.port = port;
  vp.themeRoot = port;
  vp.initState();
  vp.size = { w, h };
  vp.initScene();
  vp.initCamera(port);
  vp.camera.aspect = w / h;
  vp.camera.updateProjectionMatrix();
  vp.ok = true;
  return vp;
}

/** An object with a cube `size` across as its content, at `at`. */
function cube(vp, id, at = [0, 0, 0], size = 1) {
  const entry = vp.ensureObject(id);
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
  entry.content = mesh;
  entry.box = new Box3().setFromObject(mesh);
  entry.body.add(mesh);
  vp.applyDisplay(id, { transform: { position: at } });
  return entry;
}

function lookFrom(vp, position, target = [0, 0, 0]) {
  vp.setCamera({ position, target });
  vp.camera.updateMatrixWorld();
}

describe("Viewport without WebGL", () => {
  it("says so, and everything is a harmless no-op; labels still take a sync", () => {
    const port = document.createElement("div");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {}); // three logs the failed context
    const vp = new Viewport({ port, themeRoot: port });
    quiet.mockRestore();
    expect(vp.ok).toBe(false);
    expect(vp.error).toBeTruthy();
    expect(vp.pick(1, 1)).toBe(null);
    expect(vp.ray(1, 1)).toBe(null);
    expect(vp.raycast([0, 0, 0], [0, 0, 1])).toBe(null);
    expect(vp.project([0, 0, 0])).toBe(null);
    expect(vp.pickWidget(1, 1)).toBe(null);
    expect(vp.getCamera()).toBe(null);
    expect(vp.worldOf("a")).toBe(null);
    expect(vp.held).toBe(false);
    expect(() => vp.hold()()).not.toThrow();
    expect(() => vp.ride("a")()).not.toThrow();
    vp.labels.sync("x", [{ key: "a", text: "a", position: [0, 0, 0] }]);
    expect(port.querySelectorAll(".label")).toHaveLength(1);
    vp.dispose();
    expect(port.querySelector(".labels")).toBe(null);
  });
});

describe("the atmosphere, drawn", () => {
  /** What the lights, fog and sky are, as plain values. */
  const rig = (vp) => ({
    hemi: [vp.lights.hemi.intensity, vp.lights.hemi.color.getHex(), vp.lights.hemi.groundColor.getHex()],
    key: [vp.lights.key.intensity, vp.lights.key.color.getHex(), r6(vp.lights.key.position.toArray()), r6(vp.lights.key.target.position.toArray()), vp.lights.key.castShadow],
    headlight: vp.lights.headlight.intensity,
    environment: vp.scene.environmentIntensity,
    fog: vp.scene.fog,
    sky: !!vp.sky?.visible,
    shadows: vp.shadows,
  });

  it("none is exactly the stage's own lights, and nothing usable changes nothing", () => {
    const vp = headless();
    const before = rig(vp);
    expect(before).toEqual({ hemi: [LIGHTS.hemisphere, 0xffffff, 0x3a3a3a], key: [LIGHTS.key, 0xffffff, LIGHTS.keyFrom, [0, 0, 0], false], headlight: LIGHTS.headlight, environment: LIGHTS.environment, fog: null, sky: false, shadows: false });
    vp.setAtmosphere(null);
    vp.setAtmosphere({ weather: "rain" });
    expect(rig(vp)).toEqual(before);
    expect(vp.sky).toBeNull();
  });

  it("a sun, sky, fog and exposure go on the lights, fog and sky, and objects cast; taken away, the stage's own is back", () => {
    const vp = headless();
    const before = rig(vp);
    cube(vp, "a", [0, 0, 0], 2);
    vp.setAtmosphere({ sky: { top: "#4080c0", horizon: "#e0d0b0", bottom: "#806040" }, fog: { color: "#e0d0b0", near: 20, far: 120 }, sun: { direction: [0, 1, 0], color: "#ffeecc", intensity: 2, shadows: true }, exposure: 2 });
    expect(rig(vp)).toMatchObject({ hemi: [LIGHTS.hemisphere * 2, 0x4080c0, 0x806040], key: [4, 0xffeecc, [0, 1, 0], [0, 0, 0], true], sky: true, shadows: true });
    expect(vp.scene.fog.near).toBe(20);
    expect(vp.objects.get("a").content.castShadow).toBe(true);
    expect(vp.objects.get("a").content.receiveShadow).toBe(true);
    // the sky is never picked and never counts toward the scene's box
    expect(vp.sceneBox().max.toArray()).toEqual([1, 1, 1]);
    lookFrom(vp, [0, 0, 10]);
    expect(vp.pick(100, 5)).toBeNull();
    vp.setAtmosphere(null);
    expect(rig(vp)).toEqual(before);
    expect(vp.objects.get("a").content.castShadow).toBe(false);
  });

  it("fits the sun's frame about the orbit's target, and moves it (redrawing the map) only when it lands somewhere new", () => {
    const vp = headless();
    cube(vp, "a", [0, 0, 0], 2);
    vp.renderer = { shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false }, setClearColor() {} };
    vp.setAtmosphere({ sun: { direction: [0.45, 1, 0.6], shadows: true } });
    vp.fitted();
    vp.renderer.shadowMap.needsUpdate = false;
    vp.fitSun();
    expect(vp.renderer.shadowMap.needsUpdate).toBe(true);
    const first = vp.lights.key.position.toArray();
    expect(vp.lights.key.shadow.camera.right).toBe(ladderRadius(Math.sqrt(3)));
    // the orbit's target moves a hair: the same frame
    vp.renderer.shadowMap.needsUpdate = false;
    vp.rig.controls.target.set(0.001, 0, 0);
    vp.fitSun();
    expect(vp.renderer.shadowMap.needsUpdate).toBe(false);
    expect(vp.lights.key.position.toArray()).toEqual(first);
    // a new object changes what's covered: fitted again
    cube(vp, "b", [3, 0, 0], 2);
    vp.renderer.shadowMap.needsUpdate = false;
    vp.fitSun();
    expect(vp.renderer.shadowMap.needsUpdate).toBe(true);
    expect(vp.lights.key.position.toArray()).not.toEqual(first);
    vp.renderer = null;
  });
});

describe("the depth range", () => {
  it("a camera inside a big scene's box but 0.4 m from the nearest object gets a near plane of centimetres", () => {
    const vp = headless();
    cube(vp, "far-a", [-40, 0, -40], 2);
    cube(vp, "far-b", [40, 5, 40], 2);
    cube(vp, "near", [0, 0, 0], 1);
    lookFrom(vp, [0, 0, 0.9], [0, 0, -1]);
    vp.fitDepth();
    expect(vp.camera.near).toBeGreaterThan(0.03);
    expect(vp.camera.near).toBeLessThanOrEqual(0.2);
    // hidden, the near object no longer holds the plane in
    vp.applyDisplay("near", { visible: false, transform: { position: [0, 0, 0] } });
    vp.fitDepth();
    expect(vp.camera.near).toBeGreaterThan(1);
    // an extent the camera is inside: it can't be measured
    vp.setExtent("grid", { min: [-10, -1, -10], max: [10, 1, 10] });
    vp.fitDepth();
    expect(vp.camera.near).toBeCloseTo(vp.rig.focusDistance() / 200);
  });

  it("a holder's near and far are the camera's while it holds", () => {
    const vp = headless();
    cube(vp, "c");
    lookFrom(vp, [0, 0, 10]);
    const release = vp.hold();
    vp.setCamera({ near: 0.05, far: 80 });
    vp.fitDepth();
    expect([vp.camera.near, vp.camera.far]).toEqual([0.05, 80]);
    release();
    vp.fitDepth();
    expect(vp.camera.near).not.toBe(0.05);
  });
});

describe("objects", () => {
  it("a group's box is what's shown of its members; a hidden object is neither boxed nor picked", () => {
    const vp = headless();
    cube(vp, "a", [0, 0, 0]);
    cube(vp, "b", [3, 0, 0]);
    vp.setGroups(new Map([["g", ["a", "b"]]]));
    expect(vp.objectBox("g").max.x).toBeCloseTo(3.5);
    vp.applyDisplay("b", { visible: false, transform: { position: [3, 0, 0] } });
    expect(vp.objectBox("g").max.x).toBeCloseTo(0.5);
    expect(vp.raycast([-5, 0, 0], [1, 0, 0], { skip: (id) => id === "a" })).toBe(null);
    expect(vp.raycast([-5, 0, 0], [1, 0, 0]).id).toBe("a");
  });

  it("tells where a move of the camera ended, at a Frame's box; never while the camera is held", () => {
    const vp = headless();
    const end = vi.fn();
    vp.onCameraEnd(end);
    const box = { min: [-1, 0, -1], max: [1, 1, 1] };
    vp.frame(box);
    expect(end).toHaveBeenCalledOnce();
    expect(end.mock.calls[0][1]).toBe("frame");
    expect(r6(end.mock.calls[0][0].target)).toEqual([0, 0.5, 0]);
    const release = vp.hold();
    vp.frame(box);
    vp.rig.controls.dispatchEvent({ type: "end" });
    expect(end).toHaveBeenCalledOnce();
    release();
  });

  it("a loading object's placeholder is in the theme's muted colour as the theme is read, and follows it", () => {
    const vp = headless();
    vp.theme = Object.freeze({ ...vp.theme, muted: [1, 0, 0] });
    vp.setHint("h", { min: [0, 0, 0], max: [1, 1, 1] });
    const look = vp.objects.get("h").placeholder.material;
    expect(look.color.getHexString()).toBe("ff0000");
    vp.readTheme = function () {
      this.theme = Object.freeze({ ...this.theme, muted: [0, 0, 1] });
    };
    vp.applyTheme();
    expect(look.color.getHexString()).toBe("0000ff");
  });

  it("a loop added `first` goes ahead of every loop already there", () => {
    const vp = headless();
    const a = () => {};
    const b = () => {};
    vp.addLoop(a);
    const offB = vp.addLoop(b, { first: true });
    expect([...vp.loops]).toEqual([b, a]);
    offB();
    expect([...vp.loops]).toEqual([a]);
  });

  it("tells theme listeners about a new set of tokens", () => {
    const vp = headless();
    const fn = vi.fn();
    const off = vp.onTheme(fn);
    const before = vp.theme;
    vp.applyTheme();
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0]).toBe(vp.theme);
    expect(vp.theme).not.toBe(before);
    off();
    vp.applyTheme();
    expect(fn).toHaveBeenCalledOnce();
  });
});

// A link's content is its doc (STAGE.md, "Views, stages and links"): the roots of the stage it
// opens hang in the link's body, so hiding the link hides its doc, as hiding
// any object hides what it's made of, while an attachment of the link's own
// doc stays shown. Every case of the link shown / hidden / under a hidden
// group × the child an attachment (same stage) or a linked doc's root
// (another stage): drawn, picked, boxed, its stage's layers and labels; and
// boxed in its own stage, which only its own doc's display decides.
describe("a hidden link hides its doc", () => {
  const LINKED = keyOf(1, "card");
  const cases = [];
  for (const how of ["shown", "hidden", "group hidden"]) for (const child of ["attachment", "linked root"]) cases.push([how, child]);

  for (const [how, child] of cases) {
    it(`link ${how}, its child ${child === "attachment" ? "an attachment of the host's" : "a linked doc's root"}`, () => {
      const vp = headless();
      lookFrom(vp, [0, 0, 10]);
      vp.applyDisplay("G", { kind: "group", visible: how !== "group hidden" });
      vp.applyDisplay("L", { visible: how !== "hidden", transform: { position: [0, 0, 0] } }, "G", { visible: how !== "group hidden", opacity: 1 });
      const key = child === "attachment" ? "a" : LINKED;
      cube(vp, key, [0, 0, 0], 1);
      vp.applyDisplay(key, { transform: { position: [0, 0, 0] } }, "L");
      const entry = vp.objects.get(key);
      // where it hangs: a linked root in the link's body, an attachment beside it; either way the link's frame
      expect(entry.group.parent).toBe(child === "attachment" ? vp.objects.get("L").group : vp.objects.get("L").body);
      // a linked doc's layer and labels hang where its root does
      const layer = vp.worldLayer(keyOf(1, "t.ext"), { under: "L" });
      layer.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial()));
      vp.labels.sync(keyOf(1, "t.ext"), [{ key: "x", text: "Seat", position: [0, 0, 0] }], () => null, () => vp.contentShown("L"));
      vp.followLayers();
      vp.labels.update(() => ({ x: 1, y: 1 }));
      const label = [...vp.labels.groups.get(keyOf(1, "t.ext")).values()][0].el;

      const linkDrawn = how === "shown";
      const shown = child === "attachment" ? how !== "group hidden" : linkDrawn;
      expect(vp.isShown(key)).toBe(shown);
      expect(vp.tree.bodies().includes(entry.body)).toBe(shown);
      expect(vp.objectBox(key) != null).toBe(shown);
      expect(vp.contentShown("L")).toBe(linkDrawn);
      expect(!!vp.pickWidget(100, 50)).toBe(linkDrawn);
      expect(label.style.display).toBe(linkDrawn ? "" : "none");
      // its own stage's boxes (api.box, groupBox, sceneBox: I7, "boxes are S's own"): a linked root's is its
      // doc's say, whatever the host does with the link; an attachment's, its own doc's (the host's) as drawn
      expect(vp.objectBox(key, { inStage: true }) != null).toBe(child === "attachment" ? shown : true);
      if (child === "linked root") {
        expect(vp.sceneBox({ stage: 1 }).isEmpty()).toBe(false);
        // and its own doc hiding it does take it away
        vp.applyDisplay(key, { visible: false, transform: { position: [0, 0, 0] } }, "L");
        expect(vp.objectBox(key, { inStage: true })).toBe(null);
        expect(vp.sceneBox({ stage: 1 }).isEmpty()).toBe(true);
      }
    });
  }

  it("the link's frame is its doc's, hanging in the body or not; removing the link leaves its doc's roots in the world", () => {
    const vp = headless();
    vp.applyDisplay("L", { transform: { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 } });
    cube(vp, LINKED, [0, 0, 0], 1);
    vp.applyDisplay(LINKED, { transform: { position: [1, 0, 0] } }, "L");
    cube(vp, "a", [0, 0, 0], 1);
    vp.applyDisplay("a", { transform: { position: [1, 0, 0] } }, "L");
    expect(r6(vp.worldOf(LINKED))).toEqual(r6(vp.worldOf("a")));
    vp.removeObject("L");
    for (const k of [LINKED, "a"]) expect(vp.objects.get(k).group.parent).toBe(vp.content);
  });
});

// I7 for what a linked doc draws (the frame audit): a layer of a stage two
// links deep hangs where its root does, and a group the extension places in
// it at an object's displayed matrix in the stage's frame (as Camber's
// dressing does, from api.worldOf) lands on the object in the world, for
// every pose of the two links over a finite set, and again after the links
// move. (Before the layer's anchor, the viewport put the layer group itself
// at the root, overwriting the matrix the extension set on it.)
describe("I7: a linked doc's layers, two links deep", () => {
  const POSES = [
    { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 },
    { position: [-1, 2.5, 3], rotation: [0.35, 0, 0], scale: 1 },
    { position: [0, 1, 0], rotation: [0.3, 1.1, -0.7], scale: 0.5 },
  ];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  it("every pose of each link, held and then moved: the extension's group is on the object", () => {
    let n = 0;
    for (const p1 of POSES)
      for (const p2 of POSES) {
        const vp = headless();
        const L2 = keyOf(1, "L2");
        const X = keyOf(2, "x");
        vp.applyDisplay("L1", { transform: p1 });
        vp.applyDisplay(L2, { transform: p2 }, "L1");
        vp.applyDisplay(X, { transform: { position: [1, 0.5, 0], rotation: [0, 0.4, 0], scale: 1 } }, L2);
        const sc = scopeViewport(vp, { n: 2, root: L2, frame: () => vp.worldOf(L2) });
        const layer = sc.worldLayer("dress");
        layer.matrixAutoUpdate = false;
        const place = () => {
          layer.matrix.fromArray(sc.worldOf("x"));
          vp.followLayers();
          layer.updateMatrixWorld(true);
          layer.parent.updateMatrixWorld(true);
          return near(Array.from(layer.matrixWorld.elements), vp.worldOf(X));
        };
        expect(place()).toBe(true);
        // the outer link moves (a heel, a drift): the layer follows, the group stays on the object
        vp.applyDisplay("L1", { transform: { ...p1, rotation: [0.35, p1.rotation[1], 0] } });
        expect(place()).toBe(true);
        n++;
      }
    expect(n).toBe(16);
  });

  // a label `on` an object (api.labels): where it is drawn each frame (a held pose too), in a linked stage's frame
  it("a label on an object sits at its offset there as drawn, for every pose of the link; nowhere while it isn't drawn", () => {
    for (const p1 of POSES) {
      const vp = headless();
      const X = keyOf(1, "x");
      vp.applyDisplay("L1", { transform: p1 });
      vp.applyDisplay(X, { transform: { position: [1, 0.5, 0] } }, "L1");
      scopeViewport(vp, { n: 1, root: "L1", frame: () => vp.worldOf("L1") }).labels.sync("tags", [{ key: "k", text: "t", on: "x", offset: [0, 1, 0] }]);
      const el = vp.labels.el.querySelector(".label");
      let seen = null;
      const at = () => (vp.labels.update((v) => ((seen = v.toArray()), { x: 0, y: 0 })), el.style.display === "none" ? null : seen);
      const onX = () => near(at(), applyMatrix(vp.worldOf(X), [0, 1, 0]));
      expect(onX()).toBe(true);
      vp.setPose(X, { position: [0, 2, 0], rotation: [0, 1, 0], scale: 1 });
      expect(onX()).toBe(true);
      vp.applyDisplay(X, { visible: false, transform: { position: [1, 0.5, 0] } }, "L1");
      expect(at()).toBe(null);
      vp.applyDisplay(X, { transform: { position: [1, 0.5, 0] } }, "L1");
      expect(onX()).toBe(true);
      vp.removeObject(X);
      expect(at()).toBe(null);
    }
  });
});
