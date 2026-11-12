// scene.seats: the places people take at a scene, and who is in them. A
// shared part: it runs wherever the scene has seats (scene trait
// "scene.seats"), in every activity, and names nothing that uses it. A table
// reads who sits where to say whose hand is whose; a keeper reads who is
// playing; whatever walks hands the view over when someone sits down.
//
// What it is:
//   - the seat picker, over the view at the top right (pick your seat, or
//     watch; a seat with a `camera` moves your view there, and rides the
//     object the camera is `in`);
//   - a name tag on each of a seat's places ("Player 1 · Ana (away)"),
//     wherever something contributes places (`seatPlaces`);
//   - a seat as a station on the use prompt, for whoever walks up to it in
//     first person (Sit as …, Stand up: seats-model.js);
//   - telling the others when someone sits down (api.send: the seat id only).
//
// Who sits where is the doc's (`player`), and lasts. Whether that player is
// here now is a claim on the scene, `scene.seat:<id>` (STAGE.md, "Claims"):
// it lapses when they go, so a seat whose player has gone can be taken
// (after asking), and one whose player is here can't. Claims decide who may
// take a seat, never who sees what.
//
// What it contributes for others to collect (api.collect; STAGE.md,
// "Seats"):
//
//   roster: {
//     seats(scene)   → [{ id, name, viewer | null }]  every seat, in seat order
//     viewers(scene) → viewer[]                       who is seated, in seat order
//     open(scene)    → string[]                       the names of the seats nobody has taken
//     nameOf(scene, viewer) → string | null           the name of the seat they sit in
//     who(viewer)    → string                         what to call them: their contact's name once
//                                                     known, else their seat's, else "Someone"
//   }
//
// The first four are pure in the snapshot they're given (the doc alone:
// never presence or claims), so an `audience` policy may be built on them.
//
// And the module's `lay(d, seats)` writes seats into a scene doc being set
// up (seats-model.js); setup code finds it by this plugin's `roster: true`.

import css from "./seats.css?inline";
import { applyMatrix, invertMatrix } from "../transform.js";
import { CONFIRM_MS, SEATS, SEAT_CLAIM, cleanPlaces, lay, rosterOf, seatLookedAt, seatOf, seatState, seatTagAt, seatVerb, seatsOf } from "./seats-model.js";

/** A little longer than the stage's grace for a claim by a session not yet heard from (6 s). */
const LAPSE_MS = 6500;
/** A claim lost this soon after taking it lost a race to sit down; later, the seat was taken while this view went unheard. */
const RACE_MS = 10_000;

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

