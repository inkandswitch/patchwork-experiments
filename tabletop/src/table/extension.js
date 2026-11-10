// The tabletop's scene extension (`scene:extension` "tabletop"): what makes a
// scene a game table. Seats and who sits in them, private zones, hidden cards
// and the decks they belong to, shuffling a pile, laying out a deck dropped on
// the table, drawing a card into your hand face up, and rolling dice. The
// scene itself knows none of this (scene/README, "Extensions").
//
// It is built only from the scene's extension contract (scene/STAGE.md): the
// hand, keys, menu, frame and notices it relies on are other extensions it
// `requires`; its own UI is a seat picker over the table (an overlay), deck
// trouble as HUD lines, Shuffle, Draw and Roll as verbs on the use prompt
// (and the menu), and each seat as a station on the use prompt for whoever
// walks up to it in first person (Sit as …, Stand up: seat-verbs.js).
// Nothing here assumes a sidebar or toolbar exists.
//
// What a hidden card looks like to this viewer is one of three (privacy.js):
// its back face down, its face when this viewer may see it, and the privacy
// face (one generic picture, made once per scene) when it's face up but not
// for them.
//
// What someone does at the table (shuffled, sat down, drew, rolled) is told
// to everyone else with api.send, as counts and seat ids only, never which
// card: `announce` here, `receive` there.
//
// Decks: a hidden object names its deck (trait tabletop.hidden: { by: url }).
// A plain deck (plain-deck.js) is read here; any other kind through the
// `tabletop:deck` plugin for its datatype (card-table's secure deck), whose
// module has createResolver({ repo, handle, viewer, onChange }) and, to be
// laid out when dropped, placement(doc) and bind(handle, ids).

import { HIDDEN, SEATS, docUrl, faceUpIn, hiddenBy, seatAt, seatOf, seatedPlayers, seatsOf, visibility, zones } from "./visibility.js";
import { PLAIN_DECK, plainResolver } from "./plain-deck.js";
import { CARD_TAGS, nearestSlot, worldSlots, yawOfMatrix } from "./slots.js";
import { DIE, MAX_FACE, ROLL_SECONDS, faceUp, facesOf, pivotOf, rollPlan, scaleOf, upIn } from "./dice.js";
import { apply, composeMatrix, invert, levelPose, multiply } from "./frame.js";
import { cardBounds, cardState, privacyFile, privacyKey, rememberAsset } from "./privacy.js";
import { CONFIRM_MS, seatLookedAt, seatVerb } from "./seat-verbs.js";


const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

