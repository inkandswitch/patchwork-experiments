// The dice's scene extension (`scene:extension` "dice"): what a die can do in
// a scene. It runs while any object carries the trait `dice.die`, and is
// built only from the scene's extension contract (scene/STAGE.md).
//
// A die here is a thing, not a rule. It can be:
// - ROLLED (R, in play): tossed, tumbled and landed on a face drawn at random.
//   The whole roll is worked out from one seed first (roll.js rollPlan), played
//   as a pose hold so everyone sees it in the air, and written once, where it
//   landed. Everyone is told what it shows.
// - READ: the face that is up, at any orientation (roll.js faceUp), shown on
//   the Turn verb ("Turn (shows 4)") and in the inspector's picker.
// - TURNED to a face by hand (T: the next face; the menu and the inspector:
//   any face). A different act from a roll, written at once and told
//   differently ("turned … to 64"). A die marked turn-only (a doubling cube)
//   offers this and never Roll.
// - THROWN WITH OTHERS (G on one of several dice filed in one group, or Roll
//   on the group): all of them tumble together from one seed, land in one
//   write, and are told in one line listing each ("rolled 70, 3").
// - MOVED: by the scene's hand, which this requires. Nothing here adds faces
//   up, compares them or knows what a roll is for.
//
// What a die IS comes only from what the scene built for it: its GLB's
// `extras.dice` (die-glb.js builtDie), read through api.content. The trait
// holds nothing, and this file knows no shape. A die whose GLB hasn't arrived
// can't be rolled or read yet; and anything whose GLB says it's a die (in
// those terms) is one, whoever built it. The trait on something whose GLB
// says nothing of the kind does nothing.
//
// A die lies on its parent: it is rolled, turned and read in its parent's
// frame, against its parent's +Y (roll.js), so on a table aboard a ship it
// stays on the table and is read against the table.
//
// A peer's word is checked against the doc. A peer says which die and which
// face; that is told here only when the doc moved that die, just before or
// soon after (the message and the doc change travel apart), to a pose
// showing that face as built here, once per move. So a die set down by hand
// and "announced" as a roll later is not told, nor a face it doesn't show.
//
// A selected die also offers its own panel (tool.js) docked beside the scene,
// "Edit die": the stage's right edge, marked as an embedded document so its
// keys are its own (STAGE.md, "Keys"). The stage has no general way to dock
// a document's own tool, so this follows camber.shape's dock.

import { cupsOf } from "./cup.js";
import { DIE, PROVIDER } from "./ids.js";
import { ROLL_SECONDS, ROLL_SKID, builtOf, drawSeed, faceUp, rollPlan, scaleOf, seedFor, turnTo } from "./roll.js";

/** How far apart a peer's word and the doc change that bears it out may arrive (ms). */
export const TRUST_MS = 3000;
/** The most dice one message may name. */
export const MAX_THROWN = 64;

const str = (s) => typeof s === "string" && s.length > 0 && s.length < 128;
const item = (d) => !!d && typeof d === "object" && str(d.die) && Number.isInteger(d.face) && d.face >= 0 && d.face < 100;
/** What a peer may tell us, and the shape each must have: which die, which face. Never a label: each view reads its own. */
export const MESSAGES = {
  rolled: (d) => Array.isArray(d.dice) && d.dice.length > 0 && d.dice.length <= MAX_THROWN && d.dice.every(item),
  turned: (d) => item(d),
};

/** Do two doc transforms say the same thing? */
function sameTransform(a, b) {
  if (!a || !b) return false;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= 1e-6;
  return [0, 1, 2].every((i) => near(a.position?.[i], b.position?.[i]) && near(a.rotation?.[i], b.rotation?.[i])) && near(a.scale ?? 1, b.scale ?? 1);
}
const copyOf = (t) => (t ? JSON.parse(JSON.stringify(t)) : null);
const fromOf = (o) => {
  const t = o?.transform ?? {};
  return { position: [0, 1, 2].map((i) => Number(t.position?.[i]) || 0), rotation: [0, 1, 2].map((i) => Number(t.rotation?.[i]) || 0), scale: Number(t.scale) || 1 };
};

