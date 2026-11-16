// probes/frame.mjs, a publisher's home fitter (a probe's module, tested here
// because vitest runs src/; sailing/probes/frame.mjs is a verbatim copy).
// Finite cases only: the projection and the matrices are held to three's own
// camera and Matrix4 (the stage's camera is a three PerspectiveCamera), and
// every fit is held to the pane, to tightness and to wider panes.
import { describe, it, expect } from "vitest";
import { Euler, Matrix4, Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { FOV, LINK, MARGIN, PANES, apply, contentOf, corners, drawnBoxes, fitHome, framing, matrixOf, multiply, project, specPoints } from "../probes/frame.mjs";

const ANGLES = [-1.2, 0, 0.7];
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

describe("frame.mjs: matrices are three's", () => {
  it("matrixOf is Matrix4.compose with an XYZ Euler, for every rotation in a 3×3×3 grid and three scales", () => {
    let n = 0;
    for (const x of ANGLES)
      for (const y of ANGLES)
        for (const z of ANGLES)
          for (const s of [1, 0.04, [1, 2, 3]]) {
            const t = { position: [1.5, -2, 3.25], rotation: [x, y, z], scale: s };
            const want = new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ")), new Vector3(...(Array.isArray(s) ? s : [s, s, s]))).toArray();
            expect(close(matrixOf(t), want, 1e-12)).toBe(true);
            n++;
          }
    expect(n).toBe(81);
  });

  it("multiply is Matrix4.multiply", () => {
    for (const a of ANGLES)
      for (const b of ANGLES) {
        const m = matrixOf({ position: [1, 2, 3], rotation: [a, b, 0.3], scale: 2 });
        const n = matrixOf({ position: [-4, 0.5, 9], rotation: [b, 0.1, a], scale: 0.5 });
        const want = new Matrix4().fromArray(m).multiply(new Matrix4().fromArray(n)).toArray();
        expect(close(multiply(m, n), want, 1e-12)).toBe(true);
      }
  });
});

describe("frame.mjs: project is the stage's camera", () => {
  const homes = [
    { position: [0, 55, 125], target: [0, 0, 17.5] },
    { position: [-12.6, 28, 80.7], target: [-18.6, 0, 0.7] },
    { position: [3, 1, -4], target: [0, 0.5, 0] },
  ];
  const points = [[0, 0, 0], [10, 2, -5], [-30, 0, 40], [5, 16, -100]];
  it("x and y as three's PerspectiveCamera.project, for 3 homes × 4 points × 2 panes", () => {
    let n = 0;
    for (const home of homes)
      for (const pane of PANES) {
        const cam = new PerspectiveCamera(FOV, pane.width / pane.height, 0.01, 1000);
        cam.position.set(...home.position);
        cam.lookAt(new Vector3(...home.target));
        cam.updateMatrixWorld();
        for (const p of points) {
          const q = project(home, p, pane);
          const v = new Vector3(...p).project(cam);
          expect(Math.abs(q.x - v.x)).toBeLessThan(1e-9);
          expect(Math.abs(q.y - v.y)).toBeLessThan(1e-9);
          n++;
        }
      }
    expect(n).toBe(24);
  });
});

describe("frame.mjs: fitHome", () => {
  // three box sets: one cube; a long thin box turned 45°; two blocks far apart, one low and one tall
  const SETS = {
    cube: corners([-1, -1, -1], [1, 1, 1]),
    long: corners([-58, -11, -111], [58, 16, 111], matrixOf({ position: [63, 0, -83], rotation: [0, -Math.PI / 4, 0] })),
    pair: [...corners([-15, -3, -15], [15, 15.5, 15], matrixOf({ position: [-20, 0, 35], rotation: [0, 0.35, 0] })), ...corners([-2, 0, -2], [2, 0.6, 9], matrixOf({ position: [30, 0, -10] }))],
  };
  const PITCHES = [5, 27, 60];
  const HEADINGS = [0, 45, -120];
  const ASPECTS = [0.5, 0.8, 1.6];
  const WIDER = [0.5, 0.8, 1, 1.6, 2.5];

  it("every point inside the margin, the fit tight (a point at the margin), a step nearer leaves one out, and every wider pane frames it too: 3 sets × 3 pitches × 3 headings × 3 aspects", () => {
    let n = 0;
    for (const [name, pts] of Object.entries(SETS))
      for (const pitch of PITCHES)
        for (const heading of HEADINGS)
          for (const aspect of ASPECTS) {
            const home = fitHome(pts, { aspect, pitch, heading });
            const pane = { width: aspect * 1000, height: 1000 };
            const fr = framing(home, pts, pane, { within: MARGIN + 1e-4 });
            expect(fr.inside, `${name} p${pitch} h${heading} a${aspect}`).toBe(true);
            const reach = Math.max(-fr.x[0], fr.x[1], -fr.y[0], fr.y[1]);
            expect(reach, `${name} p${pitch} h${heading} a${aspect} is tight`).toBeGreaterThan(MARGIN - 1e-3);
            // a step of 1% of its distance nearer, along its line of sight
            const f = home.target.map((v, i) => v - home.position[i]);
            const step = { position: home.position.map((v, i) => v + 0.01 * f[i]), target: home.target };
            expect(framing(step, pts, pane, { within: MARGIN }).inside, `${name} p${pitch} h${heading} a${aspect} one step nearer`).toBe(false);
            for (const wide of WIDER.filter((w) => w >= aspect)) expect(framing(home, pts, { width: wide * 1000, height: 1000 }, { within: MARGIN + 1e-4 }).inside).toBe(true);
            // its pitch and heading are the ones asked for
            const len = Math.hypot(...f);
            expect(Math.abs(Math.asin(-f[1] / len) - (pitch * Math.PI) / 180)).toBeLessThan(1e-3);
            n++;
          }
    expect(n).toBe(81);
  });

  it("fitted to the narrow pane, a home frames its points in both checked panes", () => {
    for (const pts of Object.values(SETS)) {
      const home = fitHome(pts);
      for (const pane of PANES) expect(framing(home, pts, pane).inside).toBe(true);
    }
  });

  it("refuses nothing to frame and a view straight down", () => {
    expect(() => fitHome([])).toThrow(/nothing/);
    expect(() => fitHome(SETS.cube, { pitch: 90 })).toThrow(/pitch/);
  });
});

describe("frame.mjs: drawnBoxes", () => {
  const doc = {
    assets: { a: { url: "automerge:hull", hint: { bounds: { min: [-1, -2, -6], max: [1, 2, 6] } } }, b: { url: "automerge:mast", hint: { bounds: { min: [-0.1, 0, -0.1], max: [0.1, 14, 0.1] } } }, c: { url: "automerge:plain" } },
    objects: {
      hull: { name: "Hull", sourceUrl: "automerge:hull", parent: null, transform: { position: [3, 0, -4], rotation: [0, 0.7, 0], scale: 1 } },
      mast: { name: "Mast", sourceUrl: "automerge:mast", parent: "hull", transform: { position: [0, 1.4, -1.6], rotation: [0.1, 0, 0], scale: 1 } },
      hidden: { name: "Hidden", sourceUrl: "automerge:hull", parent: null, visible: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
      plain: { name: "Plain", sourceUrl: "automerge:plain", parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
      group: { name: "Group", parent: null },
    },
  };
  const link = matrixOf({ position: [20, 0, 0], rotation: [0, -0.5, 0], scale: 0.04 });

  it("every visible object with hinted bounds, carried through its parents and the link, as three's object tree places it", () => {
    const got = drawnBoxes(doc, link);
    expect(got.map((b) => b.id)).toEqual(["hull", "mast"]);
    const root = new Object3D();
    root.applyMatrix4(new Matrix4().fromArray(link));
    const hull = new Object3D();
    hull.position.set(3, 0, -4);
    hull.rotation.set(0, 0.7, 0);
    const mast = new Object3D();
    mast.position.set(0, 1.4, -1.6);
    mast.rotation.set(0.1, 0, 0);
    root.add(hull);
    hull.add(mast);
    root.updateMatrixWorld(true);
    for (const [box, obj, b] of [[got[0], hull, doc.assets.a.hint.bounds], [got[1], mast, doc.assets.b.hint.bounds]]) {
      const want = corners(b.min, b.max, obj.matrixWorld.toArray());
      box.points.forEach((p, i) => expect(close(p, want[i], 1e-9)).toBe(true));
    }
  });
});

describe("frame.mjs: contentOf", () => {
  const box = { url: "automerge:box", hint: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } };
  const leaf = { assets: { box }, objects: { b: { name: "Box", sourceUrl: "automerge:box", parent: null, transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 } } } };
  const link = (url, position, scale = 1, extra = {}) => ({ name: url, sourceUrl: url, providerId: LINK, parent: null, transform: { position, rotation: [0, 0, 0], scale }, ...extra });
  const mid = { assets: {}, objects: { L: link("automerge:leaf", [10, 0, 0], 2), back: link("automerge:host", [0, 0, 0]), gone: link("automerge:gone", [0, 0, 0]) } };
  const host = { assets: { box }, objects: { own: { name: "Own", sourceUrl: "automerge:box", parent: null }, M: link("automerge:mid", [0, 5, 0]), hid: link("automerge:leaf", [0, 0, 0], 1, { visible: false }), lost: link("automerge:lost", [0, 0, 0]) } };
  const docs = { "automerge:leaf": leaf, "automerge:mid": mid, "automerge:host": host };

  it("its own boxes, more's, and each held link's carried by the link, two deep; missing links with their depth; no way back in", () => {
    const more = (d, m) => (d === leaf ? [{ id: "w", name: "Water", points: [apply(m, [0, -1, 0])] }] : []);
    const { boxes, missing } = contentOf(host, docs, { more, inside: ["automerge:host"] });
    expect(boxes.map((b) => `${b.via.join("/")}:${b.id}`)).toEqual([":own", "M/L:b", "M/L:w"]);
    // the leaf's box: x 1..2 in the leaf, ×2 and +10 in mid, +5 up in the host
    const b = boxes[1].points;
    expect(Math.min(...b.map((p) => p[0]))).toBe(12);
    expect(Math.max(...b.map((p) => p[0]))).toBe(14);
    expect(Math.min(...b.map((p) => p[1]))).toBe(5);
    expect(boxes[2].points).toEqual([[10, 3, 0]]);
    expect(missing).toEqual([{ id: "gone", url: "automerge:gone", depth: 1 }, { id: "lost", url: "automerge:lost", depth: 0 }]);
  });
});

describe("frame.mjs: specPoints", () => {
  it("a box's centre, size and yaw, as three's object places a box that size, carried by m", () => {
    const m = matrixOf({ position: [20, 0, 0], rotation: [0, 0.3, 0], scale: 2 });
    const got = specPoints("43.5,-2.5,-83.2:116.2,27,223.2@-45", m);
    const o = new Object3D();
    o.position.set(43.5, -2.5, -83.2);
    o.rotation.set(0, -Math.PI / 4, 0);
    const root = new Object3D();
    root.applyMatrix4(new Matrix4().fromArray(m));
    root.add(o);
    root.updateMatrixWorld(true);
    const want = corners([-58.1, -13.5, -111.6], [58.1, 13.5, 111.6], o.matrixWorld.toArray());
    got.forEach((p, i) => expect(close(p, want[i], 1e-9)).toBe(true));
    expect(specPoints("1,2,3:4,5,6")).toEqual(corners([-2, -2.5, -3], [2, 2.5, 3], matrixOf({ position: [1, 2, 3] })));
  });
  it("null for every malformed box in a finite list", () => {
    for (const bad of ["", "1,2,3", "1,2:4,5,6", "1,2,3:4,5", "1,2,3:4,0,6", "1,2,3:4,-5,6", "1,2,3:4,5,6@", "1,2,3:4,5,6@x", "1,2,3:4,5,6@1@2", "1,,3:4,5,6", "1,2,3:4,5,6:7,8,9", "a,2,3:4,5,6"]) expect(specPoints(bad), bad).toBeNull();
  });
});
