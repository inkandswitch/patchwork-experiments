// seats: the places people take at a scene, and who is in them. It runs
// wherever the scene or an object has seats (trait "seats"), and
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
//   - telling everyone when someone sits down (api.tell: the seat id only).
//
// Seats have an owner (model.js): the doc's own are its table's, an object's
// are that object's (a machine's ports), copied and removed with it. The
// picker shows one owner's: the seats of what has your attention.
//
// Who sits in a lasting seat is the doc's (`player`), and lasts. Whether that
// player is here now is a claim on the seats' owner, `seat:<id>`
// (scene/STAGE.md, "Claims"): it lapses when they go, so a seat whose player
// has gone can be taken (after asking), and one whose player is here can't.
// A seat that doesn't last (`lasting: false`) is the claim alone: nothing is
// written, and getting up, sitting elsewhere or going frees it. Claims
// decide who may take a seat, never who sees what.
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
//     sitting()      → { of, seat } | null            the seat this view is sitting in now, anywhere
//                                                     (the seat body on top: standing up, walking off
//                                                     from it or watching is not sitting)
//     stateOf(ref)   → "free" | "mine" | "mine-elsewhere" | "taken" | "away" | null
//                                                     seat `ref` ({ of, seat }) as this view sees it now
//                                                     (its claim and the doc); null: no such seat
//     sit(ref)       → boolean                        sits this view in seat `ref` as the picker does
//                                                     (claim, notice, seat body); a taken or away seat,
//                                                     or none, is refused silently; whether it sits there now
//   }
//
// `seats`, `viewers`, `open` and `nameOf` are the doc's own seats: its
// table's. All but `who`, `sitting`, `stateOf` and `sit` are pure in the snapshot they're given
// (the doc alone: never presence or claims), so an `audience` policy may be
// built on them.
//
// And the module's `lay(d, seats, of?)` writes seats into a scene doc being
// set up, the doc's own or an object's (model.js); setup code finds it by
// this plugin's `roster: true`.

