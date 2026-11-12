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
// What is here: Shuffle (a pile, through its keeper) and Draw (a pile's top
// card into your own hand, face up) as verbs on the use prompt and the menu;
// a card carried into your own hand turning face up; the hand as the tool in
// play; where each seat's hands are, for whoever shows seats (`seatPlaces`);
// and telling the others what happened (shuffled, drew) with api.send, as
// counts only, never which card: `announce` here, `receive` there.
//
// Component physics, not rules: nothing here knows a game, a turn or a
// legal move. (Dice are their own package, dice/.)

import { isCard, seatAt, seatOf, seatsFrom, zones } from "./visibility.js";
import { CARD_TAGS, worldSlots, yawOfMatrix } from "./slots.js";
import { apply, composeMatrix, invert, levelPose, multiply } from "./frame.js";

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
      const cards = (n) => (n === 1 ? "a card" : `${n} cards`);
      switch (type) {
        case "shuffled":
          return `${who} shuffled ${data.of && data.of !== "Deck" ? `“${data.of}”` : "the deck"} (${data.n})`;
        case "drew":
          return `${who} drew ${cards(data.n)}`;
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
      const seats = seatsFrom(api, snap);
      const mine = seatOf(seats, viewer);
      if (!mine) {
        // only where sitting down would give you somewhere to draw to: some hand with a card slot
        const any = freeSlot(snap, regions.filter((z) => seats.some((s) => s.id === z.seat)));
        if (any === LOADING || any === NO_SLOTS) return null;
        return { disabled: true, label: "Sit down to draw", title: "Pick a seat to draw" };
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
        if (drawing.has(x) || !(isCard(o) || (Array.isArray(o?.tags) && o.tags.includes(CARD_TAGS[0])))) continue;
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
          state: (id, ctx) => (id && isCard(scene?.objects?.[id]) && keptBy(api, id) && !(ctx?.local ?? api.local?.get?.())?.immersive ? { title: "Shuffle the pile this card is in (S)" } : null),
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

/** What a peer may tell us, and the shape each must have. Counts and a container's title only, never which card. */
const MESSAGES = {
  shuffled: (d) => count(d.n, 10000) && (d.of === undefined || (typeof d.of === "string" && d.of.length > 0 && d.of.length < 200)),
  drew: (d) => count(d.n, 1000),
};
const count = (n, max) => Number.isInteger(n) && n > 0 && n <= max;
