// The tabletop's scene extension (`scene:extension` "tabletop"): what a
// table's pieces do in play. Hands (private zones) and cards are this
// package's; the rest it meets through the stage (scene/STAGE.md):
//
//   - who sits where: the `roster` convention (whoever owns seats). A hand
//     names a seat by id and never reads the seats themselves;
//   - what a card really is: a keeper's business (any `scene:extension`
//     that offers the `keeper` convention). The table never opens a deck:
//     Shuffle asks the card's keeper to shuffle its pile;
//   - who may see what: this package's policy is the `tabletop.rule`
//     extension (rule.js, visibility.js), merged by the stage with any
//     other's.
//
// What is here: Shuffle (a pile, through its keeper), Draw (a pile's top
// card into your own hand, face up, or into a rack standing on edge), Wash
// (face-down pieces spread out on the table, mixed where they lie, through
// their keeper), Stand on edge / Lay flat (a piece thick enough to stand: a
// domino in your rack, or out on the table, facing you) and Lay my hand face
// up (everything in your hand, and anything standing facing it, out in front
// of it for everyone) as verbs on the use prompt and the menu, in play only
// (Shuffle, as before, in either activity);
// a card carried into your own hand turning face up; the hand as the tool in
// play; where each seat's hands are, for whoever shows seats (`seatPlaces`);
// and telling the others what happened (shuffled, drew) with api.send, as
// counts only, never which card: `announce` here, `receive` there.
//
// Component physics, not rules: nothing here knows a game, a turn or a
// legal move. (Dice are their own package, dice/.)

import { facing, isCard, parentOf, seatAt, seatOf, seatsFrom, zones } from "./visibility.js";
import { CARD_TAGS, worldSlots } from "./slots.js";
import { apply, composeMatrix, invert, levelPose, multiply } from "./frame.js";
import { boxUnder, canStand, isStanding, layPose, spread, standPose, upness } from "./stand.js";
import { cluster, colsFor, jumble } from "./wash.js";

/** The keepers running here (api.collect("keeper")): each { of(id), shuffle(ids), name(key) }. */
const keepers = (api) => (api.collect?.("keeper") ?? []).map((r) => r?.value).filter((k) => k && typeof k.of === "function");

/** Which keeper keeps `id`, and under which key (its container): { keeper, key } | null. */
export function keptBy(api, id) {
  for (const keeper of keepers(api)) {
    let key = null;
    try {
      key = keeper.of(id);
    } catch {
      // a keeper that can't say doesn't keep it
    }
    if (key != null) return { keeper, key };
  }
  return null;
}

