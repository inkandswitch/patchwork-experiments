// seats: the places people take at a scene, and who is in them. It runs
// wherever the scene has seats (scene trait "seats"), and
// names nothing that uses it. A table reads who sits where to say whose hand
// is whose; a keeper reads who is playing. Sitting down pushes the seat
// body over whatever body you were in; standing up pops it.
//
// What it is:
//   - the seat picker, over the view at the top right (pick your seat, or
//     watch; a seat with a `camera` puts you in the seat body, body.js,
//     contributed as `bodies`: your view there, riding the doc's root, or
//     the object its camera is `in`, rolling with it). It
//     follows attention: shown while you sit at this doc's table, or (sitting
//     nowhere) while you look at it, so a room of linked games shows the
//     picker of the one you're at;
//   - a name tag on each of a seat's places ("Player 1 · Ana (away)"),
//     wherever something contributes places (`seatPlaces`);
//   - a seat as a station on the use prompt, for whoever walks up to it
//     (Sit as …, Stand up: model.js);
//   - telling the others when someone sits down (api.send: the seat id only);
//   - who the parties are, for undo (`parties`): the people seated.
//
// Who sits where is the doc's (`player`), and lasts. Whether that player is
// here now is a claim on the scene, `seat:<id>` (scene/STAGE.md, "Claims"):
// it lapses when they go, so a seat whose player has gone can be taken
// (after asking), and one whose player is here can't. Claims decide who may
// take a seat, never who sees what.
//
// What it contributes for others to collect (api.collect; README.md):
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
// All but `who` are pure in the snapshot they're given (the doc alone:
// never presence or claims), so an `audience` policy may be built on them.
//
// And the module's `lay(d, seats)` writes seats into a scene doc being set
// up (model.js); setup code finds it by this plugin's `roster: true`.

