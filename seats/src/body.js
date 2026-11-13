// The seat body: a viewer sitting in a seat, the eye where the seat's camera
// says and riding the object that camera is `in` (a table aboard a ship), so
// the table holds still in front of them however she rolls.
//
// TOOLS.md §4 makes the seat one of the viewer's bodies, and COMPOSITION.md
// decision 5 puts it here. The stage has no bodies yet (build step 6): until
// then the seats part (seats.js) enters it itself, through api.camera, when
// someone sits down or comes back from first person, and leaves it when they
// stand up or move. At step 6 it is contributed as `bodies`, with the keys,
// lock and reach the stage will read; the stage applies its ride; and the
// part's waiting on first person goes.

import { applyMatrix } from "./transform.js";
import { seatsOf } from "./model.js";

/**
 * Where a seat puts the camera, in the world: its camera with `position` and
 * `target` taken through `frame`, the drawn matrix of the object it is `in`.
 * A camera in no frame is the world's, as given. Null when there is nothing
 * to put it at: no camera, or a frame that's gone (its table deleted). Pure.
 * @param {{ position?: number[], target?: number[], in?: string } | null | undefined} cam
 * @param {number[] | null} frame  the drawn matrix of `cam.in`, null if it isn't drawn
 * @returns {object | null}  what api.camera.set takes
 */
export function seatPose(cam, frame) {
  if (!cam || typeof cam !== "object") return null;
  const { in: within, ...view } = cam;
  if (!within) return structuredClone(view);
  if (!frame || !Array.isArray(cam.position)) return null;
  return { ...structuredClone(view), position: applyMatrix(frame, cam.position), target: applyMatrix(frame, cam.target ?? [0, 0, 0]) };
}

/**
 * The seat body, on one extension's api.
 * `enter(sid)` puts the view in seat `sid` as it is drawn now and, when its
 * camera is in a frame, rides that frame at the spot the seat looks at; it
 * answers the sitting, `{ seat, leave() }`, or null (no such seat, no
 * camera, or its frame gone: the view stays as it is).
 */
export function seatBody(api) {
  /** An object's matrix as drawn (a held pose included), else as the doc has it; null if it's gone. */
  const drawn = (snap, id) => api.worldOf(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
  return {
    id: "seat",
    label: "Seated",
    enter(sid) {
      const snap = api.scene();
      const cam = seatsOf(snap)[sid]?.camera;
      const frame = cam?.in ? drawn(snap, cam.in) : null;
      const pose = seatPose(cam, frame);
      if (!pose) return null;
      api.camera.set(pose);
      const off = frame ? (api.camera.ride(cam.in, { at: [...(cam.target ?? [0, 0, 0])] }) ?? null) : null;
      let left = false;
      return {
        seat: sid,
        leave() {
          if (left) return;
          left = true;
          off?.();
        },
      };
    },
  };
}
