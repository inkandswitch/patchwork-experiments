// A machine's cabinet as a GLB: a box standing on the floor with a bezel on
// its front, the screen's place left in it. Pure: no DOM, no three.js.
//
// The GLB's frame: metres, Y up, the cabinet standing on y = 0 over the
// origin, its front facing +z. Where its screen is goes in the GLB too, as
// `extras.machine.screen` on the glTF scene: the screen's centre in that
// frame, and its width and height, in the shape the machine's pictures are
// meant to be seen (ASPECT in ../present/screen.js). The scene extension
// draws the machine's picture there, read from the very thing it is showing
// (as dice read a die), never from a second copy of these numbers.

import { computeBounds, encodeGLB } from "./glb.js";
import { ASPECT } from "../present/screen.js";

/** The screen's width (m); its height follows from the machine's aspect. */
export const SCREEN_WIDTH = 0.72;
// Each machine's picture as seen, at its usual size: Doom's 320x200, the Super NES's 256x224.
const USUAL = { doom: [320, 200], snes: [256, 224] };

export const BODY = { width: 0.9, height: 1.75, depth: 0.7 };
const SCREEN_Y = 1.3; // the screen's centre above the floor
const BEZEL = 0.06; // round the screen
const PROUD = 0.002; // the picture stands this far off the bezel

const trim = (v) => +(+v).toFixed(6) + 0;

// A box's 24 corners (4 a face, so each face has its own normal) and 36 indices.
function box([x0, y0, z0], [x1, y1, z1], color) {
  const faces = [
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  const positions = [], normals = [], indices = [];
  for (const [n, quad] of faces) {
    const at = positions.length / 3;
    for (const p of quad) positions.push(...p), normals.push(...n);
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return { positions, normals, indices, color };
}

/** Where the screen is in the cabinet's frame, for a machine of this kind. */
export function screenOf(kind) {
  const width = SCREEN_WIDTH;
  const height = width / (ASPECT[kind] ?? ASPECT.square)(...(USUAL[kind] ?? [4, 3]));
  return { center: [0, SCREEN_Y, trim(BODY.depth / 2 + BEZEL / 2 + PROUD)], width, height: trim(height) };
}

/** The cabinet for a machine doc ({ kind }): { glb, bounds, screen }. */
export function cabinetGLB(kind) {
  const screen = screenOf(kind);
  const { width: W, height: H, depth: D } = BODY;
  const [w, h] = [screen.width / 2 + BEZEL, screen.height / 2 + BEZEL];
  const body = box([-W / 2, 0, -D / 2], [W / 2, H, D / 2], "#2b2f36");
  const bezel = box([-w, SCREEN_Y - h, D / 2], [w, SCREEN_Y + h, D / 2 + BEZEL / 2], "#0d0f12");
  const meshes = [
    { name: "cabinet", primitives: [{ ...body, roughness: 0.7 }] },
    { name: "bezel", primitives: [{ ...bezel, roughness: 0.4 }] },
  ];
  const glb = encodeGLB({ meshes, extras: { machine: { v: 1, kind, screen } }, generator: "machine cabinet" });
  const bounds = computeBounds([...body.positions, ...bezel.positions]);
  return { glb, bounds, screen };
}