import css from "./seats.css?inline";
import { applyMatrix, invertMatrix } from "./transform.js";
import { seatBody } from "./body.js";
import { CONFIRM_MS, SEATS, SEAT_CLAIM, arrivalSeat, cleanPlaces, lay, rosterOf, seatLookedAt, seatOf, seatState, seatTagAt, seatVerb, seatsOf } from "./model.js";

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
  const timers = new Set(); // cancels (the stage's time: api.clock.after)
  function later(fn, ms) {
    const t = api.clock.after(ms, () => {
      timers.delete(t);
      if (!dead) fn();
    });
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
  /**
   * Is this doc's table where the viewer's attention is? Sitting at it (this
   * extension's seat body is the current one); else, sitting nowhere, looking
   * at it or having something of it selected. The picker is shown only then:
   * chrome follows attention, so of several tables (each its own doc) only the
   * one you're at shows its seats.
   */
  const attending = () => {
    const v = api.view.get();
    if (v.body?.id === body.id) return v.body.ext === api.id;
    return api.look() != null || v.selected != null;
  };
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
        console.warn("[seats] a seatPlaces contribution failed", err);
      }
    }
    return cleanPlaces(out, snap?.objects);
  }

  function drawSeats() {
    if (!scene || dead) return;
    const seats = seatsOf(scene);
    const ids = Object.keys(seats);
    bar.hidden = !ids.length || !attending();
    const st = new Map(ids.map((id) => [id, stateOf(id, seats)]));
    // ask after everyone here by name now, so a notice about them can say who
    for (const r of Object.values(api.presence.get() ?? {})) contactName(r?.viewer);
    picked = ids.find((id) => st.get(id).state === "mine" || st.get(id).state === "mine-elsewhere") ?? "";
    const note = { taken: " (taken)", away: " (away)" };
    const label = (id) => `${seats[id]?.name || id}${note[st.get(id).state] ?? ""}`;
    const k = JSON.stringify(ids.map(label));
    if (k !== seatKey) {
      seatKey = k;
      picker.replaceChildren(el("option", { value: "" }, "Watching"), ...ids.map((id) => el("option", { value: id }, label(id))));
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
  /** Follow the places each frame while any is attached to something (a table aboard a ship); else stop. */
  function followTags(snapshot) {
    const moving = tagged.some(({ z }) => (snapshot.parents?.get?.(z.id) ?? null) != null);
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
      if (release) held = { sid: mine, release, at: api.clock.now() };
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
      const race = since == null || api.clock.now() - since < RACE_MS;
      api.notify(race ? `${name} sat in ${seat?.name || sid} first; you're watching` : `${name} took ${seat?.name || sid} while you were away; you're watching`);
      // sat down from walking and lost the race for it: back on your feet there
      if (race && since != null && walkedUp?.sid === sid && walkedUp.at === since) {
        walkedUp = null;
        getUp();
      }
    }
    drawSeats();
  }

  /** Sit in a seat (null: watch): claim it, let go of the last one, then write it down. */
  function sit(seatId) {
    // (sat from walking: seatVerbRun says so again once this has sat)
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
      held = release ? { sid: seatId, release, at: api.clock.now() } : null;
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
    if (seatId) seatView(seatId);
    else getUp();
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

  // ── the seat's view: the seat body (body.js) ──
  // Sitting enters it (the stage pushes it over the body you're in: walking
  // her deck, or Look: from Edit the stage turns to Look first); standing up, watching or moving pops it, and
  // whatever is under it carries on (walking resumes from the eye).
  let sitting = null; // the seat this view sits in, as a body: its seat id
  const seatDef = seatBody(api, {
    left: (sid) => {
      if (sitting === sid) sitting = null;
    },
  });
  // Arriving (the stage enters view.start's body: { body: "seat" }, no
  // place): back in your own seat if the doc seats you (its claim is
  // reconcile's), else watching from the first seat's view, labelled so,
  // writing nothing; the picker or a seat's verb sits you down over it, and
  // standing up comes back to it. A seat named (the picker, the verb) is
  // the seat body as ever.
  const body = {
    ...seatDef,
    enter(place) {
      if (place != null) return seatDef.enter(place);
      const at = arrivalSeat(seatsOf(api.scene()), viewer);
      const s = at ? seatDef.enter(at.sid) : null;
      if (!s) return null;
      if (at.mine) {
        sitting = at.sid;
        return s;
      }
      return { ...s, seat: null, label: "Watching", leave() {} };
    },
  };
  const seated = () => api.view.get()?.body?.id === body.id;
  /** Down to the seat body, if it's in the stack under another (walking her deck from it). */
  function downToSeat() {
    for (let n = 0; sitting != null && !seated() && n < 8; n++) if (!api.body.leave()) break;
  }
  function getUp() {
    downToSeat();
    const was = sitting;
    sitting = null;
    if (was != null && seated()) api.body.leave();
  }
  /** Into seat `sid`'s view (the seat body); back down to it if it's under something already. */
  function seatView(sid) {
    if (sitting === sid) {
      downToSeat();
      if (seated()) return;
    }
    getUp();
    // (a seat with no camera, or one in a frame that's gone: the view stays as it is)
    if (api.body.enter(body.id, sid)) sitting = sid;
  }

  // ── a seat as a station: walk up to it and sit ──
  // Walking, a look at a seat's place within reach offers "Sit as <name>"
  // (F), which sits you exactly as the picker does (the same claim, notices
  // and refusals; an away seat asks first, by a second F rather than a
  // dialog, since the pointer is locked): the seat body goes on over the
  // walk. Sitting there, a look at your own place offers "Stand up": the
  // seat body comes off, and you walk on from the eye, the seat staying
  // yours.
  let walkedUp = null; // { sid, at }: the seat this view sat in from walking, and its claim's time (held.at); cleared by any other sit
  let confirming = null; // { sid, until }: an away seat's first F
  const drawnIn = (snap) => (id) => api.worldOf(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
  /** Walking: in a body over the stage's Look or Edit (depth 0) that isn't the seat. */
  const walking = () => {
    const b = api.view.get()?.body;
    return (b?.depth ?? 0) > 0 && b.id !== body.id;
  };

  /** The seat a look at `target` (in the command context) is on, and what its verb says: { sid, verb, shown } | null. */
  function aim(target, ctx) {
    const snap = ctx?.scene ?? scene;
    if (!snap) return null;
    const seats = seatsOf(snap);
    const sid = seatLookedAt({ snap, target, point: ctx?.hit?.point ?? null, seats, places: placesOf(snap), drawn: drawnIn(snap) });
    if (!sid) return null;
    const st = stateOf(sid, seats);
    const name = st.state === "taken" ? contactName(st.by?.viewer) : st.state === "away" ? contactName(st.seat?.player) : null;
    const v = seatVerb({
      name: seats[sid]?.name || sid,
      state: st.state,
      who: name,
      walking: walking(),
      seated: seated() && sitting === sid,
      confirming: confirming?.sid === sid && api.clock.now() < confirming.until,
    });
    if (!v) return null;
    const { verb, ...shown } = v;
    return { sid, verb, shown };
  }

  const seatVerbState = (target, ctx) => aim(target, ctx)?.shown ?? null;

  // run gets the context state was asked in (the same look), so it aims again
  function seatVerbRun(target, _value, ctx) {
    const a = aim(target, ctx);
    if (!a) return;
    if (a.verb === "stand") return standUp(a.sid);
    const { by, seat, state } = stateOf(a.sid);
    if (state === "taken") return api.notify(`${someone(by?.viewer)} is sitting there.`);
    if (state === "away" && !(confirming?.sid === a.sid && api.clock.now() < confirming.until)) {
      confirming = { sid: a.sid, until: api.clock.now() + CONFIRM_MS };
      return api.notify(`${contactName(seat?.player) ?? "Whoever sat there"} is away. Press F again to take their seat; you'll see what's theirs.`);
    }
    confirming = null;
    sit(a.sid);
    if (seatOf(seatsOf(api.scene()), viewer) !== a.sid) return; // refused, or lost the race: told already
    // (this sitting's claim, so a later one from the picker is never taken for it)
    walkedUp = { sid: a.sid, at: held?.sid === a.sid ? held.at : null };
  }

  /** Up from your seat: the seat body comes off; the seat stays yours. */
  function standUp(sid) {
    if (!seated()) return;
    getUp();
    api.notify(`You got up from ${seatsOf(api.scene())[sid]?.name || sid}; it's still yours.`);
  }

  return {
    update(snapshot, local, prev) {
      // attention moved (the picker follows it): shown or hidden, nothing else
      bar.hidden = !Object.keys(seatsOf(snapshot)).length || !attending();
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
    // who has a stake in a thing at this table (scene/TOOLS.md, Decisions 2):
    // the people seated at it, here or away; not those watching. Asked when
    // someone takes back an edit that showed or decided something here.
    parties: (snap) => {
      const seated = rosterOf(snap).map((s) => s.viewer).filter(Boolean);
      return () => seated;
    },
    // the seat body (body.js): entered by the picker and the seat's verb
    bodies: [body],
    commands: [
      {
        // a seat as a station: "Sit as Player 1" walking, "Stand up" from
        // your seat; within the body's reach (the stage measures it)
        id: "seat",
        name: "Sit down",
        key: "f",
        show: ["use"],
        reach: true,
        state: seatVerbState,
        run: seatVerbRun,
      },
    ],
    dispose() {
      dead = true;
      tagLoop?.();
      tagLoop = null;
      getUp();
      for (const cancel of timers) cancel();
      timers.clear();
    },
  };
}

export default { create, lay };