function create(api) {
  api.style?.(CSS);
  let scene = null;
  let dead = false;
  const isDie = (o) => !!o && o.kind !== "group" && !!o.traits && Object.hasOwn(o.traits, DIE);
  /** A die as the scene built it, or null while its GLB hasn't arrived (or isn't a die's). */
  const builtFor = (id) => builtOf(api.content?.(id)?.extras?.dice);
  /** Has this object's content arrived and turned out not to be a die's (the trait put on something else)? Then no verb applies to it. */
  const notADie = (id) => api.content?.(id)?.loaded === true && !builtFor(id);
  const inPlay = (local) => (local ?? api.local?.get?.())?.activities?.current === "play";
  /** Dice a cup keeps (under one, or shaken and not yet turned up): what they show isn't the doc's to say, so nobody rolls, turns or reads them. */
  const keptBy = new WeakMap();
  const kept = (id, snap) => {
    if (!snap?.objects) return false;
    let c = keptBy.get(snap);
    if (!c) keptBy.set(snap, (c = cupsOf(snap, (p) => (p && snap.world ? scaleOf(snap.world(p)) : 1)).cupOfDie));
    return c.has(id);
  };

  /** What a die shows in the doc: { face, label }, or null when it can't be read yet. */
  function shows(id, snap = api.scene()) {
    const o = snap?.objects?.[id];
    const built = isDie(o) && !kept(id, snap) ? builtFor(id) : null;
    if (!built) return null;
    const face = faceUp(o.transform?.rotation ?? [0, 0, 0], built);
    return { face, label: built.faces[face].label };
  }

  /** The dice a target names: itself, or every die filed in it (a group), in the doc's order. */
  function diceOf(target, snap) {
    const o = snap?.objects?.[target];
    if (!o) return [];
    if (o.kind !== "group") return isDie(o) ? [target] : [];
    return (snap.members?.get?.(target) ?? []).filter((id) => isDie(snap.objects[id]));
  }
  /** The dice filed with a die in its group (itself among them), or [] when it's in none. */
  function handful(id, snap) {
    const g = snap?.objects?.[id]?.group;
    return g && snap.objects[g]?.kind === "group" ? diceOf(g, snap) : [];
  }

  // ── telling the others ──
  const names = new Map(); // viewer → their contact's name; null while asking, or if it has none
  /** A viewer's contact name, if known yet (asked once). */
  function contactName(who) {
    if (typeof who !== "string" || !who) return null;
    if (names.has(who)) return names.get(who);
    names.set(who, null);
    if (who.startsWith("automerge:")) {
      Promise.resolve(api.repo?.find?.(who))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (!dead && typeof n === "string" && n.trim()) names.set(who, n.trim());
        })
        .catch(() => {});
    }
    return null;
  }
  const nameOf = (from) => contactName(from?.viewer) || "Someone";
  /** Ask for the names of everyone here, so a roll is told by name the first time. */
  function meetPeers() {
    for (const p of Object.values(api.presence?.get?.() ?? {})) contactName(p?.viewer);
  }

  /** What a message says, from `who`, by this view's own reading of the faces; null if it can't be said. */
  function told(type, data, who) {
    if (type === "rolled") {
      const labels = data.dice.map((d) => builtFor(d.die)?.faces?.[d.face]?.label);
      return labels.every((l) => typeof l === "string") ? `${who} rolled ${labels.join(", ")}` : null;
    }
    if (type === "turned") {
      const label = builtFor(data.die)?.faces?.[data.face]?.label;
      const name = scene?.objects?.[data.die]?.name || "a die";
      return typeof label === "string" ? `${who} turned ${name} to ${label}` : null;
    }
    return null;
  }
  /** Say it here (sends are never echoed back), then to every other peer. */
  function announce(type, data) {
    const text = told(type, data, "You");
    if (text) api.notify(text);
    api.send?.(type, data);
  }

  // ── rolling: one die or several, tossed and tumbled, landing as their seed says ──
  const rolling = new Map(); // die id → the throw it's in
  const throws = new Set(); // { dice: Map id → { plan, from }, stop }

  /** Why a die can't be rolled just now, or null. (Whether Roll applies to it at all is rollable().) */
  function busy(id) {
    if (!builtFor(id)) return "That die is still being made";
    if (rolling.has(id)) return "It's rolling";
    if (api.heldBy?.(id) != null) return "Someone has that die";
    return null;
  }
  /** Is this a die Roll applies to: not locked, and not one that's only ever turned by hand. */
  const rollable = (id, snap) => isDie(snap.objects[id]) && !snap.objects[id].locked && !notADie(id) && !kept(id, snap) && builtFor(id)?.turnOnly !== true;

  /** Roll's state for a target: a die, or a group of them. */
  function rollState(target, snap = scene, local) {
    if (target == null || !snap || !inPlay(local)) return null;
    const ids = diceOf(target, snap).filter((id) => rollable(id, snap));
    if (!ids.length) return null;
    const several = snap.objects[target].kind === "group";
    const why = ids.map(busy).find(Boolean);
    return { ...(several ? { label: `Roll ${ids.length} dice` } : {}), ...(why ? { disabled: true, title: why } : { title: several ? "Roll every die in this group together (R)" : "Roll the die (R)" }) };
  }
  /** Roll all's state: on a die filed in a group with other dice. */
  function rollAllState(id, snap = scene, local) {
    if (id == null || !snap || !inPlay(local) || !isDie(snap.objects[id])) return null;
    const ids = handful(id, snap).filter((x) => rollable(x, snap));
    if (ids.length < 2 || !ids.includes(id)) return null;
    const why = ids.map(busy).find(Boolean);
    return { label: `Roll all ${ids.length}`, ...(why ? { disabled: true, title: why } : { title: "Roll every die in this one's group together (G)" }) };
  }

  /** Toss these dice together: one seed, one tumble, one write, one line. */
  function throwDice(ids) {
    const snap = api.scene();
    const why = ids.map(busy).find(Boolean);
    if (why) return ids.some((id) => rolling.has(id)) ? undefined : api.notify(why);
    const seed = drawSeed();
    // each die's place in the throw, and in what's told, is its place in the scene's own order
    // (a percentile pair reads tens first, as it was put down), then by id
    const rank = new Map([...(snap.ids ?? [])].map((id, i) => [id, i]));
    const order = [...ids].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));
    const dice = new Map();
    order.forEach((id, k) => {
      const o = snap.objects[id];
      const built = builtFor(id);
      const from = fromOf(o);
      // it lands in its parent's frame; a skid and a toss are in metres
      const parent = snap.parents?.get?.(id) ?? null;
      const unitScale = scaleOf(parent ? snap.world(parent) : null);
      // several together skid less: a part of their own width, so they don't land in each other
      const width = Math.max(...built.verts.map((v) => Math.hypot(...v))) * from.scale * unitScale;
      const plan = rollPlan(order.length === 1 ? seed : seedFor(seed, k), { built, from, unitScale, skid: order.length === 1 ? ROLL_SKID : Math.min(ROLL_SKID, 0.5 * width) });
      dice.set(id, { plan, from });
    });
    const toss = { dice, stop: null };
    throws.add(toss);
    for (const id of dice.keys()) rolling.set(id, toss);
    const drop = (id) => {
      dice.delete(id);
      if (rolling.get(id) === toss) rolling.delete(id);
    };
    const end = () => {
      toss.stop?.();
      toss.stop = null;
      throws.delete(toss);
      for (const id of [...dice.keys()]) drop(id);
    };
    toss.end = end;
    let t = 0;
    toss.stop = api.loop((dt) => {
      const objects = api.scene().objects ?? {};
      for (const [id, d] of [...dice]) {
        const now = objects[id];
        // a peer caught it, moved it or removed it: theirs. The rest carry on.
        if (!now || api.heldBy?.(id) != null || !sameTransform(now.transform, d.from)) {
          drop(id);
          if (now) api.pose.release(id);
        }
      }
      if (!dice.size) return end();
      t = Math.min(1, t + (Number(dt) || 0) / ROLL_SECONDS);
      if (t < 1) {
        for (const [id, d] of dice) api.pose.hold(id, d.plan.at(t));
        return;
      }
      const landed = [...dice].map(([id, d]) => ({ id, to: d.plan.to, face: d.plan.face }));
      end();
      // one write for the whole throw
      api.change(api.ops.setTransform(api.scene(), new Map(landed.map((l) => [l.id, l.to]))));
      for (const l of landed) api.pose.release(l.id, { landed: true });
      announce("rolled", { dice: landed.map((l) => ({ die: l.id, face: l.face })) });
    });
    for (const [id, d] of dice) api.pose.hold(id, d.from);
  }

  // ── turning a die to a face by hand ──
  /** Turn's state: on any die that can be read. Its value is the face showing; its choices, every face. */
  function turnState(id, snap = scene) {
    const o = snap?.objects?.[id];
    if (id == null || !isDie(o) || o.locked || notADie(id) || kept(id, snap)) return null;
    const built = builtFor(id);
    if (!built) return { disabled: true, title: "That die is still being made" };
    const face = faceUp(o.transform?.rotation ?? [0, 0, 0], built);
    const why = rolling.has(id) ? "It's rolling" : api.heldBy?.(id) != null ? "Someone has that die" : null;
    return {
      label: `Turn (shows ${built.faces[face].label})`,
      value: face,
      choices: built.faces.map((f, i) => ({ value: i, label: f.label })),
      ...(why ? { disabled: true, title: why } : { title: "Turn it by hand: T for its next face, or pick one" }),
    };
  }
  function turn(id, value) {
    const snap = api.scene();
    const st = turnState(id, snap);
    if (!st) return;
    if (st.disabled) return api.notify(st.title);
    const built = builtFor(id);
    const n = built.faces.length;
    const face = Number.isInteger(value) && value >= 0 && value < n ? value : (st.value + 1) % n;
    const from = fromOf(snap.objects[id]);
    const to = turnTo(built, face, from);
    // already lying that way: nothing to do, and nothing to tell
    if (sameTransform(to, from)) return;
    api.change(api.ops.setTransform(snap, id, to));
    announce("turned", { die: id, face });
  }

  // ── a peer's word, held to the doc ──
  const seenAt = new Map(); // die id → its doc transform as this view last saw it (a copy)
  const moved = new Map(); // die id → when this view saw its doc transform change (ms), until something is told for it
  const waiting = new Set(); // { type, data, from }: said, and not yet borne out by the doc
  const timers = new Set();
  function later(fn, ms) {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!dead) fn();
    }, ms);
    timers.add(t);
  }
  const itemsOf = (type, data) => (type === "rolled" ? data.dice : [data]);
  /** Note a die whose doc transform this view hasn't seen yet as moved now. */
  function look(id, o) {
    const was = seenAt.get(id);
    seenAt.set(id, copyOf(o.transform));
    if (was !== undefined && !sameTransform(o.transform, was)) moved.set(id, Date.now());
  }
  /** Tell it if the doc bears every die of it out: each moved lately, to the face named. Those moves are then spent. */
  function tell(w) {
    const s = api.scene();
    const items = itemsOf(w.type, w.data);
    for (const it of items) {
      if (Date.now() - (moved.get(it.die) ?? -Infinity) > TRUST_MS) return false;
      if (shows(it.die, s)?.face !== it.face) return false;
    }
    // (by name as it's known now: a contact's name may have arrived since they spoke)
    const text = told(w.type, w.data, nameOf(w.from));
    if (!text) return false;
    for (const it of items) moved.delete(it.die);
    api.notify(text);
    return true;
  }
  /** In update(): note each die whose transform changed, and tell what was waiting for it. */
  function diceMoved(snap) {
    for (const [id, o] of Object.entries(snap.objects ?? {})) if (isDie(o)) look(id, o);
    for (const id of seenAt.keys()) if (!snap.objects?.[id]) seenAt.delete(id), moved.delete(id);
    for (const w of [...waiting]) if (tell(w)) waiting.delete(w);
  }
  function heard(type, data, from) {
    if (!data || typeof data !== "object" || !Object.hasOwn(MESSAGES, type) || !MESSAGES[type](data)) return;
    const s = api.scene();
    const items = itemsOf(type, data);
    // every die named must be a die here, and each only once
    if (new Set(items.map((it) => it.die)).size !== items.length || !items.every((it) => isDie(s.objects?.[it.die]) && !kept(it.die, s))) return;
    // the doc may have moved them already, since this view last looked
    for (const it of items) look(it.die, s.objects[it.die]);
    const w = { type, data, from };
    if (tell(w)) return;
    waiting.add(w);
    later(() => waiting.delete(w), TRUST_MS);
  }

  // ── the die's own panel, docked beside the scene ──
  let dock = null; // { id, edge, unmount }
  function closeDock() {
    const d = dock;
    dock = null;
    if (!d) return;
    try {
      d.unmount?.();
    } catch (err) {
      console.warn("[dice] the die's panel didn't close cleanly", err);
    }
    d.edge.remove();
    api.schedule?.(() => {});
  }
  async function openDock(id) {
    const o = api.scene()?.objects?.[id];
    if (!isDie(o) || typeof o.sourceUrl !== "string") return;
    closeDock();
    const edge = api.edge("right");
    edge.classList.add("dice-dock");
    // keys typed in the panel are the panel's, never the scene's (STAGE.md, "Keys")
    edge.setAttribute("data-stage-embed", "");
    const header = document.createElement("header");
    const title = document.createElement("span");
    title.className = "name";
    title.textContent = o.name || "Die";
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Close";
    done.addEventListener("click", closeDock);
    header.append(title, done);
    const body = document.createElement("div");
    body.className = "body";
    edge.append(header, body);
    const mine = (dock = { id, edge, unmount: null });
    try {
      const [handle, tool] = await Promise.all([api.repo.find(o.sourceUrl), import("./tool.js")]);
      if (dock !== mine || dead) return;
      mine.unmount = tool.default(handle, body);
    } catch (err) {
      if (dock === mine) closeDock();
      api.notify(`Couldn't open that die: ${err?.message ?? err}`, "error");
    }
    api.schedule?.(() => {});
  }

  return {
    update(snapshot, local, prev) {
      // Playing with dice is done with the hand. A tool picked while editing
      // (G, R, the toolbar) is this view's local state and outlives the
      // switch to play, and a scene with only dice suggests no tool, so the
      // stage's default is Move: in play nothing offers a way to the hand,
      // and without this a die could not be picked up. (A stage-wide gap, an
      // Edit tool outliving the switch to Play; tabletop does the same.)
      if (inPlay(local) && (local.tool ?? snapshot?.d?.view?.tool ?? "move") !== "hand") {
        if (api.run?.({ ext: "scene.hand", command: "hand" }) !== true) api.local?.swap?.((m) => (m.tool === "hand" ? m : { ...m, tool: "hand" }));
      }
      meetPeers();
      // content arriving (a die's GLB) comes as an update with the same scene: something may now be readable
      if (snapshot === prev?.scene) {
        for (const w of [...waiting]) if (tell(w)) waiting.delete(w);
        return;
      }
      scene = snapshot;
      diceMoved(snapshot);
      // the die whose panel is open has gone (or is no longer a die)
      if (dock && !isDie(snapshot.objects?.[dock.id])) closeDock();
    },
    receive(type, data, from) {
      contactName(from?.viewer);
      heard(type, data, from);
    },
    commands: [
      {
        id: "roll",
        name: "Roll",
        // play only (state): R is the gizmo's Rotate while editing
        key: "r",
        show: ["use", "menu", "inspector"],
        state: (target, ctx) => rollState(target, ctx?.scene ?? scene, ctx?.local),
        run(target) {
          const snap = api.scene();
          if (!rollState(target, snap)) return;
          throwDice(diceOf(target, snap).filter((id) => rollable(id, snap)));
        },
      },
      {
        id: "roll-all",
        name: "Roll all",
        // play only (state): G is the gizmo's Move while editing
        key: "g",
        show: ["use", "menu"],
        state: (id, ctx) => rollAllState(id, ctx?.scene ?? scene, ctx?.local),
        run(id) {
          const snap = api.scene();
          if (!rollAllState(id, snap)) return;
          throwDice(handful(id, snap).filter((x) => rollable(x, snap)));
        },
      },
      {
        id: "turn",
        name: "Turn",
        key: "t",
        show: ["use", "menu", "inspector"],
        state: (id, ctx) => turnState(id, ctx?.scene ?? scene),
        run: turn,
      },
      {
        id: "open",
        name: "Edit die",
        show: ["menu", "inspector"],
        state(id, ctx) {
          const o = (ctx?.scene ?? scene)?.objects?.[id];
          if (id == null || !isDie(o) || o.providerId !== PROVIDER) return null;
          return dock?.id === id ? { label: "Close die panel", title: "Close this die's panel" } : { title: "Open this die's own panel beside the scene: its shape, faces and colours" };
        },
        run(id) {
          if (dock?.id === id) closeDock();
          else void openDock(id);
        },
      },
    ],
    dispose() {
      dead = true;
      // (the stage puts back any die still in the air: its holds are released as it stops)
      for (const toss of [...throws]) toss.end();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      waiting.clear();
      closeDock();
    },
  };
}