export default {
  create(api) {
    const { viewer } = api;
    let scene = null;
    let regions = null;

    /**
     * The pile a card is in: the cards whose footprints overlap its own by
     * half or more (in plan), and that are the same kind of thing to shuffle
     * with it: kept in the same container, or, for a card nothing keeps,
     * the other cards nothing keeps.
     */
    function stackOf(id) {
      const objects = scene?.objects ?? {};
      if (!isCard(objects[id])) return [];
      const key = keptBy(api, id)?.key ?? null;
      const same = Object.keys(objects).filter((x) => isCard(objects[x]) && (x === id || (keptBy(api, x)?.key ?? null) === key));
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
      const kept = isCard(scene?.objects?.[id]) ? keptBy(api, id) : null;
      if (typeof kept?.keeper?.shuffle !== "function") return api.notify(kept ? "This pile can't be shuffled." : "Only cards something keeps can be shuffled: these are what they look like.", "error");
      const n = kept.keeper.shuffle(stackOf(id));
      if (!n) return api.notify("There's nothing here to shuffle with it.", "error");
      announce("shuffled", { n, ...(titleOf(kept) ? { of: titleOf(kept) } : {}) }, `Shuffling ${n} card${n === 1 ? "" : "s"}…`);
    }
    /** A kept card's container's name, for a notice (public: the container's title). */
    function titleOf(kept) {
      try {
        const t = kept?.keeper?.name?.(kept.key);
        return typeof t === "string" && t && t.length < 200 ? t : null;
      } catch {
        return null;
      }
    }

    // ── telling the others: what happened, never which card ──
    /** Who a peer is at this table, from whoever knows (the roster's `who`), else "Someone". */
    const nameOf = (from) => {
      for (const r of api.collect?.("roster") ?? []) {
        if (typeof r?.value?.who !== "function") continue;
        try {
          const n = r.value.who(from?.viewer);
          if (typeof n === "string" && n) return n;
        } catch {
          // nobody to ask
        }
      }
      return "Someone";
    };
    /** What a message says, from `who`; null if it's malformed or not one of ours. */
    function told(type, data, who) {
      if (!data || typeof data !== "object" || !Object.hasOwn(MESSAGES, type) || !MESSAGES[type](data)) return null;
      switch (type) {
        case "shuffled":
          return `${who} shuffled ${data.of && data.of !== "Deck" ? `“${data.of}”` : "the deck"} (${data.n})`;
        case "drew":
          return `${who} drew ${counted(data.n, data.noun)}`;
        case "washed":
          return `${who} washed ${data.of ? `“${data.of}”` : `the ${plural(data.noun ?? "card")}`} (${data.n})`;
        case "showed":
          return `${who} laid ${counted(data.n, data.noun)} face up`;
      }
      return null;
    }
    /** Say it here (sends are never echoed back), then to every other peer. */
    function announce(type, data, local) {
      const text = local ?? told(type, data, "You");
      if (text) api.notify(text);
      api.send?.(type, data);
    }

    // ── drawing: a pile's top card, into your own hand ──
    // D over a pile that's out on the table: its top card glides into the
    // first free card slot of your seat's tray, face up (only you see what
    // it is there: the hand's rule, visibility.js), and lands in one write. On
    // its way it's a pose hold, so everyone sees it travel, and so of two
    // people drawing the same card at once one is told (heldBy) and takes the
    // next card instead.
    const drawing = new Map(); // card id → { slot, stop }: on its way to a slot, which is taken already

    /**
     * Whether `id` can be drawn from now, and into where: null when Draw
     * doesn't apply (not playing, not a card, one in a hand already,
     * a seat with no tray); { disabled, label?, title } when it can't now;
     * else { slot } (world, yaw).
     */
    function drawPlan(id, snap = scene, local = api.local?.get?.()) {
      if (id == null || !snap || local?.activities?.current !== "play") return null;
      if (!isCard(snap.objects?.[id])) return null;
      const regions = zones(snap);
      const m = snap.world(id);
      if (seatAt(snap, regions, [m[12], m[13], m[14]])) return null; // in a hand already
      const tags = tagsOf(snap.objects[id]);
      const seats = seatsFrom(api, snap);
      const mine = seatOf(seats, viewer);
      if (!mine) {
        // only where sitting down would give you somewhere to draw to: some hand with a card slot
        const any = freeSlot(snap, regions.filter((z) => seats.some((s) => s.id === z.seat)), tags);
        if (any === LOADING || any === NO_SLOTS) return null;
        return { disabled: true, label: "Sit down to draw", title: "Pick a seat to draw" };
      }
      const trays = regions.filter((z) => z.seat === mine);
      if (!trays.length) return null;
      const slot = freeSlot(snap, trays, tags);
      if (slot === LOADING) return { disabled: true, title: "Your hand is still loading" };
      if (slot === NO_SLOTS) return null; // a hand without card slots: carry cards there instead
      if (!slot) return { disabled: true, label: "Your hand is full", title: "Every card slot in your hand has a card" };
      const what = nounOf(snap, id).noun ?? "card";
      return { slot, title: stackOf(id).length > 1 ? `Draw the top ${what} into your hand (D)` : `Draw this ${what} into your hand (D)` };
    }

    /**
     * The first slot of these trays for something with `tags` (a card slot:
     * a connector with one of them) with nothing on it (no card, nor
     * anything with those tags, within half the slot's reach, in plan, nor
     * one on its way there); null if all have one, LOADING before a tray's
     * content has loaded, NO_SLOTS if no tray has such a slot at all.
     */
    function freeSlot(snap, trays, tags = CARD_TAGS) {
      const taken = [];
      for (const [x, o] of Object.entries(snap.objects ?? {})) {
        if (drawing.has(x) || !(isCard(o) || (Array.isArray(o?.tags) && o.tags.some((t) => tags.includes(t))))) continue;
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
        for (const s of worldSlots(zm, c.extras, tags)) {
          any = true;
          if (taken.every((p) => Math.hypot(p[0] - s.world[0], p[1] - s.world[2]) > s.radius / 2)) return { world: s.world, zone: z.id, local: s.local };
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
     * Where a card goes to lie in a slot, as its doc transform: in the slot's
     * frame (face up, turned the slot's way; a rack's place: standing on
     * edge, facing its player), the middle of its footprint on the slot and
     * its underside resting there. Worked out on the tray as the doc has it,
     * and put in the frame of whatever the card is attached to (a table
     * aboard a ship), so it's the same on every peer whatever the ship is
     * doing.
     */
    function slotPose(snap, id, slot, scale) {
      const r6 = (v) => +v.toFixed(6) + 0;
      const r9 = (v) => +v.toFixed(9) + 0; // a turn to a nanoradian: a quarter turn is a quarter turn
      const rotation = slot.local.rotation ?? [0, slot.local.yaw ?? 0, 0];
      const box = bodyBox(snap, id);
      const b = box ? boxUnder(composeMatrix({ rotation }), box) : null;
      const off = b ? [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2] : [0, 0, 0];
      const inTray = multiply(snap.world(slot.zone), composeMatrix({ position: slot.local.position.map((v, k) => v + off[k]), rotation }));
      const parent = snap.parents?.get?.(id) ?? null;
      const t = levelPose(parent ? multiply(invert(snap.world(parent)), inTray) : inTray);
      return { position: t.position.map(r6), rotation: t.rotation.map(r9), scale };
    }

    function draw(id) {
      const plan = drawPlan(id, api.scene());
      if (!plan) return;
      if (plan.disabled) return api.notify(plan.label ?? plan.title);
      const pile = drawable(id);
      // (none left but the one already on its way to your hand: D twice)
      if (!pile.length) return drawing.has(id) ? undefined : api.notify("Someone drew that one");
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
        announce("drew", { n: 1, ...nounOf(api.scene(), id) });
      });
      api.pose.hold(id, from);
    }


    // ── what a piece is shaped like, and writing where it lies ──
    /** Its body box, in its own frame: its load hint (the scene draws it to that), else what has loaded; null if neither. */
    function bodyBox(snap, id) {
      const b = snap?.objects?.[id]?.hint?.bounds;
      if (Array.isArray(b?.min) && Array.isArray(b?.max) && b.min.length === 3 && b.max.length === 3) return { min: b.min.map(Number), max: b.max.map(Number) };
      return null;
    }
    /** Its pose in the frame of what it's attached to (its doc transform), as a matrix. */
    const localOf = (snap, id) => composeMatrix(snap.objects[id].transform ?? {});
    /** The world matrix of the frame it lies in (what it's attached to; identity at the root). */
    const frameOf = (snap, id) => {
      const p = parentOf(snap, id);
      return p ? snap.world(p) : composeMatrix({});
    };
    /** A pose matrix (its parent's frame) as a doc transform, tidy, keeping the piece's own scale. */
    const transformOf = (m, scale) => {
      const t = levelPose(m);
      const r6 = (v) => +v.toFixed(6) + 0;
      const r9 = (v) => +v.toFixed(9) + 0; // a turn to a nanoradian: a quarter turn is a quarter turn
      return { position: t.position.map(r6), rotation: t.rotation.map(r9), scale };
    };
    /** Is a world point in this hand? */
    const inHand = (snap, z, w) => {
      const p = snap.toLocal(z.id, [w[12], w[13], w[14]]);
      return !!p && p.every((v, k) => v >= z.min[k] && v <= z.max[k]);
    };
    /** Your own hands (this viewer's seat's), or [] when you aren't seated. */
    function myHands(snap) {
      const mine = seatOf(seatsFrom(api, snap), viewer);
      return mine ? zones(snap).filter((z) => z.seat === mine) : [];
    }

    // ── washing: face-down pieces spread on the table, mixed where they lie ──
    /**
     * What Wash would sweep together from `id`: it and every face-down piece
     * of its container lying out on the table (in nobody's hand, attached to
     * the same thing, not stacked, not held by a peer) within one and a half
     * of its own length of the next (wash.js cluster). null when Wash doesn't
     * apply: not playing (Edit), not kept, not face down, in a hand, part of
     * a pile (shuffle that), or alone. Anyone playing may wash, seated or
     * not, as anyone at a table may reach in and stir the tiles (or carry
     * and flip them: the hand asks no seat either).
     */
    function washPlan(id, snap = scene, local = api.local?.get?.()) {
      const o = snap?.objects?.[id];
      if (!playing(local) || !isCard(o)) return null;
      const kept = keptBy(api, id);
      if (typeof kept?.keeper?.shuffle !== "function") return null;
      const regions = zones(snap);
      const parent = parentOf(snap, id);
      const loose = (x) => {
        const w = snap.world(x);
        return upness(localOf(snap, x)) < -Math.SQRT1_2 && !seatAt(snap, regions, [w[12], w[13], w[14]]) && api.heldBy?.(x) == null && !drawing.has(x);
      };
      if (!loose(id) || stackOf(id).length > 1) return null;
      const boxes = {};
      for (const [x, ox] of Object.entries(snap.objects)) {
        if (x !== id && !(isCard(ox) && parentOf(snap, x) === parent && (keptBy(api, x)?.key ?? null) === kept.key && loose(x))) continue;
        const b = api.box?.(x);
        if (b) boxes[x] = b;
      }
      const own = boxes[id];
      if (!own) return null;
      const link = 1.5 * Math.max(own.max[0] - own.min[0], own.max[2] - own.min[2]);
      const ids = cluster(boxes, id, link);
      return ids.length > 1 ? { ids, kept } : null;
    }

    function wash(id) {
      const snap = api.scene();
      const plan = washPlan(id, snap);
      if (!plan) return api.notify("There's nothing here to wash: face-down pieces spread out on the table are.", "error");
      const n = plan.kept.keeper.shuffle(plan.ids);
      if (!n) return api.notify("These can't be washed.", "error");
      // and swept about: laid out again where they were, jumbled, each at a turn of its own
      const at = plan.ids.map((x) => snap.objects[x].transform?.position ?? [0, 0, 0]).map((p) => p.map(Number));
      const lo = [0, 1, 2].map((k) => Math.min(...at.map((p) => p[k])));
      const hi = [0, 1, 2].map((k) => Math.max(...at.map((p) => p[k])));
      const b = bodyBox(snap, id);
      const reach = b ? Math.hypot(Math.max(-b.min[0], b.max[0]), Math.max(-b.min[2], b.max[2])) : 0.03;
      const spots = jumble(plan.ids.length, { centre: [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2], cols: colsFor(plan.ids.length), cell: 2 * reach + 0.004, reach });
      const cells = shuffled(plan.ids);
      const writes = cells
        .map((x, i) => {
          const t = snap.objects[x].transform ?? {};
          return api.ops.setTransform(snap, x, { position: [spots[i].x, lo[1], spots[i].z], rotation: [0, spots[i].yaw, Math.PI], scale: Number(t.scale) || 1 });
        })
        .filter(Boolean);
      if (writes.length) api.change((d) => writes.forEach((w) => w(d)));
      announce("washed", { n, ...nounOf(snap, id), ...(titleOf(plan.kept) ? { of: titleOf(plan.kept) } : {}) }, `Washing ${counted(n, nounOf(snap, id).noun)}…`);
    }

    // ── standing a piece on edge, and laying it flat ──
    /**
     * Stand on edge applies, in play, to a piece thick enough to stand
     * (stand.js canStand: a domino, never a card) lying flat in your own hand
     * or out on the table, when you're seated: it stands facing you. In your
     * hand that is the hand's +Z (toward its seat); out on the table, the
     * way to the middle of your nearest hand, so the table's policy
     * (visibility.js facing) turns it to you and screens it from the rest,
     * as a domino stood up in front of you with no rack. Never in someone
     * else's hand. Lay flat applies to one standing anywhere (knocked over
     * or not: anyone can knock a tile over; one in someone's hand stays in
     * it, and stays theirs). null otherwise, or while a peer holds it.
     */
    function standPlan(id, snap = scene, local = api.local?.get?.()) {
      const o = snap?.objects?.[id];
      if (!playing(local) || !isCard(o) || o.locked || !canStand(bodyBox(snap, id)) || api.heldBy?.(id) != null || drawing.has(id)) return null;
      if (isStanding(localOf(snap, id))) return { lay: true };
      const w = snap.world(id);
      const hands = myHands(snap);
      const hand = hands.find((z) => inHand(snap, z, w));
      if (hand) return { lay: false, hand: hand.id };
      if (!hands.length || seatAt(snap, zones(snap), [w[12], w[13], w[14]])) return null;
      // out on the table: toward the nearest of your hands
      const centre = (z) => apply(snap.world(z.id), [0, 1, 2].map((k) => (z.min[k] + z.max[k]) / 2));
      const away = (z) => {
        const c = centre(z);
        return Math.hypot(c[0] - w[12], c[2] - w[14]);
      };
      const near = [...hands].sort((a, b) => away(a) - away(b) || (a.id < b.id ? -1 : 1))[0];
      return { lay: false, toward: centre(near) };
    }

    function stand(id) {
      const snap = api.scene();
      const plan = standPlan(id, snap);
      if (!plan) return;
      const m = localOf(snap, id);
      const box = bodyBox(snap, id);
      let to = null;
      if (plan.lay) to = layPose(m, box);
      else if (plan.hand) {
        // the hand's +Z (toward its player), in the frame the piece lies in
        const hw = snap.world(plan.hand);
        const f = invert(frameOf(snap, id));
        const toward = [0, 1, 2].map((r) => f[r] * hw[8] + f[4 + r] * hw[9] + f[8 + r] * hw[10]);
        to = standPose(m, box, toward);
      } else {
        // toward your hand from the middle of its footprint, in the frame the piece lies in
        const f = invert(frameOf(snap, id));
        const b = box ? boxUnder(snap.world(id), box) : null;
        const w = snap.world(id);
        const mid = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [w[12], w[13], w[14]];
        const d = [0, 1, 2].map((k) => plan.toward[k] - mid[k]);
        const toward = [0, 1, 2].map((r) => f[r] * d[0] + f[4 + r] * d[1] + f[8 + r] * d[2]);
        to = standPose(m, box, toward);
      }
      if (!to) return;
      const w = api.ops.setTransform(snap, id, transformOf(to, Number(snap.objects[id].transform?.scale) || 1));
      if (w) api.change(w);
    }

    // ── laying your hand face up, for everyone ──
    /**
     * What Lay my hand face up would lay out, in play: the hand (one of
     * yours: the target, the one the target lies in, or the one it stands
     * facing out on the table) and the pieces that are that hand's: in it,
     * or standing out on the table facing it (visibility.js facing), in the
     * order they lie across it.
     */
    function revealPlan(id, snap = scene, local = api.local?.get?.()) {
      if (!playing(local) || id == null || !snap?.objects?.[id]) return null;
      const hands = myHands(snap);
      const all = zones(snap);
      const out = (x) => {
        const w = snap.world(x);
        return seatAt(snap, all, [w[12], w[13], w[14]]) ? null : facing(snap, all, x)?.id ?? null;
      };
      const hand = hands.find((z) => z.id === id) ?? (isCard(snap.objects[id]) ? hands.find((z) => inHand(snap, z, snap.world(id)) || out(id) === z.id) : null);
      if (!hand) return null;
      const across = (x) => snap.toLocal(hand.id, snap.world(x).slice(12, 15))[0];
      const ids = Object.keys(snap.objects)
        .filter((x) => isCard(snap.objects[x]) && !snap.objects[x].locked && api.heldBy?.(x) == null && !drawing.has(x) && (inHand(snap, hand, snap.world(x)) || out(x) === hand.id))
        .sort((p, q) => across(p) - across(q));
      return ids.length ? { hand, ids } : null;
    }

    function reveal(id) {
      const snap = api.scene();
      const plan = revealPlan(id, snap);
      if (!plan) return;
      const { hand, ids } = plan;
      const hw = snap.world(hand.id);
      const boxes = ids.map((x) => bodyBox(snap, x) ?? { min: [-0.01, 0, -0.01], max: [0.01, 0.001, 0.01] });
      // out past the hand's far edge (its −Z: toward the table), face up, each its length pointing out
      const spots = spread(boxes, { edge: hand.min[2], width: hand.max[0] - hand.min[0] });
      const moving = new Set(ids);
      const writes = ids
        .map((x, i) => {
          const b = boxes[i];
          const at = [spots[i].x - (b.min[0] + b.max[0]) / 2, -b.min[1], spots[i].z - (b.min[2] + b.max[2]) / 2];
          const W = multiply(hw, composeMatrix({ position: at }));
          // onto whatever is there (the felt), by a ray straight down: else level with the hand's foot
          const top = W[13] + 0.3;
          const hit = api.raycast?.([W[12], top, W[14]], [0, -1, 0], { skip: (y) => moving.has(y) });
          const low = boxUnder(W, b).min[1];
          if (Number.isFinite(hit?.point?.[1])) W[13] += hit.point[1] - low;
          const local = multiply(invert(frameOf(snap, x)), W);
          return api.ops.setTransform(snap, x, transformOf(local, Number(snap.objects[x].transform?.scale) || 1));
        })
        .filter(Boolean);
      if (writes.length) api.change((d) => writes.forEach((w) => w(d)));
      announce("showed", { n: ids.length, ...nounOf(snap, ids[0]) }, `You laid ${counted(ids.length, nounOf(snap, ids[0]).noun)} face up`);
    }

    return {
      update(snapshot, local, prev) {
        // Playing at a table is done with the hand. A tool picked while editing
        // (G, R, the toolbar) is this view's local state and outlives the switch
        // back to play, and a scene that became a table by a part (Lost Cities
        // set down in it) suggests no tool, so the stage's default is Move: in play
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
        if (snapshot === prev?.scene) return;
        scene = snapshot;
        regions = null;
      },
      // where each seat's hands are, for whoever shows seats (a name tag on each; a look at one is a look at its seat)
      seatPlaces: (snap) => zones(snap),
      receive(type, data, from) {
        const text = told(type, data, nameOf(from));
        if (text) api.notify(text);
      },
      commands: [
        {
          id: "shuffle",
          name: "Shuffle pile",
          key: "s",
          // on the use prompt, so hovering a pile says it can be shuffled
          show: ["use", "menu", "inspector"],
          // (not in first person: S walks back there, and playing is done from your seat)
          // (only where there's a pile: a card lying alone has nothing to shuffle with)
          state: (id, ctx) => (id && isCard(scene?.objects?.[id]) && keptBy(api, id) && !(ctx?.local ?? api.local?.get?.())?.immersive && stackOf(id).length > 1 ? { title: "Shuffle the pile this card is in (S)" } : null),
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
          id: "wash",
          name: "Wash",
          key: "w",
          show: ["use", "menu", "inspector"],
          state(id, ctx) {
            // (not in first person: W walks there)
            if (id == null || (ctx?.local ?? api.local?.get?.())?.immersive) return null;
            const plan = washPlan(id, ctx?.scene ?? scene, ctx?.local ?? api.local?.get?.());
            return plan ? { label: `Wash (${plan.ids.length})`, title: "Mix the face-down pieces spread out here, where they lie (W)" } : null;
          },
          run: wash,
        },
        {
          id: "stand",
          name: "Stand on edge",
          key: "u",
          show: ["use", "menu", "inspector"],
          state(id, ctx) {
            if (id == null || (ctx?.local ?? api.local?.get?.())?.immersive) return null;
            const plan = standPlan(id, ctx?.scene ?? scene, ctx?.local ?? api.local?.get?.());
            if (!plan) return null;
            return plan.lay ? { label: "Lay flat", title: "Lay it down flat, face up (U)" } : { title: "Stand it on edge, facing you (U)" };
          },
          run: stand,
        },
        {
          id: "reveal",
          name: "Lay my hand face up",
          // no key: a slip of the finger shouldn't show your hand
          show: ["menu", "inspector"],
          state(id, ctx) {
            const plan = revealPlan(id, ctx?.scene ?? scene, ctx?.local ?? api.local?.get?.());
            return plan ? { label: `Lay my hand face up (${plan.ids.length})`, title: "Put everything in your hand out in front of it, face up, for everyone to see" } : null;
          },
          run: reveal,
        },
      ],
      // a card carried into your own hand turns face up for you
      // (the point is where it's seen: against the trays as drawn, which aboard a moving ship is
      // not where the doc last saved them; who may see it is still the doc's, visibility.js)
      landing(id, world) {
        if (!scene || !isCard(scene.objects[id])) return null;
        const mine = seatOf(seatsFrom(api, scene), viewer);
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
        // (the stage puts back any card still on its way: its holds are released as it stops)
        for (const d of drawing.values()) d.stop?.();
        drawing.clear();
      },
    };
  },
};

/** Is this view playing (not editing)? The verbs of play are play's, as the hand is. */
const playing = (local) => local?.activities?.current === "play";
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

/** The tags a piece fits (its back's: one for every card, "card"; every tile, "domino"), else a card's. */
const tagsOf = (o) => (Array.isArray(o?.tags) && o.tags.length ? o.tags : CARD_TAGS);

/** What a peer may tell us, and the shape each must have. Counts and a container's title only, never which card. */
const MESSAGES = {
  shuffled: (d) => count(d.n, 10000) && title(d.of),
  drew: (d) => count(d.n, 1000) && noun(d.noun),
  washed: (d) => count(d.n, 10000) && title(d.of) && noun(d.noun),
  showed: (d) => count(d.n, 1000) && noun(d.noun),
};
const title = (t) => t === undefined || (typeof t === "string" && t.length > 0 && t.length < 200);
const noun = (t) => t === undefined || (typeof t === "string" && NOUN.test(t));
/** What a piece is called in a message: a word or two of letters, from the name everyone sees (its back's: "Card", "Domino"). */
const NOUN = /^[a-z][a-z ]{0,22}[a-z]$/;
/** { noun } for a piece whose public name isn't "card"; {} for a card (what a message says by default). */
export function nounOf(scene, id) {
  const name = String(scene?.objects?.[id]?.name ?? "").trim().toLowerCase();
  return NOUN.test(name) && name !== "card" ? { noun: name } : {};
}
/** A noun's plural: dominoes, cards. */
const plural = (n) => (/o$/.test(n) ? `${n}es` : `${n}s`);
/** "a card", "3 dominoes". */
export const counted = (n, what = "card") => (n === 1 ? `${/^[aeiou]/.test(what) ? "an" : "a"} ${what}` : `${n} ${plural(what)}`);
/** Fisher–Yates with Math.random: which piece goes to which spot after a wash (public; nothing to do with what any of them is). */
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const count = (n, max) => Number.isInteger(n) && n > 0 && n <= max;
