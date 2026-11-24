// The crew (DESIGN.md, "Play"): coming aboard her and standing at a
// station. Walking her deck, going over the side, swimming and climbing her
// ladder are walk's (walk/DESIGN.md, "Standing on supports"): her hull is a
// support, each station a stand spot, her ladder a ladder and her spawn a
// spawn point (the walk.* traits parts.js writes on her pieces). Sailing
// reaches walk only at run time:
// - Come aboard enters walk at her hull: api.body.enter("walk", hull);
// - a station is the "station" body, pushed over walk in her stage. Taking
//   it asks walk to stand you at the station's stand spot (walk's `stand`
//   contribution: walk puts its walker there, on her deck), and the body's
//   eye is that walker's eye as walk draws it each frame. Leaving pops it,
//   and walk resumes where it stands: the spot. Where the spot is and how
//   high the eye is are walk's alone; who stands there is the station's
//   own claim, which its verb holds (stations.js) and the spot names;
// - what the viewer is doing is read, never kept here: the top body
//   (api.view.get().body: its declared keys too), walk's avatar in this
//   stage (its `avatar` contribution: on, feet, yaw, pitch, swimming) and
//   the station this crew's body is at.
//
// Before anyone comes aboard the camera is the orbit's and rides her
// (follow), where her doc is the world.

import { headingOf, onHeading } from "./frames.js";
import { QUARTER, partsOf, shipOf } from "./traits.js";
import { bodyOf } from "./body.js";
import { MAX_SUBSTEPS, SUBSTEP } from "./physics.js";

/** How far the station body reaches (m): the bodies' reach (scene/STAGE.md, "Bodies"). Walking, walk's own is the body's. */
export const REACH = 2.5;
/** How far down you look on taking a station (rad). */
const PITCH = -0.2;

/** The forward vector for a yaw (0 looks down −Z) and pitch. */
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** Turn by a mouse movement: pitch held short of straight up and down. */
export function look(yaw, pitch, dx, dy, sensitivity = 0.0022) {
  const limit = Math.PI / 2 - 0.01;
  return { yaw: yaw - dx * sensitivity, pitch: Math.max(-limit, Math.min(limit, pitch - dy * sensitivity)) };
}

