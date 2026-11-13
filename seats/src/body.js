// The seat body (scene/TOOLS.md §4; COMPOSITION.md decision 5 puts it
// here): a viewer sitting in a seat, the eye where the seat's camera says,
// riding the object that camera is `in` (a table aboard a ship), so the
// table holds still in front of them however she rolls. It reserves no
// keys, so D draws; it doesn't lock the pointer; and it needs a place (a
// seat), so the body chip doesn't offer it: the picker and the seat's verb
// enter it. Sitting pushes it over whatever body you had (walking her deck,
// or orbit); standing up pops it, and that body carries on.

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

/** How far a seated viewer reaches (m): across a table. */
export const SEAT_REACH = 2;

/**
 * The seat body, on one extension's api, as the stage's `bodies` takes it.
 * `enter(sid)` puts the view in seat `sid` as it is drawn now and, when its
 * camera is in a frame, rides that frame at the spot the seat looks at; it
 * answers the sitting ({ seat, input, ride, leave() }), or null (no such
 * seat, no camera, or its frame gone: the view stays as it is).
 * @param {object} api
 * @param {{ left?: (sid: string) => void }} [hooks]  told when a sitting ends (stood up, Leave, or popped)
 */
export function seatBody(api, { left } = {}) {
  /** An object's matrix as drawn (a held pose included), else as the doc has it; null if it's gone. */
  const drawn = (snap, id) => api.worldOf(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
  return {
    id: "seat",
    label: "Seated",
    keys: [],
    lock: false,
    reach: SEAT_REACH,
    // it needs a seat: the chip doesn't offer it
    here: false,
    enter(sid) {
      const snap = api.scene();
      const cam = seatsOf(snap)[sid]?.camera;
      const frame = cam?.in ? drawn(snap, cam.in) : null;
      const pose = seatPose(cam, frame);
      if (!pose) return null;
      api.camera.set(pose);
      let gone = false;
      return {
        seat: sid,
        input: {
          // a body over it went (walking her deck, from here): the seat's view again, as it is drawn now
          resumed() {
            const snapNow = api.scene();
            const camNow = seatsOf(snapNow)[sid]?.camera;
            const again = seatPose(camNow, camNow?.in ? drawn(snapNow, camNow.in) : null);
            if (again) api.camera.set(again);
          },
        },
        // the body's ride: the only one while seated
        ride: frame ? { id: cam.in, at: [...(cam.target ?? [0, 0, 0])] } : null,
        leave() {
          if (gone) return;
          gone = true;
          left?.(sid);
        },
      };
    },
  };
}