export default {
  create(api) {
    const { repo, viewer } = api;
    const decks = new Map(); // url → { resolver, module, problem }
    let scene = null;
    let looks = new Map();
    let regions = null;
    let dead = false;
    // a deck learned something (a card's face, a shuffle): read the lens again
    const refresh = () => {
      if (dead) return;
      if (scene) lens(scene);
      api.schedule(() => {});
    };

    const deckProvider = (type) => deckProviderFor(api.registry, type);

    function watchDecks(urls) {
      for (const [url, deck] of decks) {
        if (urls.has(url)) continue;
        deck.resolver?.dispose?.();
        decks.delete(url);
      }
      for (const url of urls) {
        if (decks.has(url)) continue;
        const deck = { resolver: null, problem: null, title: null, plain: false };
        decks.set(url, deck);
        (async () => {
          const h = await repo.find(url);
          if (dead || decks.get(url) !== deck || !h) return;
          const type = h.doc()?.["@patchwork"]?.type ?? null;
          deck.title = h.doc()?.title ?? null;
          deck.plain = !type || type === PLAIN_DECK;
          const provider = await deckProvider(type);
          if (dead || decks.get(url) !== deck) return;
          if (!provider) {
            deck.problem = `Some cards can't be shown: nothing installed reads “${type}” decks.`;
            return refresh();
          }
          deck.resolver = provider.create({ repo, handle: h, viewer, onChange: () => refresh() });
          refresh();
        })().catch((err) => {
          console.warn("[tabletop] deck unavailable", url, err);
          deck.problem = `Some cards can't be shown: ${err?.message ?? err}`;
          refresh();
        });
      }
    }

    /** The pile an object is in: the objects of its deck whose footprints overlap its own by half or more (in plan). */
    function stackOf(id) {
      const objects = scene?.objects ?? {};
      const by = hiddenBy(objects[id]);
      if (!by) return [];
      const same = Object.keys(objects).filter((x) => hiddenBy(objects[x]) === by);
      const box = api.box(id);
      if (!box) {
        // no geometry to go by: the same spot on the table
        const at = scene.world(id);
        return same.filter((x) => {
          const m = scene.world(x);
          return Math.hypot(m[12] - at[12], m[14] - at[14]) < 0.005;
        });
      }
      const area = (b) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[2] - b.min[2]);
      return same.filter((x) => {
        const b = x === id ? box : api.box(x);
        if (!b) return false;
        const ox = Math.min(b.max[0], box.max[0]) - Math.max(b.min[0], box.min[0]);
        const oz = Math.min(b.max[2], box.max[2]) - Math.max(b.min[2], box.min[2]);
        return ox > 0 && oz > 0 && ox * oz >= 0.5 * Math.min(area(b), area(box));
      });
    }

    function shuffleStack(id) {
      const by = hiddenBy(scene?.objects?.[id]);
      const deck = by ? decks.get(by) : null;
      if (!deck?.resolver?.shuffle) return api.notify(by ? "This deck can't be shuffled." : "Only cards in a deck can be shuffled.", "error");
      const n = deck.resolver.shuffle(stackOf(id));
      if (!n) return api.notify("There's nothing here to shuffle with it.", "error");
      announce("shuffled", { deck: by, n }, `Shuffling ${n} card${n === 1 ? "" : "s"}…`);
    }

    // ── telling the others: what happened, never which card ──
    /** Who a peer is at this table: their contact's name, else the name of the seat they sit in, else "Someone". */
    const nameOf = (from) => {
      const s = from?.viewer ? Object.values(seatsOf(scene)).find((x) => x?.player === from.viewer) : null;
      return contactName(from?.viewer) || s?.name || "Someone";
    };
    /** What a message says, from `who`; null if it's malformed or not one of ours. */
    function told(type, data, who) {
      if (!data || typeof data !== "object" || !Object.hasOwn(MESSAGES, type) || !MESSAGES[type](data)) return null;
      const cards = (n) => (n === 1 ? "a card" : `${n} cards`);
      switch (type) {
        case "shuffled": {
          const title = decks.get(data.deck)?.title;
          return `${who} shuffled ${title && title !== "Deck" ? `“${title}”` : "the deck"} (${data.n})`;
        }
        case "sat": {
          const seat = seatsOf(scene)[data.seat];
          if (!seat) return null;
          const name = seat.name || data.seat;
          return `${who === name ? "Someone" : who} sat down as ${name}`;
        }
        case "drew":
          return `${who} drew ${cards(data.n)}`;
        case "rolled":
          return `${who} rolled ${data.value}`;
      }
      return null;
    }
    /** Say it here (sends are never echoed back), then to every other peer. */
    function announce(type, data, local) {
      const text = local ?? told(type, data, "You");
      if (text) api.notify(text);
      api.send?.(type, data);
    }

    // ── where you sit ──
    // A seat's player is the doc's, and lasts: it's what decides who sees
    // which hand (lens, visibility.js), on every peer alike. Whether that
    // player is here now is a claim on the scene, `tabletop.seat:<id>`, held
    // by the view that sat down (scene/STAGE.md, "Claims"): it lapses when
    // they go, so a seat whose player has gone can be taken (after asking),
    // and one whose player is here can't. Claims never decide who sees what.
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

    let held = null; // { sid, release }: the seat this view claims
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
      const by = api.claimedBy?.(null, SEAT_CLAIM(sid)) ?? null;
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

    // a picker over the table (top right: the notices take the top left), since a table has no sidebar
    const overlay = api.overlay();
    overlay.classList.add("tabletop-overlay");
    const seatPicker = el("select", { class: "tabletop-seat", "aria-label": "Seat", title: "Where you sit: what's in your seat's private zone (your hand) is shown to you alone" });
    let picked = ""; // what the picker shows as this viewer's seat
    seatPicker.addEventListener("change", () => {
      const want = seatPicker.value || null;
      if (want) {
        const { by, seat, state } = stateOf(want);
        // someone is sitting there now: it's theirs while they're here
        if (state === "taken") {
          api.notify(`${someone(by.viewer)} is sitting there.`);
          seatPicker.value = picked;
          return;
        }
        // they've gone: their seat can be taken, but it's their hand you'll see
        if (state === "away" && typeof globalThis.confirm === "function") {
          const who = contactName(seat.player);
          if (!globalThis.confirm(`${who ?? "Whoever sat there"} is away. Take their seat? You'll see their hand.`)) {
            seatPicker.value = picked;
            return;
          }
        }
      }
      sit(want);
    });
    const seatBar = el("label", { class: "tabletop-seatbar" }, el("span", {}, "Seat"), seatPicker);
    overlay.append(seatBar);
    api.style(SEAT_CSS);
    // a name tag over each hand: whose seat it is, and whether they're here
    const tags = api.labels?.() ?? null;
    let seatKey = "";
    let tagKey = "";
    function drawSeats() {
      if (!scene || dead) return;
      const seats = seatsOf(scene);
      const ids = Object.keys(seats);
      seatBar.hidden = !ids.length;
      const st = new Map(ids.map((id) => [id, stateOf(id, seats)]));
      // ask after everyone here by name now, so a notice about them can say who
      for (const r of Object.values(api.presence.get() ?? {})) contactName(r?.viewer);
      picked = ids.find((id) => st.get(id).state === "mine" || st.get(id).state === "mine-elsewhere") ?? "";
      const note = { taken: " (taken)", away: " (away)" };
      const options = [["", "Watching"], ...ids.map((id) => [id, `${seats[id]?.name || id}${note[st.get(id).state] ?? ""}`])];
      const k = JSON.stringify(options);
      if (k !== seatKey) {
        seatKey = k;
        seatPicker.replaceChildren(...options.map(([v, t]) => el("option", { value: v }, t)));
      }
      if (globalThis.document?.activeElement !== seatPicker) seatPicker.value = picked;
      if (!tags) return;
      tagged = [];
      for (const z of zones(scene)) {
        const s = st.get(z.seat);
        if (s) tagged.push({ z, text: `${s.seat?.name || z.seat} · ${occupant(s)}`, state: s.state, cam: s.seat?.camera ?? null });
      }
      placeTags();
    }
    // Each tag on its hand as drawn (a table aboard a ship is where the
    // ship is this frame, not where the doc last saved her), every frame
    // while a hand is attached to something (which may be moving): on the
    // tray's surface at its edge nearest the seat (seatTagAt), so your own
    // sits just under your cards and the far one just past theirs, low on
    // the table rather than up in the top of the view.
    let tagged = []; // { z, text, state, cam }: what drawSeats last said
    let tagLoop = null;
    function placeTags() {
      if (!tags || dead) return;
      const items = tagged.map(({ z, text, state, cam }) => {
        const m = api.worldOf?.(z.id) ?? scene.world(z.id);
        const frame = cam?.in ? (api.worldOf?.(cam.in) ?? (scene.objects?.[cam.in] ? scene.world(cam.in) : null)) : null;
        const eye = cam?.position && (!cam.in || frame) ? (frame ? apply(frame, cam.position) : cam.position) : null;
        const position = apply(m, seatTagAt(z, eye ? apply(invert(m), eye) : null)).map((v) => +v.toFixed(4));
        return { key: z.id, text, position, className: "tabletop-seat-tag", data: { state }, rank: 1 };
      });
      const tk = JSON.stringify(items);
      if (tk !== tagKey) {
        tagKey = tk;
        tags.set(items);
      }
    }
    /** Follow the hands each frame while any is attached to something, in play; else stop. */
    function followTags(snapshot, local) {
      const moving = local?.activities?.current === "play" && tagged.some(({ z }) => (snapshot.parents?.get?.(z.id) ?? null) != null);
      if (moving && !tagLoop && api.loop) tagLoop = api.loop(placeTags);
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
          } else if (api.claimedBy?.(null, SEAT_CLAIM(sid))?.mine && seats[sid].player !== viewer) {
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
        const release = api.claim?.(null, SEAT_CLAIM(mine), { onLost: () => lost(mine) });
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
      const by = api.claimedBy?.(null, SEAT_CLAIM(sid));
      // the same person in another tab: still seated
      if (!(by && by.viewer === viewer)) {
        const seat = seatsOf(api.scene())[sid];
        // (a holder this view can't hear from reads as nobody: the doc's player says who)
        const who = someone(by?.viewer ?? (seat?.player !== viewer ? seat?.player : null));
        const race = since == null || Date.now() - since < RACE_MS;
        api.notify(race ? `${who} sat in ${seat?.name || sid} first; you're watching` : `${who} took ${seat?.name || sid} while you were away; you're watching`);
        // sat down from first person and lost the race for it: back on your feet there
        if (race && since != null && walkedUp?.sid === sid && walkedUp.at === since) {
          walkedUp = null;
          standAt(sid);
        }
      }
      drawSeats();
    }

    // ── drawing: a pile's top card, into your own hand ──
    // D over a pile that's out on the table: its top card glides into the
    // first free card slot of your seat's tray, face up (only you see its
    // face there: the zone rule, visibility.js), and lands in one write. On
    // its way it's a pose hold, so everyone sees it travel, and so of two
    // people drawing the same card at once one is told (heldBy) and takes the
    // next card instead.
    const drawing = new Map(); // card id → { slot, stop }: on its way to a slot, which is taken already

    /**
     * Whether `id` can be drawn from now, and into where: null when Draw
     * doesn't apply (not playing, not a hidden card, one in a hand already,
     * a seat with no tray); { disabled, label?, title } when it can't now;
     * else { slot } (world, yaw).
     */
    function drawPlan(id, snap = scene, local = api.local?.get?.()) {
      if (id == null || !snap || local?.activities?.current !== "play") return null;
      if (!hiddenBy(snap.objects?.[id])) return null;
      const regions = zones(snap);
      const m = snap.world(id);
      if (seatAt(snap, regions, [m[12], m[13], m[14]])) return null; // in a hand already
      const mine = seatOf(seatsOf(snap), viewer);
      if (!mine) {
        // only where sitting down would give you somewhere to draw to: some hand with a card slot
        const any = freeSlot(snap, regions.filter((z) => seatsOf(snap)[z.seat]));
        if (any === LOADING || any === NO_SLOTS) return null;
        return { disabled: true, label: "Sit down to draw", title: "Pick a seat at the top right to draw" };
      }
      const trays = regions.filter((z) => z.seat === mine);
      if (!trays.length) return null;
      const slot = freeSlot(snap, trays);
      if (slot === LOADING) return { disabled: true, title: "Your hand is still loading" };
      if (slot === NO_SLOTS) return null; // a hand without card slots: carry cards there instead
      if (!slot) return { disabled: true, label: "Your hand is full", title: "Every card slot in your hand has a card" };
      return { slot, title: "Draw the top card into your hand (D)" };
    }

    /**
     * The first card slot of these trays with no card on it (none within half
     * the slot's reach, in plan, nor one on its way there); null if all have
     * one, LOADING before a tray's content has loaded, NO_SLOTS if no tray
     * has a card slot at all.
     */
    function freeSlot(snap, trays) {
      const taken = [];
      for (const [x, o] of Object.entries(snap.objects ?? {})) {
        if (drawing.has(x) || !(hiddenBy(o) || (Array.isArray(o?.tags) && o.tags.includes(CARD_TAGS[0])))) continue;
        const w = snap.world(x);
        taken.push([w[12], w[14]]);
      }
      for (const d of drawing.values()) taken.push([d.slot.world[0], d.slot.world[2]]);
      let loading = false;
      let any = false;
      for (const z of trays) {
        const c = api.content?.(z.id);
        if (!c?.extras || c.loaded === false) {
          loading = true;
          continue;
        }
        const zm = snap.world(z.id);
        for (const s of worldSlots(zm, c.extras, CARD_TAGS)) {
          any = true;
          if (taken.every((p) => Math.hypot(p[0] - s.world[0], p[1] - s.world[2]) > s.radius / 2)) return { world: s.world, yaw: s.yaw ?? yawOfMatrix(zm), zone: z.id, local: s.local };
        }
      }
      return loading ? LOADING : any ? null : NO_SLOTS;
    }

    /**
     * Can card `x` be drawn now: there, not on its way already, not held by a
     * peer, and out on the table (a card in a hand, even one a pile overlaps,
     * is that seat's alone)? A card attached to something (a table aboard a
     * ship) glides in that thing's frame.
     */
    function canDraw(s, regions, x) {
      if (!s.objects?.[x] || drawing.has(x) || api.heldBy?.(x) != null) return false;
      const w = s.world(x);
      return !seatAt(s, regions, [w[12], w[13], w[14]]);
    }
    /** The cards of `id`'s pile that can be drawn, top first. */
    function drawable(id) {
      const s = api.scene();
      const regions = zones(s);
      return stackOf(id)
        .filter((x) => canDraw(s, regions, x))
        .sort((p, q) => s.world(q)[13] - s.world(p)[13]);
    }

    /**
     * Where a card goes to lie in a slot, as its doc transform: face up,
     * turned the slot's way. At the root its world is its local; attached to
     * something (a table aboard a ship), the slot (on the tray, as the doc
     * has it) is put in that thing's frame, so it's the same on every peer
     * whatever the ship is doing.
     */
    function slotPose(snap, id, slot, scale) {
      const parent = snap.parents?.get?.(id) ?? null;
      if (!parent || !slot.zone || !slot.local) return { position: slot.world.map((v) => +v.toFixed(6)), rotation: [0, +slot.yaw.toFixed(6), 0], scale };
      const inTray = multiply(snap.world(slot.zone), composeMatrix({ position: slot.local.position, rotation: [0, slot.local.yaw ?? 0, 0] }));
      const t = levelPose(multiply(invert(snap.world(parent)), inTray));
      return { position: t.position.map((v) => +v.toFixed(6)), rotation: t.rotation.map((v) => +v.toFixed(6)), scale };
    }

    function draw(id) {
      const plan = drawPlan(id, api.scene());
      if (!plan) return;
      if (plan.disabled) return api.notify(plan.label ?? plan.title);
      const pile = drawable(id);
      if (!pile.length) return api.notify("Someone drew that one");
      glide(pile, plan.slot, 1);
    }

    /** Carry pile[0] to `slot` (a pose held each frame), then write where it landed, once. A peer taking it first: the next card, `retries` times. */
    function glide(pile, slot, retries) {
      const [id, ...rest] = pile;
      const t0 = api.scene().objects[id].transform ?? {};
      const from = { position: [...(t0.position ?? [0, 0, 0])].map(Number), rotation: [...(t0.rotation ?? [0, 0, 0])].map(Number), scale: Number(t0.scale) || 1 };
      // face up, turned the slot's way, in its parent's frame
      const to = slotPose(api.scene(), id, slot, from.scale);
      const entry = { slot, stop: null };
      drawing.set(id, entry);
      let t = 0;
      const stop = () => {
        entry.stop?.();
        drawing.delete(id);
      };
      entry.stop = api.loop((dt) => {
        const now = api.scene().objects?.[id];
        // a peer took hold of it first, moved it or removed it: theirs
        if (!now || api.heldBy(id) != null || !sameTransform(now.transform, from)) {
          stop();
          if (now) api.pose.release(id);
          const s = api.scene();
          const regions = zones(s);
          const next = rest.filter((x) => canDraw(s, regions, x));
          if (retries > 0 && next.length) return glide(next, slot, retries - 1);
          return api.notify("Someone drew that one");
        }
        t = Math.min(1, t + (Number(dt) || 0) / DRAW_SECONDS);
        if (t < 1) return api.pose.hold(id, between(from, to, t));
        stop();
        api.change(api.ops.setTransform(api.scene(), id, to));
        api.pose.release(id, { landed: true });
        announce("drew", { n: 1 });
      });
      api.pose.hold(id, from);
    }

    // ── rolling: a die tossed and tumbled, landing on a random side ──
    // R over a die in play. The whole roll is worked out from one seed first
    // (dice.js rollPlan): where it lands and which side is up. It tumbles as a
    // pose hold, so everyone sees it in the air, and lands in one write. A
    // peer who takes hold of it meanwhile (or moves it) has it: the roll stops
    // and writes nothing. (R is the gizmo's Rotate while editing, which is why
    // Roll is play only.)
    const rolling = new Map(); // die id → stop

    /** Whether `id` can be rolled now: null when it isn't a die in play; { disabled, title } when it can't now. */
    function rollState(id, snap = scene, local = api.local?.get?.()) {
      if (id == null || !snap || local?.activities?.current !== "play") return null;
      const o = snap.objects?.[id];
      if (!o?.traits || !Object.hasOwn(o.traits, DIE) || o.locked) return null;
      if (rolling.has(id)) return { disabled: true, title: "It's rolling" };
      if (api.heldBy?.(id) != null) return { disabled: true, title: "Someone has that die" };
      return { title: "Roll the die (R)" };
    }

    function roll(id) {
      const snap = api.scene();
      const st = rollState(id, snap);
      if (!st) return;
      if (st.disabled) return rolling.has(id) ? undefined : api.notify(st.title);
      const o = snap.objects[id];
      const t0 = o.transform ?? {};
      const from = { position: [...(t0.position ?? [0, 0, 0])].map(Number), rotation: [...(t0.rotation ?? [0, 0, 0])].map(Number), scale: Number(t0.scale) || 1 };
      // it lands in its parent's frame, with world up as that frame sees it
      const parent = snap.parents?.get?.(id) ?? null;
      const pm = parent ? snap.world(parent) : null;
      const seed = Math.floor(Math.random() * 2 ** 32) >>> 0;
      const plan = rollPlan(seed, { from, faces: facesOf(o.traits[DIE]), pivot: pivotOf(o), up: upIn(pm), unitScale: scaleOf(pm) });
      let t = 0;
      const stop = () => {
        rolling.get(id)?.();
        rolling.delete(id);
      };
      rolling.set(
        id,
        api.loop((dt) => {
          const now = api.scene().objects?.[id];
          // a peer caught it, moved it or removed it: theirs
          if (!now || api.heldBy(id) != null || !sameTransform(now.transform, from)) {
            stop();
            if (now) api.pose.release(id);
            return;
          }
          t = Math.min(1, t + (Number(dt) || 0) / ROLL_SECONDS);
          if (t < 1) return api.pose.hold(id, plan.at(t));
          stop();
          api.change(api.ops.setTransform(api.scene(), id, plan.to));
          api.pose.release(id, { landed: true });
          announce("rolled", { die: id, value: plan.value });
        }),
      );
      api.pose.hold(id, from);
    }

    // ── a peer's roll: what the die shows in the doc, not what they say ──
    // A peer says which die it rolled and what it shows. That's told only
    // when the doc moved that die (just before, or soon after: the message
    // and the doc change travel apart) to a side showing that number, once
    // per move; otherwise nothing is. So a die set down by hand and
    // "announced" later isn't told as a roll, nor a number the die doesn't
    // show. A message the doc doesn't bear out yet waits for the die's next
    // move, for a few seconds.
    const seenAt = new Map(); // die id → its doc transform as this view last saw it (a copy)
    const moved = new Map(); // die id → when this view saw its doc transform change (ms), until a roll is told for it
    const pending = new Map(); // die id → { value, who }: waiting for the doc to move it
    const copyOf = (t) => (t ? JSON.parse(JSON.stringify(t)) : null);

    /** In update(): note each die whose transform changed, and tell a roll that was waiting for it. */
    function diceMoved(snap) {
      for (const [id, o] of Object.entries(snap.objects ?? {})) {
        if (!o?.traits || !Object.hasOwn(o.traits, DIE)) continue;
        const was = seenAt.get(id);
        seenAt.set(id, copyOf(o.transform));
        if (was === undefined || sameTransform(o.transform, was)) continue;
        moved.set(id, Date.now());
        const p = pending.get(id);
        if (p && tellRoll(id, p.value, p.who)) pending.delete(id);
      }
    }
    function heardRoll(data, who) {
      if (!data || typeof data !== "object" || !MESSAGES.rolled(data)) return;
      const id = data.die;
      const o = api.scene().objects?.[id];
      if (!o?.traits || !Object.hasOwn(o.traits, DIE)) return;
      // the doc has moved it already (here, or since this view last looked)
      const was = seenAt.get(id);
      if (was !== undefined && !sameTransform(o.transform, was)) {
        seenAt.set(id, copyOf(o.transform));
        moved.set(id, Date.now());
      }
      if (Date.now() - (moved.get(id) ?? -Infinity) <= ROLL_TRUST_MS && tellRoll(id, data.value, who)) return;
      const wait = { value: data.value, who };
      pending.set(id, wait);
      later(() => pending.get(id) === wait && pending.delete(id), ROLL_TRUST_MS);
    }
    /** "<who> rolled <n>", if the die shows n in the doc; that move of it is then spent. → whether it was told */
    function tellRoll(id, value, who) {
      const s = api.scene();
      const o = s.objects?.[id];
      if (!o?.traits || !Object.hasOwn(o.traits, DIE)) return false;
      const parent = s.parents?.get?.(id) ?? null;
      const shows = faceUp(o.transform?.rotation ?? [0, 0, 0], facesOf(o.traits[DIE]), upIn(parent ? s.world(parent) : null))?.value;
      if (shows !== value) return false;
      moved.delete(id);
      api.notify(told("rolled", { die: id, value }, who));
      return true;
    }

    /**
     * What each hidden card looks like to this viewer (privacy.js cardState):
     * its face where its deck gives this viewer one (every deck speaks for
     * its own cards); else, face up, the privacy face when the zone rule
     * keeps it from this viewer, or it's theirs and the deck says it's dealt
     * (its keys on their way); else its back (no look). A deck not dealt yet
     * (resolver.dealt() false: a secure deck waiting for its players) shows
     * every card's back. A deck that hasn't loaded yet says nothing, so its
     * cards keep their backs until it does; one that can't be read (a
     * problem) is private face up.
     */
    function lens(snapshot) {
      looks = new Map();
      if (!decks.size) return;
      const objects = snapshot.objects;
      const seats = seatsOf(snapshot);
      const ctx = {
        objects,
        seats,
        viewer,
        players: seatedPlayers(seats),
        openSeats: Object.entries(seats).filter(([, s]) => !s?.player).map(([id, s]) => s?.name || id),
        visibleTo: visibility(snapshot, seats),
        nameOf: (player) => Object.values(seats).find((s) => s?.player === player)?.name ?? "someone",
      };
      const faces = new Map();
      for (const [url, deck] of decks) {
        if (!deck.resolver) continue;
        deck.resolver.update(ctx);
        for (const [id, look] of deck.resolver.looks()) if (hiddenBy(objects[id]) === url) faces.set(id, look);
      }
      const mine = ctx.visibleTo(viewer);
      const dealt = new Map(); // deck url → true | false | null (cardState)
      for (const [url, deck] of decks) {
        // (a deck that can't be read: nothing it holds will ever show here, so it's withheld)
        if (deck.problem) dealt.set(url, true);
        else if (deck.resolver) {
          let d = null;
          try {
            d = typeof deck.resolver.dealt === "function" ? deck.resolver.dealt() : null;
          } catch {}
          dealt.set(url, typeof d === "boolean" ? d : null);
        }
      }
      for (const [id, o] of Object.entries(objects)) {
        const by = hiddenBy(o);
        if (!by) continue;
        const face = faces.get(id);
        // a deck that hasn't loaded yet says nothing: its cards keep their backs
        const known = dealt.has(by);
        const state = cardState({ face: !!face, faceUp: known && faceUpIn(snapshot, id), withheld: !mine.has(id), dealt: dealt.get(by) ?? null });
        if (state === "face") looks.set(id, face);
        else if (state === "private") {
          const url = privacyFor(snapshot, o);
          if (url) looks.set(id, { sourceUrl: url });
        }
      }
    }

    // ── the privacy face: one file per card size, made once per scene ──
    // The first view that needs it makes it (privacy.js), as the stage's
    // ctx.file would (that's for drops and parts; an extension has no
    // ctx.file): a file doc, remembered at doc.assets[key] if that key is
    // still empty. Nothing is ever written per card. Two views making it at
    // once each make a file doc and each write the key into the one `assets`
    // map the doc was made with; the merge keeps one, the other is a spare
    // file nothing names, both drawn alike, and every view uses the one kept
    // from then on. Until it's there, a private card shows its back.
    const privacy = new Map(); // key → { url: string | null }
    function privacyFor(snapshot, o) {
      const bounds = cardBounds(o);
      const key = privacyKey(bounds);
      // (the doc as it is now: one this view just wrote may be newer than the snapshot)
      const known = (api.scene?.() ?? snapshot)?.d?.assets?.[key]?.url ?? snapshot?.d?.assets?.[key]?.url;
      if (typeof known === "string" && known) return known;
      let p = privacy.get(key);
      if (!p) privacy.set(key, (p = makePrivacy(key, bounds)));
      return p.url;
    }
    function makePrivacy(key, bounds) {
      const p = { url: null };
      if (typeof repo?.create2 !== "function") return p;
      (async () => {
        const f = privacyFile(bounds);
        const h = await repo.create2({ "@patchwork": { type: "file" }, name: f.name, extension: f.extension, mimeType: f.mimeType, content: f.bytes });
        if (dead || typeof h?.url !== "string") return;
        p.url = h.url;
        api.change((d) => rememberAsset(d, key, h.url, bounds));
        refresh();
      })().catch((err) => console.warn("[tabletop] couldn't make the privacy face", err));
      return p;
    }

    /** Sit in a seat (null: watch): claim it, let go of the last one, then write it down. */
    function sit(seatId) {
      // (sat from first person: seatVerbRun says so again once this has sat)
      walkedUp = null;
      const before = seatsOf(api.scene());
      if (seatId && !before[seatId]) return drawSeats();
      if (seatId && stateOf(seatId, before).state !== "mine-elsewhere") {
        // (your own other tab has it: you're both seated, and it keeps the claim)
        const release = api.claim?.(null, SEAT_CLAIM(seatId), { onLost: () => lost(seatId) });
        if (release === null) {
          api.notify(`${someone(api.claimedBy?.(null, SEAT_CLAIM(seatId))?.viewer)} is sitting there.`);
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
      if (seatId && was !== seatId && seatsOf(api.scene())[seatId]?.player === viewer) announce("sat", { seat: seatId });
      // each seat can say where its player looks from
      const cam = seatId ? seatsOf(api.scene())[seatId]?.camera : null;
      if (cam) seatView(cam);
      else stopRiding();
      drawSeats();
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
      if (api.local?.get?.()?.immersive) {
        waiting = true;
        return;
      }
      const { in: frame, ...view } = cam;
      const m = frame ? (api.worldOf?.(frame) ?? (api.scene().objects?.[frame] ? api.scene().world(frame) : null)) : null;
      // in a frame that's gone (its table deleted): no view to put you in; the view stays as it is
      if (frame && !m) return;
      if (m) {
        view.position = apply(m, cam.position);
        view.target = apply(m, cam.target ?? [0, 0, 0]);
      }
      api.camera.set(view);
      // riding the spot it looks at, which so holds still on screen however she rolls
      // (a stage without rides: the view is set once)
      if (m && typeof api.camera.ride === "function") riding = api.camera.ride(frame, { at: [...(cam.target ?? [0, 0, 0])] }) ?? null;
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
    // In first person, a look at a seat's place (its tray, its bench:
    // seat-verbs.js) within reach offers "Sit as <name>" (F), which sits
    // you exactly as the picker does (the same claim, notices and refusals;
    // an away seat asks first, by a second F rather than a dialog, since the
    // pointer is locked) and then hands the view over: whatever you walk with
    // (a running extension's `firstPerson`, sailing's crew) is asked to
    // leave first person, and the seat's view takes over as it ends
    // (backInSeat). Sitting there, a look at your own place offers "Stand
    // up" when there's something to walk with: it's asked to put you on your
    // feet at the seat (firstPerson.enter), the seat staying yours, as
    // getting up any other way does; Esc, or F at it, sits you back down.
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
    const drawnIn = (snap) => (id) => api.worldOf?.(id) ?? (snap?.objects?.[id] ? snap.world(id) : null);
    const walkers = () =>
      (api.collect?.("firstPerson") ?? []).map((r) => r?.value).filter((v) => v && typeof v === "object" && typeof v.enter === "function" && typeof v.leave === "function");

    function seatVerbState(target, ctx) {
      aimed = null;
      const snap = ctx?.scene ?? scene;
      const local = ctx?.local ?? api.local?.get?.();
      // the prompt's alone: it says where the eye is
      if (!snap || !Array.isArray(ctx?.from) || local?.activities?.current !== "play") return null;
      const seats = seatsOf(snap);
      const sid = seatLookedAt({ snap, target, point: ctx.hit?.point ?? null, from: ctx.from, seats, drawn: drawnIn(snap) });
      if (!sid) return null;
      const st = stateOf(sid, seats);
      const who = st.state === "taken" ? contactName(st.by?.viewer) : st.state === "away" ? contactName(st.seat?.player) : null;
      const v = seatVerb({
        name: seats[sid]?.name || sid,
        state: st.state,
        who,
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
        return api.notify(`${contactName(seat?.player) ?? "Whoever sat there"} is away. Press F again to take their seat; you'll see their hand.`);
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
      if (!api.local?.get?.()?.immersive) return;
      const ws = walkers();
      if (!ws.length) return api.notify("Leave first person (Esc) to take your seat.");
      for (const w of ws) {
        try {
          w.leave();
        } catch (err) {
          console.warn("[tabletop] firstPerson.leave failed", err);
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
      const at = (p) => (m ? apply(m, p) : [...p]).map(Number);
      const spot = { seat: sid, eye: at(cam.position), target: at(cam.target ?? [0, 0, 0]), frame: cam.in ?? null };
      const was = riding;
      stopRiding();
      let ok = false;
      try {
        ok = w.enter(spot) !== false;
      } catch (err) {
        console.warn("[tabletop] firstPerson.enter failed", err);
      }
      if (!ok && was) seatView(cam);
      return ok;
    }

    return {
      update(snapshot, local, prev) {
        // Playing at a table is done with the hand. A tool picked while editing
        // (G, R, the toolbar) is this view's local state and outlives the switch
        // back to play, and a scene that became a table by a part (a die, a
        // pawn) suggests no tool, so the stage's default is Move: in play
        // nothing offers a way to the hand, and without this the table could
        // no longer be carried or flipped. The tool in force is the scene's
        // effectiveTool (scene/src/current-tool.js, copied: packages stand
        // alone); the hand's own command switches to it. (A stage-wide gap,
        // an Edit tool outliving the switch to Play, which belongs to
        // scene.activity in time.)
        if (local?.activities?.current === "play" && (local.tool ?? snapshot?.d?.view?.tool ?? "move") !== "hand") {
          // (the hand not started yet: its command's write, done here)
          if (api.run?.({ ext: "scene.hand", command: "hand" }) !== true) api.local?.swap?.((m) => (m.tool === "hand" ? m : { ...m, tool: "hand" }));
        }
        backInSeat(local, prev?.local);
        if (snapshot === prev?.scene) return followTags(snapshot, local);
        scene = snapshot;
        diceMoved(snapshot);
        regions = null;
        const urls = new Set();
        for (const o of Object.values(snapshot.objects)) {
          const by = hiddenBy(o);
          if (by) urls.add(by);
        }
        watchDecks(urls);
        lens(snapshot);
        drawSeats();
        followTags(snapshot, local);
        reconcile();
      },
      looks: () => looks,
      receive(type, data, from) {
        if (type === "rolled") return heardRoll(data, nameOf(from));
        const text = told(type, data, nameOf(from));
        if (text) api.notify(text);
      },
      hud() {
        const out = [];
        for (const deck of decks.values()) {
          const line = deck.problem ?? deck.resolver?.status?.();
          // a deck's status (waiting for players, shuffling) is news, not trouble
          if (line) out.push({ text: line, state: deck.problem ? "error" : "info" });
        }
        // a plain deck at a table with hands: everyone at it, every time, is
        // told their hand isn't secret (the deck doc, which every hidden card
        // names, says what every card is). A table without hands (a TTS
        // import) stays quiet: there's nothing private to give away.
        if ([...decks.values()].some((d) => d.plain && d.resolver) && zones(scene).some((z) => seatsOf(scene)[z.seat])) {
          out.push({ text: PLAIN_HANDS, state: "info" });
        }
        return out;
      },
      commands: [
        {
          id: "shuffle",
          name: "Shuffle pile",
          key: "s",
          // on the use prompt, so hovering a pile says it can be shuffled
          show: ["use", "menu", "inspector"],
          // (not in first person: S walks back there, and playing is done from your seat)
          state: (id, ctx) => (id && hiddenBy(scene?.objects?.[id]) && !(ctx?.local ?? api.local?.get?.())?.immersive ? { title: "Shuffle the pile this card is in (S)" } : null),
          run: shuffleStack,
        },
        {
          id: "draw",
          name: "Draw to my hand",
          key: "d",
          show: ["use", "menu"],
          state(id, ctx) {
            // (not in first person: D walks right there, and you draw from your seat)
            if ((ctx?.local ?? api.local?.get?.())?.immersive) return null;
            const plan = drawPlan(id, ctx?.scene ?? scene, ctx?.local ?? api.local?.get?.());
            if (!plan) return null;
            const { slot, ...shown } = plan;
            return shown;
          },
          run: draw,
        },
        {
          id: "roll",
          name: "Roll",
          // play only (state): R is the gizmo's Rotate while editing
          key: "r",
          show: ["use", "menu"],
          state: (id, ctx) => rollState(id, ctx?.scene ?? scene, ctx?.local ?? api.local?.get?.()),
          run: roll,
        },
        {
          // a seat as a station (seat-verbs.js): "Sit as Player 1" in first
          // person, "Stand up" from your seat; the use prompt's alone (it needs
          // the eye), so F elsewhere stays the hand's Flip
          id: "seat",
          name: "Sit down",
          key: "f",
          show: ["use"],
          state: seatVerbState,
          run: seatVerbRun,
        },
      ],
      // a hidden card carried into your own zone turns face up for you
      // (the point is where it's seen: against the trays as drawn, which aboard a moving ship is
      // not where the doc last saved them; who may see it is still the doc's, visibility.js)
      landing(id, world) {
        if (!scene || !hiddenBy(scene.objects[id])) return null;
        const mine = seatOf(seatsOf(scene), viewer);
        if (!mine) return null;
        regions ??= zones(scene);
        const drawn = {
          toLocal: (zid, p) => {
            const m = api.worldOf?.(zid);
            return m ? apply(invert(m), p) : scene.toLocal(zid, p);
          },
        };
        return seatAt(drawn, regions, world) === mine ? { faceUp: true } : null;
      },
      dispose() {
        dead = true;
        tagLoop?.();
        tagLoop = null;
        stopRiding();
        // (the stage puts back any card still on its way: its holds are released as it stops)
        for (const d of drawing.values()) d.stop?.();
        drawing.clear();
        for (const stop of rolling.values()) stop?.();
        rolling.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        for (const deck of decks.values()) deck.resolver?.dispose?.();
        decks.clear();
      },
    };
  },

  /**
   * A deck dropped on the table: its cards, face down in a stack where it was
   * dropped, in a group named for it, squared onto a card slot if it landed
   * on one. Called by whatever adds documents to the scene, before the
   * extension runs (its traits are what start it).
   */
  async drop(ctx, { url, doc, handle, group, at }) {
    const type = doc?.["@patchwork"]?.type ?? null;
    if (type === PLAIN_DECK) return false; // it has no layout of its own
    const provider = await deckProviderFor(ctx.registry, type).catch(() => null);
    if (!provider?.module?.placement) return false;
    const place = provider.module.placement(doc);
    if (!place) {
      ctx.notify?.("That deck is already on a table.", "error");
      return true;
    }
    const b = place.bounds;
    const h = b ? Math.max(1e-4, b.max[1] - b.min[1]) : 0.001;
    const spot = dropSpot(ctx, at);
    if (!spot) {
      // in a seat's private zone, the whole deck would be that seat's to see (and, once it's
      // dealt, every card's key theirs): the table, then
      ctx.notify?.("Drop the deck on the table, not in a hand.", "error");
      return true;
    }
    const { x, y, z, yaw, parent } = spot;
    const gid = ctx.newId("g");
    const ids = Array.from({ length: place.count }, () => ctx.newId("o"));
    ctx.change((d) => {
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      d.objects[gid] = { kind: "group", name: `${place.name} (${place.count})`, group: group ?? null, visible: true, opacity: 1 };
      d.order.push(gid);
      ids.forEach((oid, j) => {
        d.objects[oid] = {
          name: place.look.name,
          sourceUrl: place.look.sourceUrl,
          providerId: "file-glb",
          renderUrl: null,
          parent,
          group: gid,
          visible: true,
          color: null,
          opacity: 1,
          wireframe: false,
          // face down, a card's height apart: turned about its length, a card stands on its top
          // (in the frame it was dropped into: its +Y is that frame's)
          transform: { position: [x, +(y + (j + 1) * h).toFixed(6), z], rotation: [0, yaw, Math.PI], scale: 1 },
          tags: [...CARD_TAGS],
          traits: { [HIDDEN]: { by: url } },
          ...(b ? { hint: { bounds: { min: [...b.min], max: [...b.max] } } } : {}),
        };
        d.order.push(oid);
      });
    });
    provider.module.bind?.(handle, ids);
    ctx.local.swap((l) => ({ ...l, selected: gid }));
    return true;
  },
};

/**
 * Where a dropped deck goes: the point it was dropped on, or, when that's on
 * an object with a card slot within reach, that slot, squared to it. The
 * table's origin when the drop says nowhere. Never in a seat's private zone:
 * a slot there is passed over, and a point there is null (refused).
 *
 * It goes into the frame of what it was dropped on (`parent`): that object,
 * if things are attached to it (a table, a hull), else whatever that object
 * is attached to (a board on a table: beside the board, on the table), else
 * the root. So a deck dropped on a table aboard a ship rides with her, and
 * one dropped at a table on the floor stays at the root as it always did.
 * The point is where it was seen (the drop context's worldOf, as drawn),
 * and the yaw is in that frame.
 * { x, y, z, yaw, parent } | null
 */
export function dropSpot(ctx, at) {
  const p = Array.isArray(at?.point) && at.point.slice(0, 3).every((v) => Number.isFinite(Number(v))) ? at.point.map(Number) : [0, 0, 0];
  const r6 = (v) => +v.toFixed(6) + 0;
  const snap = ctx.scene?.() ?? null;
  const regions = snap?.toLocal ? zones(snap) : [];
  // the hands as drawn, as the point is (aboard a moving ship the doc's are elsewhere)
  const seen = {
    toLocal: (zid, w) => {
      const m = ctx.worldOf?.(zid);
      return m ? apply(invert(m), w) : snap.toLocal(zid, w);
    },
  };
  const inHand = (w) => regions.length > 0 && seatAt(seen, regions, w) != null;
  if (inHand(p)) return null;
  const hit = at?.hitId && snap?.objects?.[at.hitId] ? at.hitId : null;
  const parent = hit ? frameFor(snap, hit) : null;
  const drawn = (id) => ctx.worldOf?.(id) ?? snap.world(id);
  // a world point and yaw in the frame it goes into
  const into = (w, yaw) => {
    if (!parent) return { x: r6(w[0]), y: r6(w[1]), z: r6(w[2]), yaw: r6(yaw), parent: null };
    const m = drawn(parent);
    const l = apply(invert(m), w);
    return { x: r6(l[0]), y: r6(l[1]), z: r6(l[2]), yaw: r6(yaw - yawOfMatrix(m)), parent };
  };
  if (!hit) return into(p, 0);
  // not loaded yet, or a stage without content: the point will do
  const extras = ctx.content?.(hit)?.extras;
  const m = extras ? drawn(hit) : null;
  const slot = m ? nearestSlot(worldSlots(m, extras, CARD_TAGS).filter((s) => !inHand(s.world)), p) : null;
  if (!slot) return into(p, parent ? yawOfMatrix(drawn(parent)) : 0);
  return into([slot.world[0], p[1], slot.world[2]], slot.yaw ?? yawOfMatrix(m));
}

/**
 * Where a seat's name tag goes on its hand, in the hand's frame: on the
 * tray's surface (its zone's floor), at the edge nearest the seat's eye
 * (`eye`, in the same frame; the nearest point of the tray's footprint to
 * it), else the middle of the tray. Pure.
 * @param {{ min: number[], max: number[] }} z  @param {number[] | null} eye
 */
export function seatTagAt(z, eye) {
  const mid = [(z.min[0] + z.max[0]) / 2, z.min[1], (z.min[2] + z.max[2]) / 2];
  if (!eye) return mid;
  const clamp = (v, k) => Math.min(z.max[k], Math.max(z.min[k], v));
  return [clamp(eye[0], 0), z.min[1], clamp(eye[2], 2)];
}

/** The frame a deck dropped on `id` goes into: `id` if anything is attached to it, else its parent (null: the root). */
function frameFor(snap, id) {
  const parents = snap.parents;
  if (!parents?.get) return null;
  for (const p of parents.values()) if (p === id) return id;
  return parents.get(id) ?? null;
}

/** What everyone at a table with hands and a plain deck is told. */
export const PLAIN_HANDS = "This table's deck is a plain one: anyone who opens it can read every card, hands included.";
/** How far apart a peer's "rolled" and the doc change that landed its die may arrive (ms). */
const ROLL_TRUST_MS = 3000;
/** How long a drawn card takes to reach your hand (s). */
const DRAW_SECONDS = 0.35;
/** How high it rises on the way (m). */
const DRAW_LIFT = 0.05;
/** freeSlot's answers that aren't a slot. */
const LOADING = Symbol("loading");
const NO_SLOTS = Symbol("no slots");

/** Do two doc transforms say the same thing? */
function sameTransform(a, b) {
  if (!a || !b) return false;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= 1e-6;
  return [0, 1, 2].every((i) => near(a.position?.[i], b.position?.[i]) && near(a.rotation?.[i], b.rotation?.[i])) && near(a.scale ?? 1, b.scale ?? 1);
}

/** A drawn card's pose part way (t in 0..1, eased): along the line, lifted in the middle, each angle turned the short way. */
function between(from, to, t) {
  const e = t * t * (3 - 2 * t);
  const turn = (a, b) => {
    let d = (b - a) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * e;
  };
  return {
    position: from.position.map((v, i) => v + (to.position[i] - v) * e + (i === 1 ? DRAW_LIFT * Math.sin(Math.PI * e) : 0)),
    rotation: from.rotation.map((v, i) => turn(v, to.rotation[i])),
    scale: from.scale + (to.scale - from.scale) * e,
  };
}

/** A seat's claim kind, on the scene (scene/STAGE.md, "Claims"). */
const SEAT_CLAIM = (sid) => `tabletop.seat:${sid}`;
/** A little longer than the stage's grace for a claim by a session not yet heard from (6 s). */
const LAPSE_MS = 6500;
/** A claim lost this soon after taking it lost a race to sit down; later, the seat was taken while this view went unheard. */
const RACE_MS = 10_000;

/**
 * Where a seat stands for a viewer, from the seat (the doc's) and its live
 * claim (api.claimedBy, null when none is live):
 * - "mine": this view holds it, or the doc seats this viewer and nobody's
 *   claim is live (a reload, before it claims it again);
 * - "mine-elsewhere": this viewer, from another view (a second tab);
 * - "taken": someone else, here now;
 * - "away": the doc seats someone else, and they're not here;
 * - "free".
 */
export function seatState(seat, by, viewer) {
  if (by) {
    if (by.mine) return "mine";
    return by.viewer != null && by.viewer === viewer ? "mine-elsewhere" : "taken";
  }
  const p = seat?.player;
  if (!p) return "free";
  return p === viewer ? "mine" : "away";
}

/** What a peer may tell us, and the shape each must have. Counts and seat ids only, never which card. */
const MESSAGES = {
  shuffled: (d) => typeof d.deck === "string" && d.deck.length < 512 && count(d.n, 10000),
  sat: (d) => typeof d.seat === "string" && d.seat.length > 0 && d.seat.length < 128,
  drew: (d) => count(d.n, 1000),
  rolled: (d) => typeof d.die === "string" && d.die.length > 0 && d.die.length < 128 && count(d.value, MAX_FACE),
};
const count = (n, max) => Number.isInteger(n) && n > 0 && n <= max;

/** The resolver factory for a deck doc's datatype: { create, module } or null. */
async function deckProviderFor(registry, type) {
  if (!type || type === PLAIN_DECK) return { create: plainResolver, module: null };
  const reg = await registry("tabletop:deck");
  const p = reg?.filter?.((x) => Array.isArray(x.supportedDatatypes) && x.supportedDatatypes.includes(type))?.[0];
  if (!p) return null;
  const module = (await reg.load(p.id))?.module ?? null;
  return module?.createResolver ? { create: module.createResolver, module } : null;
}

const SEAT_CSS = `
.scene-stage .tabletop-overlay:where(:not(.about-embed *), .about-embed .scene-tool *) { position: absolute; inset: 0; pointer-events: none; }
.scene-stage .tabletop-seatbar:where(:not(.about-embed *), .about-embed .scene-tool *) {
  position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; align-items: center;
  padding: 4px 6px 4px 10px; border-radius: 999px; pointer-events: auto;
  background: var(--scene-panel-bg, rgb(255 255 255 / 0.9)); color: var(--scene-fg, #222);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); font: 13px system-ui, sans-serif;
}
.scene-stage .tabletop-seatbar[hidden]:where(:not(.about-embed *), .about-embed .scene-tool *) { display: none; }
.scene-stage .tabletop-seat:where(:not(.about-embed *), .about-embed .scene-tool *) { font: inherit; border-radius: 999px; padding: 2px 6px; }
.scene-stage .label.tabletop-seat-tag:where(:not(.about-embed *), .about-embed .scene-tool *) {
  color: #f6f3ea; background: color-mix(in oklch, #0b0d10 62%, transparent);
  padding: 1px 7px; border-radius: 6px; font-size: 12px; text-shadow: 0 1px 1px rgb(0 0 0 / 0.4);
}
.scene-stage .label.tabletop-seat-tag:is([data-state="away"], [data-state="free"]):where(:not(.about-embed *), .about-embed .scene-tool *) { opacity: 0.7; }
`;

export { docUrl, deckProviderFor };