/** The look (yaw to `heading`, and pitch up) from an eye to a world point: lookDir's inverse. Pure. */
export function aimOf(eye, at, heading) {
  const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
  return { yaw: Math.atan2(-dx, -dz) - heading, pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * Is the view under a body that is neither hers nor walk's (a seat at a
 * table aboard her: scene/STAGE.md, "Bodies")? Then nobody is working her: the keys
 * are the seat's.
 */
export const seatedView = (api) => {
  const b = api?.view?.get?.()?.body;
  return (b?.depth ?? 0) > 0 && b.ext !== api.id && b.id !== "walk";
};

/**
 * What the viewer is doing, for the HUD, the stations and the sim (pure):
 * from the top body, walk's avatar here (null when not walking in this
 * stage), the station this crew's body is at (and its ship), and the pointer.
 */
export function viewerOf({ body = null, avatar = null, station = null, ship = null, pointer = {}, eye = null, hint = null } = {}) {
  const walking = body?.id === "walk" && !!avatar;
  const playing = !!station || walking;
  return {
    playing,
    // the browser let the lock go (its Escape): a click takes it back
    paused: playing && !!pointer.released,
    // no lock (refused, or something wants the pointer): drag to look
    free: playing && !pointer.locked && !pointer.released,
    on: station ? ship : (avatar?.on ?? null),
    position: avatar?.feet ?? null,
    yaw: avatar?.yaw ?? 0,
    pitch: avatar?.pitch ?? 0,
    eye,
    station: station ?? null,
    swimming: walking && !!avatar.swimming,
    hint: station ? hint : null,
    // what the top body declares it takes (walk's walking keys, while walking)
    keys: Array.isArray(body?.keys) ? body.keys : [],
  };
}

// ─── the crew ───────────────────────────────────────────────────────────────

/**
 * @param {object} api  the stage's
 * @param {{ sea, sim }} ctx
 */
export function createCrew(api, ctx) {
  let station = null; // the station body's, while it's on the stack: { id, ship, spot, handlers, releaseCamera, yaw, pitch, eye, dir }
  let pending = null; // what a station's verb asked for, read by its body's enter (the place is the station's id)

  /** walk's avatar in this stage: this viewer's walker here, or null. */
  const walker = () => {
    for (const { value } of api.collect?.("avatar") ?? []) {
      const a = typeof value === "function" ? value() : null;
      if (a) return a;
    }
    return null;
  };
  /** walk's `stand` in this stage: its walker stood at stand spot `id`, { eye(), yaw }; null when not walking here. */
  const standAt = (id) => {
    for (const { value } of api.collect?.("stand") ?? []) {
      const at = typeof value === "function" ? value(id) : null;
      if (at) return at;
    }
    return null;
  };
  const top = () => api.view?.get?.()?.body ?? null;
  const walkingHere = () => top()?.id === "walk" && !!walker();

  // ─── the station body ───────────────────────────────────────────────────

  /** Put the eye where walk's walker, stood at the station's spot, has it now (she moves under it). */
  function placeEye(s) {
    const eye = s.spot.eye();
    const W = api.worldOf(s.ship);
    if (!eye || !W) return;
    s.eye = eye;
    s.dir = lookDir(s.yaw + headingOf(W), s.pitch);
    api.camera.set({ position: [...s.eye], target: s.eye.map((x, i) => x + s.dir[i]) });
  }

  const turn = (s, dx, dy) => {
    const l = look(s.yaw, s.pitch, dx, dy);
    s.yaw = l.yaw;
    s.pitch = l.pitch;
  };

  // looking and pressing at a station: the body's input, last in the chain for presses (scene/STAGE.md, "Keys")
  const looking = (s) => ({
    move(ev) {
      if (ev.locked) turn(s, ev.dx ?? 0, ev.dy ?? 0);
    },
    // without the lock a drag looks round, and a tap goes on as a click
    press(ev) {
      if (ev.button !== 0 || ev.locked) return null;
      let last = [ev.x ?? 0, ev.y ?? 0];
      return {
        move(e) {
          const at = [e.x ?? last[0], e.y ?? last[1]];
          turn(s, at[0] - last[0], at[1] - last[1]);
          last = at;
        },
        end() {},
        cancel() {},
        tap: () => false,
        cursor: "grabbing",
      };
    },
    wheel: () => true,
    cursor: (ev) => (ev.locked ? "none" : "grab"),
  });

  const stationBody = {
    id: "station",
    label: "At a station",
    lock: true,
    reach: REACH,
    // it needs a station (its verb enters it): the body chip doesn't offer it
    here: false,
    enter(id) {
      const p = pending?.id === id ? pending : null;
      pending = null;
      const ship = p ? shipOf(api.scene(), id) : null;
      const W = ship ? api.worldOf(ship) : null;
      const spot = W ? standAt(id) : null;
      const eye = spot?.eye();
      if (!eye) return null;
      const heading = headingOf(W);
      const s = { id, ship, spot, handlers: p.handlers, releaseCamera: null, yaw: spot.yaw - heading, pitch: PITCH, eye, dir: null };
      // a station that says what its worker watches (a winch: the jib's luff) turns the eye to it
      const aim = p.handlers.look?.();
      if (aim) Object.assign(s, aimOf(eye, aim, heading));
      s.releaseCamera = api.camera.hold();
      station = s;
      placeEye(s);
      return {
        label: stationLabel(id),
        keys: Object.freeze([...(p.handlers.keys ?? [])]),
        input: {
          ...looking(s),
          key: (ev) => !!s.handlers.key?.(ev),
          keyup: (ev) => !!s.handlers.keyup?.(ev),
        },
        eye: () => ({ position: [...s.eye], direction: s.dir ? [...s.dir] : null }),
        leave: () => depart(s),
      };
    },
  };

  /** What a station is called, for the body chip and who's here: its kind ("Helm", "Mainsheet"…). */
  function stationLabel(id) {
    const ship = shipOf(api.scene(), id);
    const kind = ship ? Object.entries(partsOf(api.scene(), ship)).find(([, v]) => v === id || (Array.isArray(v) && v.includes(id)))?.[0] : null;
    const names = { helm: "Helm", sail: "Mast", anchor: "Windlass", mainsheet: "Mainsheet", winches: "Winch" };
    return names[kind] ?? "At a station";
  }

  // the station body went off the stack: the eye left where walk's walker has it now, so walk resumes there
  function depart(s) {
    if (station !== s) return;
    placeEye(s);
    station = null;
    s.releaseCamera?.();
    try {
      s.handlers.left?.();
    } catch (err) {
      console.warn("[sailing] a station's left() failed", err);
    }
  }

  // ─── coming aboard, taking and leaving a station ───────────────────────

  /** Come aboard (`ship`, else her first): walk, at her hull, in her stage (waiting under a seat aboard her: stand up from it, into walk). */
  function start(ship = ctx.sim?.ships?.()[0] ?? null) {
    if (walkingHere() || station) return;
    if (walker()) {
      while (top()?.depth > 0 && !walkingHere()) if (!api.body.leave()) break;
      return;
    }
    if (ship) api.body.enter("walk", ship);
  }

  /** Off her deck: leave the station, then walk. */
  function stop() {
    leave();
    if (top()?.id === "walk" && walker()) api.body.leave();
  }

  /**
   * Stand at a station: the "station" body over walk in her stage (coming
   * aboard first, if you're walking anywhere else), which hears the keys the
   * station declares first (`keys`), at its stand spot (walk.stand: the
   * station carries its own), facing it; the mouse still turns your head.
   * @param {string} id
   * @param {{ keys: { code: string, label: string }[], key?(ev): boolean, keyup?(ev): boolean, tick?(dt), left?(), hint?(): string, look?(): number[] | null }} handlers
   *   keys: the keys the station takes, each with what it does (the shape every body,
   *   tool and gesture declares, scene/STAGE.md, "Bodies": declared, so a shown key works;
   *   labelled alike, the same thing, so a touch pad shows them as one control);
   *   look: a world point to turn the eye to on arriving (else its stand spot's facing)
   * @returns {() => void} leave
   */
  function take(id, handlers = {}) {
    if (!station && !walkingHere()) start(shipOf(api.scene(), id));
    if (!station && !walkingHere()) return () => {};
    leave();
    pending = { id, handlers };
    const ok = api.body.enter("station", id);
    pending = null;
    if (!ok) return () => {};
    const s = station;
    return () => station === s && leave();
  }

  /** Step away from the station you're at (its body comes off; walk stands you at its stand spot). */
  function leave() {
    const s = station;
    if (!s) return;
    if (top()?.id === "station") api.body.leave();
    if (station === s) depart(s); // (the body was already gone)
  }

  // Before coming aboard the camera is the orbit's, and it goes where the
  // ship goes (sideways only: no bobbing), so a sailing ship stays in view:
  // a base ride (the stage's camera.ride), which a body that holds the
  // camera (walk, a station) or rides it (a seat aboard her) wins over with
  // no flag. A camera nobody has moved (not even from a saved view) starts
  // off the ship's quarter. Only where her doc is the world (a boat alone:
  // ctx.sea.world(), COMPOSITION I4): linked into a harbour, the camera is
  // the harbour's to place, and two boats there would fight over it.
  let riding = null; // { ship, off }
  let framed = false; // the quarter view for a camera nobody moved: once, on first sight of her
  function follow() {
    const ship = ctx.sea?.world?.() ? (ctx.sim?.ships?.()[0] ?? null) : null;
    const m = ship ? bodyOf(api, ship) : null;
    if (riding && riding.ship !== (m ? ship : null)) {
      riding.off?.();
      riding = null;
    }
    if (!m || riding) return;
    if (!framed && !api.camera.touched?.()) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target) });
    framed = true;
    riding = { ship, off: api.camera.ride(ship, { turn: false, rise: false }) };
  }

  // walking off into Look (walk left): back off the quarter of the ship you were on
  let aboard = null; // the ship you were last on, while you walk here
  function offDeck() {
    const a = walker();
    if (a || station) {
      aboard = station ? station.ship : (a?.on ?? null);
      return;
    }
    if (aboard == null) return;
    const m = (top()?.depth ?? 0) === 0 ? bodyOf(api, aboard) : null;
    aboard = null;
    if (m) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target) });
  }

  // the tab hidden or closing: step away from a station, so what you set there is written down and it's free
  const doc = globalThis.document;
  if (doc) api.listen?.(doc, "visibilitychange", () => doc.visibilityState === "hidden" && leave());
  api.listen?.(globalThis, "pagehide", () => leave());

  const me = () =>
    viewerOf({
      body: top(),
      avatar: walker(),
      station: station?.id ?? null,
      ship: station?.ship ?? null,
      pointer: api.view.get()?.pointer ?? {},
      eye: station ? [...station.eye] : (api.body?.eye?.()?.position ?? api.camera.get()?.position ?? null),
      hint: station?.handlers.hint?.() ?? null,
    });

  return {
    input: {
      // a click that reaches her comes aboard (Enter does too: stations.js's
      // "aboard", and so does its button on the bar of tools). It reaches her only through
      // something of hers, her hull, a fitting or what's aboard her, nearer
      // takers (a card's carry, a game linked onto her table) first (scene
      // STAGE.md, "The input chain"). Seated at a table aboard (another extension's
      // body), a click on her is a stray one round the table, and doesn't
      // throw you out of the game: the bar's Come aboard or Enter does.
      click() {
        if (me().playing || walker() || seatedView(api)) return false;
        start();
        return true;
      },
    },
    start,
    stop,
    // the crew's body: standing at a station (walking is walk's)
    bodies: [stationBody],
    me,
    take,
    leave,
    /** One frame (play.js runs it after the ships have moved): the eye at a station, or the orbit following her. */
    tick(dt) {
      if (station) {
        placeEye(station);
        try {
          // the station's verbs (the wheel, a sheet, the furler, the halyard, the windlass) run in world time, as far as the ships step this frame
          station.handlers.tick?.(Math.min(Math.max(dt, 0), MAX_SUBSTEPS * SUBSTEP));
        } catch (err) {
          console.warn("[sailing] a station's tick failed", err);
        }
      } else if (!walker()) follow();
      offDeck();
    },
    update(s) {
      if (station && !s.objects?.[station.id]) leave();
    },
    dispose() {
      leave();
      riding?.off?.();
      riding = null;
    },
  };
}