import css from "./seats.css?inline";
import { applyMatrix, invertMatrix } from "./transform.js";
import { seatBody } from "./body.js";
import { CONFIRM_MS, SEATS, SEAT_CLAIM, allSeats, arrivalSeat, cleanPlaces, lasting, lay, mySeat, refOf, rosterOf, sameSeat, seatAt, seatLookedAt, seatState, seatTagAt, seatVerb, seatsOf } from "./model.js";

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
    const at = mySeat(scene ?? api.scene(), v);
    return contactName(v) || seatAt(scene ?? api.scene(), at)?.name || "Someone";
  };

  // ── the seats this view claims ──
  let held = null; // the lasting seat whose player this viewer is: { ref, release, at }
  let perch = null; // the seat that doesn't last this view sits in: { ref, release, at }
  const heard = new Set(); // sessions whose claims have had their lapse timer
  const timers = new Set(); // cancels (the stage's time: api.clock.after)
  function later(fn, ms) {
    const t = api.clock.after(ms, () => {
      timers.delete(t);
      if (!dead) fn();
    });
    timers.add(t);
  }
  /** A seat's live claim, if any: { viewer, session, mine }. */
  function claimOf(ref) {
    const by = api.claimedBy(ref.of, SEAT_CLAIM(ref.seat)) ?? null;
    // a session this view hasn't heard from counts for the stage's grace
    // period and then lapses, and no presence event says so: look again then
    if (by && !by.mine && !Object.hasOwn(api.presence.get() ?? {}, by.session) && !heard.has(by.session)) {
      heard.add(by.session);
      later(redraw, LAPSE_MS);
    }
    return by;
  }
  const stateOf = (ref, snap = api.scene()) => {
    const by = claimOf(ref);
    const seat = seatAt(snap, ref);
    return { by, seat, state: seatState(seat, by, viewer) };
  };
  /** Is this view in seat `ref` now: claiming it, and (lasting) written down there? */
  const holding = (ref) => (lasting(seatAt(api.scene(), ref)) ? sameSeat(mySeat(api.scene(), viewer), ref) : sameSeat(perch?.ref, ref));
  const claim = (ref, onLost) => api.claim(ref.of, SEAT_CLAIM(ref.seat), { onLost });

  // ── the picker ──
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("seats-overlay");
  const picker = el("select", { class: "seats-pick", "aria-label": "Seat", title: "Where you sit: what's kept for your seat is shown to you alone" });
  let picked = ""; // what the picker shows as this viewer's seat
  let shown; // whose seats the picker shows: an object id, null for the doc's own, undefined while it's hidden (with the doc's own in it)
  picker.addEventListener("change", () => {
    const of = shown ?? null;
    const want = picker.value || null;
    if (!want) return watch(of);
    const ref = { of, seat: want };
    const { by, seat, state } = stateOf(ref);
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
    sit(ref);
  });
  const bar = el("label", { class: "seats-bar" }, el("span", {}, "Seat"), picker);
  /**
   * Whose seats the picker shows: chrome follows attention. Sitting in one of
   * this doc's seats (this extension's seat body is the current one), that
   * seat's owner's. Else, sitting nowhere, those of what you look at, or of
   * the nearest thing it's part of that has seats of its own (a machine's
   * ports); else the same of what you have selected; else the doc's own
   * (its table's), if it has any.
   * undefined: none (your attention is elsewhere: of several tables, each
   * its own doc, only the one you're at shows its seats).
   */
  function pickerOwner(snap) {
    const v = api.view.get();
    if (v.body?.id === body.id) return v.body.ext === api.id ? (sitting?.of ?? null) : undefined;
    const look = api.look();
    if (look == null && v.selected == null) return undefined;
    // (the look first, then the selection: whichever is on something with seats of its own)
    for (const at of [look?.id ?? null, typeof v.selected === "string" ? v.selected : null]) {
      const seen = new Set();
      for (let id = at; id != null && snap?.objects?.[id] && !seen.has(id); id = snap.parents?.get?.(id) ?? null) {
        if (Object.keys(seatsOf(snap, id)).length) return id;
        seen.add(id);
      }
    }
    return Object.keys(seatsOf(snap)).length ? null : undefined;
  }
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
    // (hidden, it keeps the doc's own seats, for when attention comes back)
    shown = pickerOwner(scene);
    const of = shown ?? null;
    const seats = seatsOf(scene, of);
    const ids = Object.keys(seats);
    bar.hidden = !ids.length || shown === undefined;
    const st = new Map(ids.map((id) => [id, stateOf({ of, seat: id }, scene)]));
    // ask after everyone here by name now, so a notice about them can say who
    for (const r of Object.values(api.presence.get() ?? {})) contactName(r?.viewer);
    picked = ids.find((id) => st.get(id).state === "mine" || st.get(id).state === "mine-elsewhere") ?? "";
    const note = { taken: " (taken)", away: " (away)" };
    const label = (id) => `${seats[id]?.name || id}${note[st.get(id).state] ?? ""}`;
    const k = JSON.stringify([of, ids.map(label)]);
    if (k !== seatKey) {
      seatKey = k;
      picker.replaceChildren(el("option", { value: "" }, "Watching"), ...ids.map((id) => el("option", { value: id }, label(id))));
    }
    if (globalThis.document?.activeElement !== picker) picker.value = picked;
    tagged = [];
    for (const z of placesOf(scene)) {
      if (!seatAt(scene, z)) continue;
      const s = stateOf(z, scene);
      tagged.push({ z, text: `${s.seat?.name || z.seat} · ${occupant(s)}`, state: s.state, cam: s.seat?.camera ?? null });
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
      items.push({ key: z.of == null ? z.id : `${z.id}:${z.seat}`, text, position, className: "seat-tag", data: { state }, rank: 1 });
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
   * Put the doc and this view's claims back in step, out of the change that
   * prompted it (a microtask), writing only what differs:
   * - the seat this view sits in that doesn't last has gone (its object
   *   removed, or the seat): let go, and up from it;
   * - this view holds a lasting seat's claim but the doc no longer seats
   *   this viewer there:
   *   - the seat itself has gone (an edit, its object removed): let go;
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
      const snap = api.scene();
      if (perch && !seatAt(snap, perch.ref)) {
        const ref = perch.ref;
        releasePerch();
        if (sameSeat(sitting, ref)) getUp();
        drawSeats();
      }
      if (held) {
        const ref = held.ref;
        const seat = seatAt(snap, ref);
        if (!seat) {
          held.release();
          held = null;
        } else if (claimOf(ref)?.mine && seat.player !== viewer) {
          const elsewhere = mySeat(snap, viewer);
          const otherTab = Object.values(api.presence.get() ?? {}).some((r) => r?.viewer === viewer);
          if (elsewhere || (!seat.player && otherTab)) {
            held.release();
            held = null;
            drawSeats();
          } else {
            api.change((d) => {
              const s = seatAt(d, ref);
              if (s && s.player !== viewer) s.player = viewer;
            });
          }
        }
        return;
      }
      const mine = mySeat(snap, viewer);
      if (!mine || claimOf(mine)) return;
      const release = claim(mine, () => lost(mine));
      if (release) held = { ref: mine, release, at: api.clock.now() };
    });
  }
  /** In a draft: this viewer in lasting seat `ref` (or none) and in no other lasting seat of the doc. */
  function seatIn(d, ref) {
    for (const x of allSeats(d)) if (lasting(x.s) && x.s?.player === viewer && !sameSeat(x, ref)) x.s.player = null;
    const s = seatAt(d, ref);
    if (s && s.player !== viewer) s.player = viewer;
  }
  /** What a seat is called. */
  const nameOf = (ref, snap = api.scene()) => seatAt(snap, ref)?.name || ref.seat;
  /**
   * Someone else's claim on a seat this view held won the merge (two
   * sitting at once), or this view went unheard long enough for its seat
   * to be taken: say so, and write nothing.
   */
  function lost(ref) {
    const since = sameSeat(held?.ref, ref) ? held.at : null;
    if (sameSeat(held?.ref, ref)) held = null;
    const by = claimOf(ref);
    // the same person in another tab: still seated
    if (!(by && by.viewer === viewer)) {
      const seat = seatAt(api.scene(), ref);
      // (a holder this view can't hear from reads as nobody: the doc's player says who)
      lostSay(ref, since, by?.viewer ?? (seat?.player !== viewer ? seat?.player : null));
    }
    drawSeats();
  }
  /** Someone else's claim won the seat that doesn't last this view sat in, or its object went: up from it, saying why (nothing for a seat that's gone). */
  function lostPerch(ref) {
    if (!sameSeat(perch?.ref, ref)) return;
    const since = perch.at;
    perch = null;
    if (seatAt(api.scene(), ref)) lostSay(ref, since, claimOf(ref)?.viewer ?? null);
    if (sameSeat(sitting, ref)) getUp();
    drawSeats();
  }
  function lostSay(ref, since, taker) {
    const name = someone(taker);
    const race = since == null || api.clock.now() - since < RACE_MS;
    api.notify(race ? `${name} sat in ${nameOf(ref)} first; you're watching` : `${name} took ${nameOf(ref)} while you were away; you're watching`);
    // sat down from walking and lost the race for it: back on your feet there
    if (race && since != null && sameSeat(walkedUp?.ref, ref) && walkedUp.at === since) {
      walkedUp = null;
      getUp();
    }
  }
  function releasePerch() {
    const p = perch;
    perch = null;
    p?.release();
  }

  /** Sit in seat `ref`: claim it (and, lasting, let go of the last one and write it down), then its view. */
  function sit(ref) {
    // (sat from walking: seatVerbRun says so again once this has sat)
    walkedUp = null;
    const before = api.scene();
    const seat = seatAt(before, ref);
    if (!seat) return drawSeats();
    if (!lasting(seat)) return perchAt(ref);
    if (stateOf(ref, before).state !== "mine-elsewhere") {
      // (your own other tab has it: you're both seated, and it keeps the claim)
      const release = claim(ref, () => lost(ref));
      if (release === null) {
        api.notify(`${someone(claimOf(ref)?.viewer)} is sitting there.`);
        return drawSeats();
      }
      if (held && !sameSeat(held.ref, ref)) held.release();
      held = release ? { ref, release, at: api.clock.now() } : null;
    } else if (held && !sameSeat(held.ref, ref)) {
      held.release();
      held = null;
    }
    releasePerch();
    const was = mySeat(before, viewer);
    if (!sameSeat(was, ref) || seat.player !== viewer) api.change((d) => seatIn(d, ref));
    if (!sameSeat(was, ref) && seatAt(api.scene(), ref)?.player === viewer) said(ref);
    // each seat can say where its player looks from
    seatView(ref);
    drawSeats();
  }
  /** Sit in seat `ref`, one that doesn't last: its claim is all there is (nothing written); the last one this view sat in is let go. */
  function perchAt(ref) {
    if (!sameSeat(perch?.ref, ref)) {
      const release = claim(ref, () => lostPerch(ref));
      if (release === null) {
        api.notify(`${someone(claimOf(ref)?.viewer)} is sitting there.`);
        return drawSeats();
      }
      releasePerch();
      perch = { ref, release, at: api.clock.now() };
      said(ref);
    }
    seatView(ref);
    drawSeats();
  }
  /** "Sat down", here and to the others (the stage says it: `messages`). */
  function said(ref) {
    api.tell("sat", ref.of == null ? { seat: ref.seat } : { seat: ref.seat, of: ref.of });
  }
  /**
   * Watching, from the picker of owner `of`'s seats: up from the seat there
   * that doesn't last, if you sit in one; else no longer the player of a
   * lasting seat there (their claim let go, the doc saying so).
   */
  function watch(of) {
    walkedUp = null;
    if (perch && (perch.ref.of ?? null) === of) {
      releasePerch();
      getUp();
      return drawSeats();
    }
    const was = mySeat(api.scene(), viewer);
    if (held && (held.ref.of ?? null) === of) {
      held.release();
      held = null;
    }
    if (was && (was.of ?? null) === of) api.change((d) => seatIn(d, null));
    getUp();
    drawSeats();
  }

  /** What is told: "sat", a seat id (and its owner's object id) only; said once the seat is one of this scene's. */
  const messages = {
    sat: {
      valid: (d) => typeof d.seat === "string" && !!d.seat && d.seat.length < 128 && (d.of == null || (typeof d.of === "string" && d.of.length < 128)),
      says(d, who, s) {
        const seat = seatAt(s, refOf(d));
        return seat ? `${who.name} sat down as ${seat.name || d.seat}` : null;
      },
    },
  };

  // ── the seat's view: the seat body (body.js) ──
  // Sitting enters it (the stage pushes it over the body you're in: walking
  // her deck, or Look); standing up, watching or moving pops it, and
  // whatever is under it carries on (walking resumes from the eye).
  let sitting = null; // the seat this view sits in, as a body: { of, seat }
  // the seat this view arrived seated in (the doc seated it: view.start's seat
  // body, no place), with no Watching under it: getting up from it comes back
  // to watching, as it does for someone who arrived watching and then sat
  let arrivedIn = null;
  let watchingNext = false;
  const seatDef = seatBody(api, {
    left: (ref) => {
      if (sameSeat(sitting, ref)) sitting = null;
      if (sameSeat(arrivedIn, ref)) arrivedIn = null;
      // up from a seat that doesn't last, however (Stand up, the chip's Leave): it's free again
      if (sameSeat(perch?.ref, ref)) {
        releasePerch();
        drawSeats();
      }
    },
  });
  // Arriving (the stage enters view.start's body: { body: "seat" }, no
  // place): back in your own seat if the doc seats you (its claim is
  // reconcile's), else watching from the first seat's view, labelled so,
  // writing nothing; the picker or a seat's verb sits you down over it, and
  // standing up comes back to it (from your own seat too: arrivedIn). A seat
  // named (the picker, the verb) is the seat body as ever.
  const body = {
    ...seatDef,
    enter(place) {
      if (place != null) return seatDef.enter(place);
      // (getting up from the seat you arrived in: watching, whatever the doc's copy here says yet)
      const at = arrivalSeat(seatsOf(api.scene()), watchingNext ? null : viewer);
      const s = at ? seatDef.enter(at.sid) : null;
      if (!s) return null;
      if (at.mine) {
        sitting = arrivedIn = s.seat;
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
    const back = was != null && was === arrivedIn;
    arrivedIn = null;
    if (was != null && seated()) api.body.leave();
    // arrived in it: back to watching (the doc no longer seats you), as if you'd arrived watching and sat
    if (back && !seated()) {
      watchingNext = true;
      try {
        api.body.enter(body.id, null);
      } finally {
        watchingNext = false;
      }
    }
  }
  /** Into seat `ref`'s view (the seat body); back down to it if it's under something already. */
  function seatView(ref) {
    if (sameSeat(sitting, ref)) {
      downToSeat();
      if (seated()) return;
    }
    getUp();
    // (a seat with no camera, or one in a frame that's gone: the view stays as it is)
    if (api.body.enter(body.id, ref.of == null ? ref.seat : ref)) sitting = ref;
  }

  // ── a seat as a station: walk up to it and sit ──
  // Walking, a look at a seat's place within reach offers "Sit as <name>"
  // (F), which sits you exactly as the picker does (the same claim, notices
  // and refusals; an away seat asks first, by a second F rather than a
  // dialog, since the pointer is locked): the seat body goes on over the
  // walk. Sitting there, a look at your own place offers "Stand up": the
  // seat body comes off, and you walk on from the eye, the seat staying
  // yours.
  let walkedUp = null; // { ref, at }: the seat this view sat in from walking, and its claim's time; cleared by any other sit
  let confirming = null; // { ref, until }: an away seat's first F
  const drawnIn = (snap) => (id) => api.worldOf(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
  /** Walking: in a body over the stage's Look (depth 0) that isn't the seat. */
  const walking = () => {
    const b = api.view.get()?.body;
    return (b?.depth ?? 0) > 0 && b.id !== body.id;
  };

  /** The seat a look at `target` (in the command context) is on, and what its verb says: { ref, verb, shown } | null. */
  function aim(target, ctx) {
    const snap = ctx?.scene ?? scene;
    if (!snap) return null;
    const ref = seatLookedAt({ snap, target, point: ctx?.hit?.point ?? null, places: placesOf(snap), drawn: drawnIn(snap), mine: seated() ? sitting : null });
    if (!ref) return null;
    const st = stateOf(ref, snap);
    const name = st.state === "taken" ? contactName(st.by?.viewer) : st.state === "away" ? contactName(st.seat?.player) : null;
    const v = seatVerb({
      name: nameOf(ref, snap),
      state: st.state,
      who: name,
      walking: walking(),
      seated: seated() && sameSeat(sitting, ref),
      confirming: sameSeat(confirming?.ref, ref) && api.clock.now() < confirming.until,
      lasting: lasting(st.seat),
    });
    if (!v) return null;
    const { verb, ...shown } = v;
    return { ref, verb, shown };
  }

  const seatVerbState = (target, ctx) => aim(target, ctx)?.shown ?? null;

  // run gets the context state was asked in (the same look), so it aims again
  function seatVerbRun(target, _value, ctx) {
    const a = aim(target, ctx);
    if (!a) return;
    if (a.verb === "stand") return standUp(a.ref);
    const { by, seat, state } = stateOf(a.ref);
    if (state === "taken") return api.notify(`${someone(by?.viewer)} is sitting there.`);
    if (state === "away" && !(sameSeat(confirming?.ref, a.ref) && api.clock.now() < confirming.until)) {
      confirming = { ref: a.ref, until: api.clock.now() + CONFIRM_MS };
      return api.notify(`${contactName(seat?.player) ?? "Whoever sat there"} is away. Press F again to take their seat; you'll see what's theirs.`);
    }
    confirming = null;
    sit(a.ref);
    if (!holding(a.ref)) return; // refused, or lost the race: told already
    // (this sitting's claim, so a later one from the picker is never taken for it)
    const c = sameSeat(held?.ref, a.ref) ? held : sameSeat(perch?.ref, a.ref) ? perch : null;
    walkedUp = { ref: a.ref, at: c ? c.at : null };
  }

  /** A seat named by someone else (the roster's `sit`, `stateOf`): `{ of, seat }`, `of` an object id or null; else null. */
  const refArg = (ref) => (ref && typeof ref === "object" && typeof ref.seat === "string" ? { of: ref.of ?? null, seat: ref.seat } : null);
  /**
   * The roster's `sit`: seat `ref` sat in for another package (a machine's
   * Play), as the picker sits you in it (its claim, the notice, the seat
   * body), but never over someone: a seat that's taken or away, or isn't
   * there, is refused, saying nothing (the caller says why, in its own
   * words). Already sitting there, it's the seat's view again. Whether this
   * view now holds that seat (its claim, and a lasting seat's player), as
   * the station's verb asks after sitting: a seat with no view holds you
   * without the seat body, so `sitting()` stays null there.
   */
  function sitFor(ref) {
    if (!ref) return false;
    const { state } = stateOf(ref);
    if (state === "taken" || state === "away") return false;
    sit(ref);
    return holding(ref);
  }

  /** Up from your seat: the seat body comes off; a lasting seat stays yours, one that doesn't is free (the body's `left`). */
  function standUp(ref) {
    if (!seated()) return;
    const keeps = lasting(seatAt(api.scene(), ref));
    const name = nameOf(ref);
    getUp();
    api.notify(keeps ? `You got up from ${name}; it's still yours.` : `You got up from ${name}.`);
  }

  return {
    update(snapshot, local, prev) {
      // (what's running changed: someone who gives seats places may have come or gone)
      if (snapshot === prev?.scene && local?.running === prev?.local?.running) {
        // attention moved (the picker follows it): another owner's seats, or none
        if (scene && pickerOwner(scene) !== shown) drawSeats();
        return followTags(snapshot, local);
      }
      scene = snapshot;
      drawSeats();
      followTags(snapshot, local);
      reconcile();
    },
    messages,
    roster: Object.freeze({
      seats: (snap) => rosterOf(snap),
      viewers: (snap) => rosterOf(snap).map((s) => s.viewer).filter(Boolean),
      open: (snap) => rosterOf(snap).filter((s) => !s.viewer).map((s) => s.name),
      nameOf: (snap, v) => (v ? (rosterOf(snap).find((s) => s.viewer === v)?.name ?? null) : null),
      who,
      // the seat this view is sitting in now: the seat body on top, in that seat
      sitting: () => (seated() && sitting ? { of: sitting.of, seat: sitting.seat } : null),
      stateOf: (ref) => {
        const r = refArg(ref);
        return r && seatAt(api.scene(), r) ? stateOf(r).state : null;
      },
      sit: (ref) => sitFor(refArg(ref)),
    }),
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
      releasePerch();
      for (const cancel of timers) cancel();
      timers.clear();
    },
  };
}

export default { create, lay };
