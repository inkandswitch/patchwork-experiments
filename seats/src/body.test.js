// The seat body (body.js): where a seat puts the camera, over every kind of
// seat camera and frame, and entering and leaving it on a stand-in stage.
import { afterEach, describe, it, expect, vi } from "vitest";
import { seatBody, seatPose } from "./body.js";
import { SEATS } from "./model.js";
import { applyMatrix } from "./transform.js";
import * as fakes from "./test/fake-world.js";
import { emptyScene } from "./test/empty-scene.js";

afterEach(() => vi.useRealTimers());

const near = (got, want) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9));
// frames: the world's own, a table turned and raised, one heeled 20° aboard, one at half scale
const FRAMES = {
  identity: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  turned: { position: [2, 0.7, -1], rotation: [0, Math.PI / 3, 0], scale: 1 },
  heeled: { position: [-4, 1.1, 3], rotation: [0, 0.4, (20 * Math.PI) / 180], scale: 1 },
  half: { position: [1, 0, 1], rotation: [0.1, 0.2, 0.3], scale: 0.5 },
};
// cameras: every combination of position, target, an extra field, and a frame
const CAMS = [];
for (const position of [undefined, [0, 1.2, 0.95]])
  for (const target of [undefined, [0, 0.7, 0.16]])
    for (const fov of [undefined, 40])
      for (const within of [undefined, "tbl"]) CAMS.push(Object.fromEntries(Object.entries({ position, target, fov, in: within }).filter(([, v]) => v !== undefined)));

describe("seatPose (pure)", () => {
  it("no camera: nothing", () => {
    for (const cam of [undefined, null, 3, "x"]) for (const m of [null, fakes.composeMatrix(FRAMES.turned)]) expect(seatPose(cam, m)).toBe(null);
  });

  it("every camera × every frame, drawn or gone: in the world as given; in a frame, through it; in a gone frame, or with no position there, nothing", () => {
    for (const cam of CAMS) {
      for (const [name, t] of [...Object.entries(FRAMES), ["gone", null]]) {
        const m = t ? fakes.composeMatrix(t) : null;
        const before = structuredClone(cam);
        const got = seatPose(cam, m);
        const label = JSON.stringify({ cam, name });
        expect(cam, label).toEqual(before); // never writes what it's given
        if (!cam.in) {
          // the world's: as given, a copy, whatever frame is passed
          expect(got, label).toEqual(cam);
          if (got) expect(got.position ?? null, label).not.toBe(cam.position ?? 1);
          continue;
        }
        if (!m || !cam.position) {
          expect(got, label).toBe(null);
          continue;
        }
        expect("in" in got, label).toBe(false);
        expect(got.fov, label).toBe(cam.fov);
        near(got.position, applyMatrix(m, cam.position));
        near(got.target, applyMatrix(m, cam.target ?? [0, 0, 0]));
        expect(Object.keys(got).sort(), label).toEqual(Object.keys(cam).filter((k) => k !== "in").concat(cam.target ? [] : ["target"]).sort());
      }
    }
  });
});

describe("the seat body, entered and left", () => {
  /** A table at FRAMES[frame] with seat p1 looking at it from `cam`, and one view of it. */
  function world(cam, frame = "heeled") {
    const doc = emptyScene({ objects: { tbl: { name: "Table", transform: FRAMES[frame] } }, order: ["tbl"], traits: { [SEATS]: { p1: { name: "Player 1", player: null, ...(cam ? { camera: cam } : {}) } } } });
    const w = fakes.fakeWorld(doc);
    const api = w.join("A", { viewer: "ana", ext: "seats" });
    return { w, api, view: w.view("A"), body: seatBody(api) };
  }

  it("is the `seat` body", () => {
    const { body } = world(null);
    expect(body).toMatchObject({ id: "seat", label: "Seated" });
    expect(typeof body.enter).toBe("function");
  });

  it("every camera, its frame drawn, gone, or none: sets the view and rides exactly when seatPose has a pose and the camera is in a frame", () => {
    for (const cam of CAMS) {
      for (const gone of [false, true]) {
        const { w, api, view, body } = world(cam);
        if (gone) w.change((d) => delete d.objects.tbl);
        api.camera.set({ position: [30, 6, 30], target: [0, 2, 0] });
        const want = seatPose(cam, cam.in && !gone ? api.worldOf("tbl") : null);
        const sat = body.enter("p1");
        const label = JSON.stringify({ cam, gone });
        if (!want) {
          expect(sat, label).toBe(null);
          expect(view.camera, label).toEqual({ position: [30, 6, 30], target: [0, 2, 0] });
          expect(view.rides, label).toEqual([]);
          w.done();
          continue;
        }
        expect(sat.seat, label).toBe("p1");
        expect(view.camera, label).toEqual(want);
        expect(view.rides, label).toEqual(cam.in ? [{ id: "tbl", opts: { at: cam.target ?? [0, 0, 0] } }] : []);
        sat.leave();
        expect(view.rides, label).toEqual([]);
        sat.leave(); // twice is once
        expect(view.rides, label).toEqual([]);
        w.done();
      }
    }
  });

  it("a seat that isn't there, or a seats map that isn't: nothing, and the view stays", () => {
    const { w, api, view, body } = world({ position: [0, 1, 1], in: "tbl" });
    api.camera.set({ position: [1, 1, 1] });
    expect(body.enter("p9")).toBe(null);
    w.change((d) => delete d.traits[SEATS]);
    expect(body.enter("p1")).toBe(null);
    expect(view.camera).toEqual({ position: [1, 1, 1] });
    expect(view.rides).toEqual([]);
    w.done();
  });

  it("through the table as drawn, a peer's held pose included", () => {
    const cam = { position: [0, 1.2, 0.95], target: [0, 0.7, 0.16], in: "tbl" };
    const { w, api, view, body } = world(cam, "identity");
    // someone else is moving the table: the view goes where it's drawn, not where the doc last had it
    const other = w.join("B", { viewer: "ben", ext: "seats" });
    other.pose.hold("tbl", FRAMES.turned);
    body.enter("p1");
    near(view.camera.position, applyMatrix(fakes.composeMatrix(FRAMES.turned), cam.position));
    expect(api.worldOf("tbl")).toEqual(fakes.composeMatrix(FRAMES.turned));
    w.done();
  });
});