/**
 * A die doc dropped in the scene: a die object built by this package's
 * scene:source, at real size, carrying the trait (which is what starts this
 * extension), where it was dropped, and selected.
 */
async function drop(ctx, info) {
  if (info?.doc?.["@patchwork"]?.type !== "die") return false;
  const p = info.at?.point;
  const id = await ctx.addObject(info.url, {
    providerId: PROVIDER,
    group: info.group ?? null,
    fields: { traits: { [DIE]: {} } },
    ...(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? { transform: { position: [...p], rotation: [0, 0, 0], scale: 1 } } : {}),
  });
  ctx.local?.swap?.((m) => ((m.selected ?? null) === id ? m : { ...m, selected: id }));
  return true;
}

const CSS = `
.scene-stage .dice-dock { flex: 0 0 auto; width: clamp(300px, 36cqw, 460px); height: 100%; min-height: 0; display: flex; flex-direction: column;
  border-left: 1px solid var(--scene-line, #8884); background: var(--scene-bg, #fff); color: var(--scene-fg, #222); }
.scene-stage .dice-dock > header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-bottom: 1px solid var(--scene-line, #8884); font: 600 13px/1.3 var(--scene-family, system-ui, sans-serif); }
.scene-stage .dice-dock > header .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-stage .dice-dock > header button { font: inherit; padding: 2px 10px; border-radius: 6px; cursor: pointer; }
.scene-stage .dice-dock > .body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.scene-stage .dice-dock > .body > * { flex: 1 1 auto; min-height: 0; }
`;

export default { create, drop };