function create(api) {
  const { repo, viewer } = api;
  let scene = null;
  let dead = false;

  // ── who a viewer is, for people ──
  const names = new Map(); // viewer → their contact's name; null while asking, or if it has none
  /** A viewer's contact name, if known yet (asked once; the seats redraw when it comes). */
  function contactName(who) {
    if (typeof who !== "string" || !who) return null;
    if (names.has(who)) return names.get(who);
    names.set(who, null);
    if (who.startsWith("automerge:")) {
      Promise.resolve(repo?.find?.(who))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (dead || typeof n !== "string" || !n.trim()) return;
          names.set(who, n.trim());
          drawSeats();
        })
        .catch(() => {});
    }
    return null;
  }
  const someone = (who) => contactName(who) || "Someone";
  /** What to call a viewer: their contact's name, else the name of the seat they sit in, else "Someone". */
  const who = (v) => {
    const s = v ? Object.values(seatsOf(scene ?? api.scene())).find((x) => x?.player === v) : null;
    return contactName(v) || s?.name || "Someone";
  };

  // ── the seat this view claims ──
  let held = null; // { sid, release, at }
  const heard = new Set(); // sessions whose claims have had their lapse timer
  const timers = new Set();
  function later(fn, ms) {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!dead) fn();
    }, ms);
    timers.add(t);
  }
  /** Seat `sid`'s live claim, if any: { viewer, session, mine }. */
  function claimOf(sid) {
    const by = api.claimedBy(null, SEAT_CLAIM(sid)) ?? null;
    // a session this view hasn't heard from counts for the stage's grace
    // period and then lapses, and no presence event says so: look again then
    if (by && !by.mine && !Object.hasOwn(api.presence.get() ?? {}, by.session) && !heard.has(by.session)) {
      heard.add(by.session);
      later(redraw, LAPSE_MS);
    }
    return by;
  }
  const stateOf = (sid, seats = seatsOf(api.scene())) => {
    const by = claimOf(sid);
    return { by, seat: seats[sid], state: seatState(seats[sid], by, viewer) };
  };

  // ── the picker ──
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("seats-overlay");
  const picker = el("select", { class: "seats-pick", "aria-label": "Seat", title: "Where you sit: what's kept for your seat is shown to you alone" });
  let picked = ""; // what the picker shows as this viewer's seat
  picker.addEventListener("change", () => {
    const want = picker.value || null;
    if (want) {
      const { by, seat, state } = stateOf(want);
      // someone is sitting there now: it's theirs while they're here
      if (state === "taken") {
        api.notify(`${someone(by.viewer)} is sitting there.`);
        picker.value = picked;
        return;
      }
      // they've gone: their seat can be taken, but it's their things you'll see
      if (state === "away" && typeof globalThis.confirm === "function") {
        const name = contactName(seat.player);
        if (!globalThis.confirm(`${name ?? "Whoever sat there"} is away. Take their seat? You'll see what's theirs.`)) {
          picker.value = picked;
          return;
        }
      }
    }
    sit(want);
  });
  const bar = el("label", { class: "seats-bar" }, el("span", {}, "Seat"), picker);
  bar.hidden = true;
  overlay.append(bar);

  // ── name tags: one on each of a seat's places ──
  const tags = api.labels();
  let seatKey = "";
  let tagKey = "";
  let tagged = []; // { z, text, state, cam }: what drawSeats last said
  let tagLoop = null;
  /** The places other extensions give seats (`seatPlaces`), for this snapshot. */
  function placesOf(snap) {
    const out = [];
    for (const { value } of api.collect("seatPlaces")) {
      if (typeof value !== "function") continue;
      try {
        out.push(...(value(snap) ?? []));
      } catch (err) {
        console.warn("[scene.seats] a seatPlaces contribution failed", err);
      }
    }
    return cleanPlaces(out, snap?.objects);
  }

  function drawSeats() {
    if (!scene || dead) return;
    const seats = seatsOf(scene);
    const ids = Object.keys(seats);
    bar.hidden = !ids.length;
    const st = new Map(ids.map((id) => [id, stateOf(id, seats)]));
    // ask after everyone here by name now, so a notice about them can say who
    for (const r of Object.values(api.presence.get() ?? {})) contactName(r?.viewer);
    picked = ids.find((id) => st.get(id).state === "mine" || st.get(id).state === "mine-elsewhere") ?? "";
    const note = { taken: " (taken)", away: " (away)" };
    const options = [["", "Watching"], ...ids.map((id) => [id, `${seats[id]?.name || id}${note[st.get(id).state] ?? ""}`])];
    const k = JSON.stringify(options);
    if (k !== seatKey) {
      seatKey = k;
      picker.replaceChildren(...options.map(([v, t]) => el("option", { value: v }, t)));
    }
    if (globalThis.document?.activeElement !== picker) picker.value = picked;
    tagged = [];
    for (const z of placesOf(scene)) {
      const s = st.get(z.seat);
      if (s) tagged.push({ z, text: `${s.seat?.name || z.seat} · ${occupant(s)}`, state: s.state, cam: s.seat?.camera ?? null });
    }
    placeTags();
  }
  // Each tag on its place as drawn (a table aboard a ship is where the ship
  // is this frame, not where the doc last saved her), every frame while a
  // place is attached to something (which may be moving): on the place's
  // floor at its edge nearest the seat (seatTagAt).
  function placeTags() {
    if (dead) return;
    const items = [];
    for (const { z, text, state, cam } of tagged) {
      const m = api.worldOf(z.id) ?? scene.world(z.id);
      const inv = m ? invertMatrix(m) : null;
      if (!inv) continue;
      const frame = cam?.in ? (api.worldOf(cam.in) ?? (scene.objects?.[cam.in] ? scene.world(cam.in) : null)) : null;
      const eye = cam?.position && (!cam.in || frame) ? (frame ? applyMatrix(frame, cam.position) : cam.position) : null;
      const position = applyMatrix(m, seatTagAt(z, eye ? applyMatrix(inv, eye) : null)).map((v) => +v.toFixed(4));
      items.push({ key: z.id, text, position, className: "seat-tag", data: { state }, rank: 1 });
    }
    const tk = JSON.stringify(items);
    if (tk !== tagKey) {
      tagKey = tk;
      tags.set(items);
    }
  }
  /** Follow the places each frame while any is attached to something, in play; else stop. */
  function followTags(snapshot, local) {
    const moving = local?.activities?.current === "play" && tagged.some(({ z }) => (snapshot.parents?.get?.(z.id) ?? null) != null);
    if (moving && !tagLoop) tagLoop = api.loop(placeTags);
    else if (!moving && tagLoop) {
      tagLoop();
      tagLoop = null;
    }
  }
  /** Who a name tag says sits in a seat. */
  function occupant({ by, seat, state }) {
    switch (state) {
      case "mine":
      case "mine-elsewhere":
        return contactName(viewer) ?? "you";
      case "taken":
        return contactName(by?.viewer) ?? "someone";
      case "away":
        return `${contactName(seat?.player) ?? "someone"} (away)`;
    }
    return "free";
  }
  const redraw = () => {
    drawSeats();
    reconcile();
  };
  // who is here changes without a doc change: a seat's (taken) / (away), a claim to take back
  api.presence.watch(redraw);
  later(redraw, LAPSE_MS);

  /**
   * Put the doc and this view's claim back in step, out of the change that
   * prompted it (a microtask), writing only what differs:
   * - this view holds a seat's claim but the doc no longer seats this
   *   viewer there:
   *   - the doc seats this viewer in another seat, or in none while
   *     another view of this viewer is here: this person stood up or moved
   *     from their other tab, so this one lets go of the claim and writes
   *     nothing (writing back would fight that tab for ever);
   *   - otherwise two sittings merged split, the claim to this one and the
   *     player to the other, so the claim's holder writes itself back in
   *     (that one seat's player, nothing else);
   * - the doc seats this viewer, nobody's claim is live and this view holds
   *   none (a reload, back from the back-forward cache, a second tab after
   *   the first closed): claim it.
   */
  let reconciling = false;
  function reconcile() {
    if (reconciling || dead) return;
    reconciling = true;
    queueMicrotask(() => {
      reconciling = false;
      if (dead) return;
      const seats = seatsOf(api.scene());
      if (held) {
        const sid = held.sid;
        if (!seats[sid]) {
          // the seat itself has gone (an edit)
          held.release();
          held = null;
        } else if (api.claimedBy(null, SEAT_CLAIM(sid))?.mine && seats[sid].player !== viewer) {
          const elsewhere = seatOf(seats, viewer);
          const otherTab = Object.values(api.presence.get() ?? {}).some((r) => r?.viewer === viewer);
          if (elsewhere || (!seats[sid].player && otherTab)) {
            held.release();
            held = null;
            drawSeats();
          } else {
            api.change((d) => {
              const s = d.traits?.[SEATS]?.[sid];
              if (s && s.player !== viewer) s.player = viewer;
            });
          }
        }
        return;
      }
      const mine = seatOf(seats, viewer);
      if (!mine || claimOf(mine)) return;
      const release = api.claim(null, SEAT_CLAIM(mine), { onLost: () => lost(mine) });
      if (release) held = { sid: mine, release, at: Date.now() };
    });
  }
  /** In a draft: this viewer in seat `sid` (or none) and in no other. */
  function seatIn(d, sid) {
    const seats = d.traits?.[SEATS];
    if (!seats) return;
    for (const [id, s] of Object.entries(seats)) if (s?.player === viewer && id !== sid) s.player = null;
    if (sid && seats[sid] && seats[sid].player !== viewer) seats[sid].player = viewer;
  }
  /**
   * Someone else's claim on a seat this view held won the merge (two
   * sitting at once), or this view went unheard long enough for its seat
   * to be taken: say so, and write nothing.
   */
  function lost(sid) {
    const since = held?.sid === sid ? held.at : null;
    if (held?.sid === sid) held = null;
    const by = api.claimedBy(null, SEAT_CLAIM(sid));
    // the same person in another tab: still seated
    if (!(by && by.viewer === viewer)) {
      const seat = seatsOf(api.scene())[sid];
      // (a holder this view can't hear from reads as nobody: the doc's player says who)
      const name = someone(by?.viewer ?? (seat?.player !== viewer ? seat?.player : null));
      const race = since == null || Date.now() - since < RACE_MS;
      api.notify(race ? `${name} sat in ${seat?.name || sid} first; you're watching` : `${name} took ${seat?.name || sid} while you were away; you're watching`);
      // sat down from first person and lost the race for it: back on your feet there
      if (race && since != null && walkedUp?.sid === sid && walkedUp.at === since) {
        walkedUp = null;
        standAt(sid);
      }
    }
    drawSeats();
  }

  /** Sit in a seat (null: watch): claim it, let go of the last one, then write it down. */
  function sit(seatId) {
    // (sat from first person: seatVerbRun says so again once this has sat)
    walkedUp = null;
    const before = seatsOf(api.scene());
    if (seatId && !before[seatId]) return drawSeats();
    if (seatId && stateOf(seatId, before).state !== "mine-elsewhere") {
      // (your own other tab has it: you're both seated, and it keeps the claim)
      const release = api.claim(null, SEAT_CLAIM(seatId), { onLost: () => lost(seatId) });
      if (release === null) {
        api.notify(`${someone(api.claimedBy(null, SEAT_CLAIM(seatId))?.viewer)} is sitting there.`);
        return drawSeats();
      }
      if (held && held.sid !== seatId) held.release();
      held = release ? { sid: seatId, release, at: Date.now() } : null;
    } else if (held && held.sid !== seatId) {
      held.release();
      held = null;
    }
    const was = seatOf(before, viewer);
    if (was !== seatId || (seatId && before[seatId]?.player !== viewer)) api.change((d) => seatIn(d, seatId));
    if (seatId && was !== seatId && seatsOf(api.scene())[seatId]?.player === viewer) {
      const text = told("sat", { seat: seatId }, "You");
      if (text) api.notify(text);
      api.send("sat", { seat: seatId });
    }
    // each seat can say where its player looks from
    const cam = seatId ? seatsOf(api.scene())[seatId]?.camera : null;
    if (cam) seatView(cam);
    else stopRiding();
    drawSeats();
  }

  /** What a message says, from `name`; null if it's malformed or not one of ours. Seat ids only. */
  function told(type, data, name) {
    if (type !== "sat" || !data || typeof data !== "object" || typeof data.seat !== "string" || !data.seat || data.seat.length >= 128) return null;
    const seat = seatsOf(scene ?? api.scene())[data.seat];
    if (!seat) return null;
    const sn = seat.name || data.seat;
    return `${name === sn ? "Someone" : name} sat down as ${sn}`;
  }

  // ── the seat's view ──
  // A seat's camera may be in an object's frame (`in`: a table aboard a
  // ship): the view is put there as that object is drawn now, and then
  // rides with it (api.camera.ride, at the spot the view looks at), so the
  // table stays in front of you as she swings and bobs. In first person
  // (local.immersive: walking her deck) the camera is the walker's: the
  // view waits until that ends, and whoever is seated is put back in their
  // seat when it does.
  let riding = null; // the ride's off
  let waiting = false;
  function stopRiding() {
    riding?.();
    riding = null;
    waiting = false;
  }
  function seatView(cam) {
    stopRiding();
    if (api.local.get()?.immersive) {
      waiting = true;
      return;
    }
    const { in: frame, ...view } = cam;
    const m = frame ? (api.worldOf(frame) ?? (api.scene().objects?.[frame] ? api.scene().world(frame) : null)) : null;
    // in a frame that's gone (its table deleted): no view to put you in; the view stays as it is
    if (frame && !m) return;
    if (m) {
      view.position = applyMatrix(m, cam.position);
      view.target = applyMatrix(m, cam.target ?? [0, 0, 0]);
    }
    api.camera.set(view);
    // riding the spot it looks at, which so holds still on screen however she rolls
    if (m) riding = api.camera.ride(frame, { at: [...(cam.target ?? [0, 0, 0])] }) ?? null;
  }
  /** Back from first person: in your seat again, if you have one. */
  function backInSeat(local, prev) {
    if (!(prev?.immersive && !local?.immersive) && !(waiting && !local?.immersive)) return;
    waiting = false;
    const mine = seatOf(seatsOf(api.scene()), viewer);
    const cam = mine ? seatsOf(api.scene())[mine]?.camera : null;
    if (cam) seatView(cam);
  }

  // ── a seat as a station: walk up to it and sit ──
  // In first person, a look at a seat's place within reach offers "Sit as
  // <name>" (F), which sits you exactly as the picker does (the same claim,
  // notices and refusals; an away seat asks first, by a second F rather
  // than a dialog, since the pointer is locked) and then hands the view
  // over: whatever you walk with (a running extension's `firstPerson`) is
  // asked to leave first person, and the seat's view takes over as it ends
  // (backInSeat). Sitting there, a look at your own place offers "Stand up"
  // when there's something to walk with: it's asked to put you on your feet
  // at the seat (firstPerson.enter), the seat staying yours; Esc, or F at
  // it, sits you back down.
  //
  // `firstPerson`, on the instance of whatever walks (api.collect):
  //   enter({ seat, eye, target, frame }) → boolean: first person, standing
  //     at the seat (eye: where the seated eye is, world, as drawn; target:
  //     the point its view looks at; frame: the object the seat's camera is
  //     in, or null); false if it can't
  //   leave(): end first person (the seat's view then takes the camera)
  let aimed = null; // { target, sid, verb }: what the seat verb's state last said, for its run
  let walkedUp = null; // { sid, at }: the seat this view sat in from first person, and its claim's time (held.at); cleared by any other sit
  let confirming = null; // { sid, until }: an away seat's first F
  const drawnIn = (snap) => (id) => api.worldOf(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
  const walkers = () =>
    api
      .collect("firstPerson")
      .map((r) => r?.value)
      .filter((v) => v && typeof v === "object" && typeof v.enter === "function" && typeof v.leave === "function");

  function seatVerbState(target, ctx) {
    aimed = null;
    const snap = ctx?.scene ?? scene;
    const local = ctx?.local ?? api.local.get();
    // the prompt's alone: it says where the eye is
    if (!snap || !Array.isArray(ctx?.from) || local?.activities?.current !== "play") return null;
    const seats = seatsOf(snap);
    const sid = seatLookedAt({ snap, target, point: ctx.hit?.point ?? null, from: ctx.from, seats, places: placesOf(snap), drawn: drawnIn(snap) });
    if (!sid) return null;
    const st = stateOf(sid, seats);
    const name = st.state === "taken" ? contactName(st.by?.viewer) : st.state === "away" ? contactName(st.seat?.player) : null;
    const v = seatVerb({
      name: seats[sid]?.name || sid,
      state: st.state,
      who: name,
      immersive: !!local?.immersive,
      canStand: Array.isArray(seats[sid]?.camera?.position) && walkers().length > 0,
      confirming: confirming?.sid === sid && Date.now() < confirming.until,
    });
    if (!v) return null;
    aimed = { target, sid, verb: v.verb };
    const { verb, ...shown } = v;
    return shown;
  }

  function seatVerbRun(target) {
    // (the prompt asks state just before it runs a verb)
    const a = aimed?.target === target ? aimed : null;
    if (!a) return;
    if (a.verb === "stand") return standUp(a.sid);
    const { by, seat, state } = stateOf(a.sid);
    if (state === "taken") return api.notify(`${someone(by?.viewer)} is sitting there.`);
    if (state === "away" && !(confirming?.sid === a.sid && Date.now() < confirming.until)) {
      confirming = { sid: a.sid, until: Date.now() + CONFIRM_MS };
      return api.notify(`${contactName(seat?.player) ?? "Whoever sat there"} is away. Press F again to take their seat; you'll see what's theirs.`);
    }
    confirming = null;
    sit(a.sid);
    if (seatOf(seatsOf(api.scene()), viewer) !== a.sid) return; // refused, or lost the race: told already
    // (this sitting's claim, so a later one from the picker is never taken for it)
    walkedUp = { sid: a.sid, at: held?.sid === a.sid ? held.at : null };
    handOff();
  }

  /** Out of first person, so the seat's view (waiting for it: seatView) takes over. */
  function handOff() {
    if (!api.local.get()?.immersive) return;
    const ws = walkers();
    if (!ws.length) return api.notify("Leave first person (Esc) to take your seat.");
    for (const w of ws) {
      try {
        w.leave();
      } catch (err) {
        console.warn("[scene.seats] firstPerson.leave failed", err);
      }
    }
  }

  /** Up from your seat into first person, standing there; the seat stays yours. */
  function standUp(sid) {
    if (standAt(sid)) api.notify(`You got up from ${seatsOf(api.scene())[sid]?.name || sid}; it's still yours.`);
  }
  /** First person, standing at seat `sid` (firstPerson.enter); false (the seat's view kept) if nothing walks or it can't. */
  function standAt(sid) {
    const snap = api.scene();
    const cam = seatsOf(snap)[sid]?.camera;
    const w = walkers()[0];
    if (!w || !Array.isArray(cam?.position)) return false;
    const m = cam.in ? drawnIn(snap)(cam.in) : null;
    if (cam.in && !m) return false;
    const at = (p) => (m ? applyMatrix(m, p) : [...p]).map(Number);
    const spot = { seat: sid, eye: at(cam.position), target: at(cam.target ?? [0, 0, 0]), frame: cam.in ?? null };
    const was = riding;
    stopRiding();
    let ok = false;
    try {
      ok = w.enter(spot) !== false;
    } catch (err) {
      console.warn("[scene.seats] firstPerson.enter failed", err);
    }
    if (!ok && was) seatView(cam);
    return ok;
  }

  return {
    update(snapshot, local, prev) {
      backInSeat(local, prev?.local);
      // (what's running changed: someone who gives seats places may have come or gone)
      if (snapshot === prev?.scene && local?.running === prev?.local?.running) return followTags(snapshot, local);
      scene = snapshot;
      drawSeats();
      followTags(snapshot, local);
      reconcile();
    },
    receive(type, data, from) {
      const text = told(type, data, who(from?.viewer));
      if (text) api.notify(text);
    },
    roster: Object.freeze({
      seats: (snap) => rosterOf(snap),
      viewers: (snap) => rosterOf(snap).map((s) => s.viewer).filter(Boolean),
      open: (snap) => rosterOf(snap).filter((s) => !s.viewer).map((s) => s.name),
      nameOf: (snap, v) => (v ? (rosterOf(snap).find((s) => s.viewer === v)?.name ?? null) : null),
      who,
    }),
    commands: [
      {
        // a seat as a station: "Sit as Player 1" in first person, "Stand up"
        // from your seat; the use prompt's alone (it needs the eye), so F
        // elsewhere stays whatever else F is
        id: "seat",
        name: "Sit down",
        key: "f",
        show: ["use"],
        state: seatVerbState,
        run: seatVerbRun,
      },
    ],
    dispose() {
      dead = true;
      tagLoop?.();
      tagLoop = null;
      stopRiding();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

export default { create, lay };
