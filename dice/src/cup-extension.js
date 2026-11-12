// `scene:extension` "dice.cup": dice cups. A cup is a physical thing, not a
// rule: it covers the dice under it, it can be shaken and slammed down over
// them, its holder can tilt it to peek, anyone can lift it, knock it over or
// stand it up again. Nothing here knows a bid, a turn or what the dice are
// for. Built only from the stage's contract (scene/STAGE.md).
//
// What it contributes:
// - `audience`: who may see what's under each cup (cup.js policy): pure in
//   the doc, so it holds whatever anyone is doing (this extension declares
//   no `activities`).
// - `looks()`: for a die of a shake not yet turned up, the one rule keepers
//   share (rule.js): its own look when it isn't turned toward you, the veil
//   when it is and you may not (or can't yet) know it, and when you may and
//   your client knows it, the die itself, shown lying as it really does.
// - Dressing (STAGE.md, `content`): each view, for itself, shows a die it
//   knows lying as it really lies (the doc has it in a pose that says
//   nothing), hides the dice under a cup it may not see under, and tilts a
//   cup its holder is peeking under.
// - The verbs, in play: Shake (S), Shake blind, Peek (hold P), Lift (L),
//   Cover, Knock over, Stand up, Lift all cups. A cup down over dice can't
//   be carried (the hand asks `carryable`): picking it up is lifting it.
//
// THE ROLL. Shaking writes, in one change, the cup down on its spot, its
// dice in a ring under it in a pose that says nothing of the roll (face 0
// up, turned only about +Y), and `roll: { draw, dice, blind, done: false }`;
// and asks lots (this package's "dice.lots", lots-ext.js) for a draw on the
// cup, of those dice in that order, sealed by the holder alone (shaken blind: by every seated player, the
// holder too; cup.js sealersFor). Nobody's client chooses the seed: the
// seated players' clients draw it between them, and the sealed parts stay
// sealed, so only the holder's client can work out the faces (blind: nobody's,
// until the cup is lifted and the others release their parts to each
// other). When the stage's audience for the cup becomes everyone (lifted,
// knocked over), the sealed parts are opened, every client works out the
// same faces, and the first to do so writes them (`done: true`): from then
// on they are ordinary dice lying as the doc says.
//
// The doc isn't signed, so a client uses a draw's seed only if it is the
// one the cup's shake asked for (cup.js `fits`: its draw, asked by the
// holder, of its dice, sealed as the shake says); a round written over it by anyone else
// is no roll of this cup's, and the holder's client asks again for its own.
// Each view says when a cup was shaken from the doc itself (a new draw on
// it), not from anyone's word, so a reshake can't go untold.

import { CUP, CUP_HEIGHT, CUP_MOUTH, MAX_UNDER, cupsOf, fits, includes, knocked, lifted, lowered, ours, policy, sealersFor, shakePlan, shaken, stoodUp, upright } from "./cup.js";
import { builtOf, faceOfSeed, faceUp, scaleOf, seedFor, seedFromLots, settled } from "./roll.js";
import { lookFor } from "./rule.js";

/** How long a shake rattles before the cup comes down (s). */
export const SHAKE_SECONDS = 0.6;
/** How far a peek tilts the cup (radians). */
const PEEK_TILT = (55 * Math.PI) / 180;
/** How far apart a peer's word and the doc change that bears it out may arrive (ms). */
const TRUST_MS = 3000;
/** How long a shake's lots may stay other than it asked before every view says so (ms): its own round lands a few hundred ms after the shake. */
export const ASTRAY_MS = 2000;

const str = (s) => typeof s === "string" && s.length > 0 && s.length < 128;
const only = (d, keys) => Object.keys(d).every((k) => keys.includes(k));
/** What a peer may tell us: which cup, and nothing else (nothing about what's under it). A shake is told from the doc: a new draw on a cup. */
export const MESSAGES = {
  peeked: (d) => only(d, ["cup"]) && str(d.cup),
  lifted: (d) => only(d, ["cups"]) && Array.isArray(d.cups) && d.cups.length > 0 && d.cups.length <= 64 && d.cups.every(str),
};

const vec = (v) => [0, 1, 2].map((i) => Number(v?.[i]) || 0);
const transformOf = (o) => ({ position: vec(o?.transform?.position), rotation: vec(o?.transform?.rotation), scale: Number(o?.transform?.scale) || 1 });

/** Write a whole transform into a draft object, number by number (a peer's other fields land). */
function writeTransform(o, t) {
  if (!o) return;
  if (!o.transform) o.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
  for (const k of ["position", "rotation"]) {
    if (!Array.isArray(o.transform[k])) o.transform[k] = [0, 0, 0];
    for (let i = 0; i < 3; i++) if (o.transform[k][i] !== t[k][i]) o.transform[k][i] = t[k][i];
  }
  if (o.transform.scale !== (t.scale ?? 1)) o.transform.scale = t.scale ?? 1;
}

/**
 * How this view dresses a die a cup answers for (pure):
 *   "truth"  shown lying as it really does (its shake's seed is known here, and this viewer may see it)
 *   "hide"   not drawn at all (under a cup this viewer may not see under: only the cup shows)
 *   null     as the doc has it (or the veil, which the stage draws in its place)
 */
export function dressFor({ veiled, pending, known, covered, audience, viewer }) {
  if (veiled) return null;
  if (pending && known && includes(audience, viewer)) return "truth";
  if (covered && !includes(audience, viewer)) return "hide";
  return null;
}

function create(api) {
  const viewer = api.viewer;
  const THREE = api.THREE;
  let snap = null;
  let state = cupsOf(null);
  let looks = new Map();
  const builts = new Map(); // die id → what it is, as last built here (kept while it's veiled)
  const truth = new Map(); // die id → how it really lies, when this client knows its cup's seed
  const knownDraws = new Set(); // the shakes not yet turned up whose seed this client knows
  const dressed = new Map(); // object id → { root, kind }
  const announced = new Set(); // draws whose turning up this view has told
  const written = new Set(); // draws this view has written turned up
  const shaking = new Map(); // cup id → { stop }
  let peek = null; // { cup, dir: [x, z] } this view's own
  const waiting = new Set(); // { type, data, from, at }: said by a peer, not yet borne out by the doc
  const rollsSeen = new Map(); // cup id → the draw last seen on it (to tell a new one)
  const ownShakes = new Set(); // draws this view shook itself (told as it did)
  const asked = new Map(); // a draw this client asked for → the lots round that was on the cup when it last asked
  const astray = new Map(); // a draw whose lots aren't what it asked for → since when (this client's clock)
  let dead = false;
  const labels = api.labels?.();

  const inPlay = (local) => (local ?? api.local?.get?.())?.activities?.current === "play";
  const kOf = (s) => (parent) => (parent && s?.world ? scaleOf(s.world(parent)) : 1);

  /** This package's lots, as this view runs them (lots-ext.js), or null while they aren't running. */
  function lotsApi() {
    for (const { value } of api.collect?.("dice.lots") ?? []) if (typeof value?.draw === "function" && typeof value?.state === "function") return value;
    return null;
  }
  function rosterApi() {
    for (const { value } of api.collect?.("roster") ?? []) if (typeof value?.viewers === "function") return value;
    return null;
  }
  function seated(s) {
    try {
      return rosterApi()?.viewers(s) ?? null;
    } catch {
      return null;
    }
  }
  const who = (v) => {
    if (!v) return "Nobody";
    if (v === viewer) return "You";
    try {
      return rosterApi()?.who?.(v) || "Someone";
    } catch {
      return "Someone";
    }
  };
  const whose = (v) => (v === viewer ? "your" : `${who(v)}'s`);

  function builtFor(id) {
    const b = builtOf(api.content?.(id)?.extras?.dice);
    if (b) builts.set(id, b);
    return builts.get(id) ?? null;
  }

  // ── what this client knows ──
  /** For each shake not yet turned up whose seed this client knows: how each of its dice really lies. */
  function work() {
    truth.clear();
    knownDraws.clear();
    // what each die near a cup is, read while it's shown as itself (a veil has nothing to say)
    for (const c of state.cups.values()) for (const d of new Set([...c.front, ...c.under, ...c.pending])) builtFor(d);
    const lots = lotsApi();
    for (const c of state.cups.values()) {
      const roll = c.cup.roll;
      if (!roll || roll.done) continue;
      const st = lots?.state?.(c.id);
      const seed = fits(st, c.cup) ? seedFromLots(st.seed) : null;
      if (seed == null) continue;
      knownDraws.add(roll.draw);
      roll.dice.forEach((d, i) => {
        const o = snap.objects?.[d];
        const b = o ? builtFor(d) : null;
        if (b) truth.set(d, settled(b, seedFor(seed, i), transformOf(o)).to);
      });
      // known to everyone now: turn them up, once, in one write (every client that gets here writes the same)
      if (st.public && !written.has(roll.draw) && roll.dice.every((d) => !snap.objects?.[d] || truth.has(d))) {
        written.add(roll.draw);
        const ids = roll.dice.filter((d) => truth.has(d));
        const at = new Map(ids.map((d) => [d, truth.get(d)]));
        api.change((doc) => {
          const t = doc.objects?.[c.id]?.traits?.[CUP];
          if (!t?.roll || t.roll.draw !== roll.draw || t.roll.done) return;
          for (const [d, to] of at) writeTransform(doc.objects[d], to);
          t.roll.done = true;
        });
      }
    }
  }

  /** Once a shake is turned up: say what it showed and who drew it, and check the doc against the seed. */
  function tellTurnedUp() {
    const lots = lotsApi();
    for (const c of state.cups.values()) {
      const roll = c.cup.roll;
      if (!roll?.done || announced.has(roll.draw)) continue;
      const st = lots?.state?.(c.id);
      const seed = fits(st, c.cup) && st.public ? seedFromLots(st.seed) : null;
      if (seed == null) continue;
      const labelsOf = [];
      let right = true;
      roll.dice.forEach((d, i) => {
        const o = snap.objects?.[d];
        const b = o ? builtFor(d) : null;
        if (!b) return;
        const face = faceOfSeed(seedFor(seed, i), b.faces.length);
        if (faceUp(transformOf(o).rotation, b) !== face) right = false;
        labelsOf.push(b.faces[face].label);
      });
      if (labelsOf.length !== roll.dice.filter((d) => snap.objects?.[d]).length) continue;
      announced.add(roll.draw);
      const by = (st.contributors ?? []).map((v) => (v === viewer ? "you" : who(v)));
      api.notify?.(`${c.cup.holder ? `${who(c.cup.holder)} rolled` : "Rolled"} ${labelsOf.join(", ")}: drawn by ${by.length > 1 ? `${by.slice(0, -1).join(", ")} and ${by.at(-1)}` : `${by[0] ?? "nobody"} alone`}.`);
      if (!right) api.notify?.(`The dice under ${whose(c.cup.holder)} cup don't lie as their roll says: someone has moved them.`, "warn");
    }
  }

  /** A new draw on a cup is a shake: say so, whoever wrote it and whatever they said. */
  function tellShaken() {
    for (const c of state.cups.values()) {
      const draw = c.cup.roll?.draw ?? null;
      const was = rollsSeen.get(c.id);
      rollsSeen.set(c.id, draw);
      if (was === undefined || draw === null || draw === was || ownShakes.has(draw)) continue;
      const how = c.cup.roll.blind ? " blind" : "";
      api.notify?.(c.cup.holder === viewer ? `Your cup was shaken${how}.` : `${who(c.cup.holder)} shook their cup${how}.`);
    }
  }

  /**
   * My shake's lots, put right: when the round on my cup isn't the one my
   * shake asked for (someone wrote over it; two of us shook at once and the
   * merge kept my roll and their round), my client asks again for my draw,
   * once for each round it finds there.
   */
  function heal() {
    const lots = lotsApi();
    const now = Date.now();
    for (const c of state.cups.values()) {
      const roll = c.cup.roll;
      if (!roll || roll.done) continue;
      const st = lots?.state?.(c.id) ?? null;
      if (ours(st, c.cup)) {
        astray.delete(roll.draw);
        continue;
      }
      if (!astray.has(roll.draw)) astray.set(roll.draw, now);
      if (!lots || c.cup.holder !== viewer) continue;
      const there = st?.id ?? null;
      if (asked.has(roll.draw) && asked.get(roll.draw) === there) continue;
      asked.set(roll.draw, there);
      lots.draw(c.id, { sealers: sealersFor(viewer, roll.blind, seated(snap)), draw: roll.draw, of: roll.dice });
    }
  }

  // ── what this view shows ──
  function lens() {
    const next = new Map();
    for (const [d, cupId] of state.cupOfDie) {
      const c = state.cups.get(cupId);
      if (!c.pending.includes(d)) continue;
      // known here: its seed is (what it looks like then follows from its build, once that's shown)
      const look = lookFor({ ready: true, audience: api.audience(d), shown: api.shown(d), viewer, look: knownDraws.has(c.cup.roll?.draw) ? { known: true } : null });
      if (look?.veil) next.set(d, { veil: true });
    }
    looks = next;
  }

  const matrixOf = (t) => {
    const s = Number(t.scale) || 1;
    return new THREE.Matrix4().compose(new THREE.Vector3(...t.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ")), new THREE.Vector3(s, s, s));
  };
  function putBack(id) {
    const was = dressed.get(id);
    if (!was) return;
    dressed.delete(id);
    was.root.position.set(0, 0, 0);
    was.root.quaternion.identity();
    was.root.scale.set(1, 1, 1);
    was.root.visible = true;
  }
  /** `want`: null (as it is), "hide", { matrix } (the root, in the object's own frame). */
  function dress(id, want) {
    const root = api.content?.(id)?.root ?? null;
    if (dressed.get(id) && dressed.get(id).root !== root) dressed.delete(id); // rebuilt: the new root starts plain
    if (!want || !root) return putBack(id);
    if (want === "hide") {
      root.visible = false;
    } else {
      want.matrix.decompose(root.position, root.quaternion, root.scale);
      root.visible = true;
    }
    dressed.set(id, { root, kind: want === "hide" ? "hide" : "pose" });
  }
  function dressAll() {
    if (!THREE) return;
    const seen = new Set();
    for (const [d, cupId] of state.cupOfDie) {
      seen.add(d);
      const c = state.cups.get(cupId);
      const how = dressFor({ veiled: !!looks.get(d)?.veil, pending: c.pending.includes(d), known: truth.has(d), covered: state.covered.has(d), audience: api.audience(d), viewer });
      dress(d, how === "truth" ? { matrix: matrixOf(transformOf(snap.objects[d])).invert().multiply(matrixOf(truth.get(d))) } : how);
    }
    // the cup I'm peeking under, tilted toward me, in this view alone
    const p = peek && state.cups.get(peek.cup);
    if (p && p.covering && p.cup.holder === viewer) {
      seen.add(peek.cup);
      const r = CUP_MOUTH;
      const [dx, dz] = peek.dir;
      const P = new THREE.Vector3(-dx * r, 0, -dz * r);
      const axis = new THREE.Vector3(-dz, 0, dx).normalize();
      const m = new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(new THREE.Matrix4().makeRotationAxis(axis, PEEK_TILT)).multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
      dress(peek.cup, { matrix: m });
    } else if (peek && !p?.covering) clearPeek();
    for (const id of [...dressed.keys()]) if (!seen.has(id)) putBack(id);
    api.invalidate?.();
  }

  function drawLabels() {
    if (!labels) return;
    const items = [];
    const at = (id) => {
      const m = api.worldOf?.(id);
      return m ? [m[12], m[13] + CUP_HEIGHT + 0.03, m[14]] : null;
    };
    for (const [session, p] of Object.entries(api.presence?.get?.() ?? {})) {
      if (session === api.session) continue;
      const cup = p?.keys?.[api.id]?.peek;
      const c = typeof cup === "string" ? state.cups.get(cup) : null;
      if (!c || !c.covering || c.cup.holder !== p.viewer) continue;
      const position = at(cup);
      if (position) items.push({ key: `peek:${cup}`, text: `${who(p.viewer)} is peeking`, position, className: "dice-cup-tag" });
    }
    for (const c of state.cups.values()) {
      if (!c.cup.blind || !c.cup.holder) continue;
      const position = at(c.id);
      if (position) items.push({ key: `blind:${c.id}`, text: c.cup.holder === viewer ? "Blind: hidden from you" : `Blind: hidden from ${who(c.cup.holder)}`, position, className: "dice-cup-tag" });
    }
    labels.set(items);
  }

  // ── telling the others (ids only; each view words it from its own doc) ──
  function borneOut(w) {
    const c = state.cups.get(w.data.cup ?? w.data.cups?.[0]);
    if (w.type === "peeked") return !!c && c.covering && c.cup.holder === w.from?.viewer;
    if (w.type === "lifted") return w.data.cups.every((id) => state.cups.get(id) && !state.cups.get(id).covering);
    return false;
  }
  function told(w) {
    const name = who(w.from?.viewer);
    if (w.type === "peeked") return `${name} peeked under their cup.`;
    if (w.type === "lifted") {
      const holders = w.data.cups.map((id) => state.cups.get(id)?.cup.holder).filter(Boolean);
      return w.data.cups.length > 1 ? `${name} lifted every cup.` : `${name} lifted ${holders[0] === w.from?.viewer ? "their own" : holders[0] ? `${whose(holders[0])}` : "a"} cup.`;
    }
    return null;
  }
  function settleWaiting() {
    const now = Date.now();
    for (const w of [...waiting]) {
      if (now - w.at > TRUST_MS) waiting.delete(w);
      else if (borneOut(w)) {
        waiting.delete(w);
        const text = told(w);
        if (text) api.notify?.(text);
      }
    }
  }

  // ── the verbs ──
  const cupAt = (id, s = snap) => (id != null && s ? (s === snap ? state : cupsOf(s, kOf(s))).cups.get(id) ?? null : null);

  function shakeState(id, ctx, blind) {
    const s = ctx?.scene ?? snap;
    if (!inPlay(ctx?.local)) return null;
    const c = cupAt(id, s);
    if (!c) return null;
    const n = shaken(c, s.ids ?? []).length;
    const here = new Set(Object.values(api.presence?.get?.() ?? {}).map((p) => p?.viewer));
    const others = (seated(s) ?? []).filter((v) => v !== viewer);
    const why = shaking.has(id)
      ? "It's being shaken"
      : api.heldBy?.(id) != null
        ? "Someone has that cup"
        : !lotsApi()
          ? "Rolls are drawn by lots, which aren't running here yet"
          : n === 0
            ? "There are no dice in front of this cup"
            : n > MAX_UNDER
              ? `Only ${MAX_UNDER} dice fit under a cup`
              : blind && !others.length
                ? "Nobody else is seated to see it"
                : blind && !others.some((v) => here.has(v))
                  ? "Nobody else at the table is here to keep it from you"
                  : null;
    return {
      ...(blind ? {} : { label: "Shake" }),
      ...(why ? { disabled: true, title: why } : { title: blind ? "Shake it and slam it down: the others may see what's under it, you may not" : "Shake it and slam it down over its dice: only you may look under it (S)" }),
    };
  }

  function shake(id, blind) {
    const s = api.scene();
    const st = shakeState(id, { scene: s, local: api.local.get() }, blind);
    if (!st) return;
    if (st.disabled) return api.notify?.(st.title);
    const c = cupsOf(s, kOf(s)).cups.get(id);
    const dice = shaken(c, s.ids ?? []);
    const plan = shakePlan(c, dice, new Map(dice.map((d) => [d, Number(s.objects[d]?.transform?.scale) || 1])));
    if (!plan) return;
    const lots = lotsApi();
    const before = lots.state(id)?.id ?? null;
    const draw = lots.draw(id, { sealers: sealersFor(viewer, !!blind, seated(s)), of: [...plan.dice.keys()] });
    if (!draw) return api.notify?.("Couldn't start the roll.");
    // (its round lands after this write, over whatever round is there now: not a round gone astray)
    asked.set(draw, before);
    ownShakes.add(draw);
    if (peek?.cup === id) stopPeek();
    api.change((doc) => {
      const o = doc.objects?.[id];
      const t = o?.traits?.[CUP];
      if (!t) return;
      writeTransform(o, plan.cup);
      for (const [d, to] of plan.dice) writeTransform(doc.objects[d], to);
      t.holder = viewer;
      t.up = false;
      t.blind = !!blind;
      t.roll = { draw, dice: [...plan.dice.keys()], blind: !!blind, done: false };
    });
    api.notify?.(blind ? "You shook your cup blind: the others may look, you may not." : "You shook your cup.");
    // rattle it in the air, where everyone sees, and slam it down
    let t = 0;
    const base = plan.cup;
    const stop = api.loop((dt) => {
      t += Math.min(0.1, Number(dt) || 0) / SHAKE_SECONDS;
      if (t >= 1) {
        stop?.();
        shaking.delete(id);
        api.pose.release(id, { landed: true });
        return;
      }
      const w = Math.sin(t * Math.PI * 7);
      const k = state.cups.get(id)?.k ?? 1;
      api.pose.hold(id, {
        position: [base.position[0] + (0.006 * w) / k, base.position[1] + (0.05 * Math.sin(t * Math.PI)) / k, base.position[2]],
        rotation: [0.25 * w, base.rotation[1], 0.15 * Math.cos(t * Math.PI * 5)],
        scale: base.scale,
      });
    });
    shaking.set(id, { stop });
  }

  function peekState(id, ctx) {
    if (!inPlay(ctx?.local)) return null;
    const c = cupAt(id, ctx?.scene ?? snap);
    if (!c || !c.covering || c.cup.holder !== viewer) return null;
    return peek?.cup === id ? { label: "Stop peeking", title: "Put it back down flat" } : { label: "Peek", title: "Tilt it toward you to look under it: the others see that you did, not what (hold P)" };
  }
  function clearPeek() {
    peek = null;
    api.presence?.set?.("peek", undefined);
  }
  function stopPeek() {
    clearPeek();
    if (snap) dressAll();
  }
  function startPeek(id) {
    const m = api.worldOf?.(id);
    const eye = api.camera?.get?.()?.position;
    let dir = [0, 1];
    if (m && eye && THREE) {
      const local = new THREE.Vector3(...eye).applyMatrix4(new THREE.Matrix4().fromArray(m).invert());
      const l = Math.hypot(local.x, local.z);
      if (l > 1e-6) dir = [local.x / l, local.z / l];
    }
    peek = { cup: id, dir };
    api.presence?.set?.("peek", id);
    api.send?.("peeked", { cup: id });
    dressAll();
  }
  function peekRun(id) {
    if (!peekState(id, { scene: api.scene(), local: api.local.get() })) return;
    if (peek?.cup === id) return void stopPeek();
    startPeek(id);
    // held from the use prompt: let go and it goes back down; pressed anywhere else, it stays tilted until asked
    return { end: () => peek?.cup === id && stopPeek(), cancel: () => peek?.cup === id && stopPeek() };
  }

  function liftState(id, ctx) {
    if (!inPlay(ctx?.local)) return null;
    const c = cupAt(id, ctx?.scene ?? snap);
    if (!c) return null;
    if (c.covering) return { label: "Lift", title: c.cup.blind ? `Lift it: everyone but ${c.cup.holder === viewer ? "you" : who(c.cup.holder)} may see what's under it (L)` : "Lift it: everyone sees what's under it (L)" };
    if (c.cup.blind && c.cup.holder) return { label: c.cup.holder === viewer ? "Show me" : `Show ${who(c.cup.holder)}`, title: "Let whoever shook it see too (L)" };
    return null;
  }
  /** Lift these cups (and show blind ones to their holders), in one change. */
  function lift(ids) {
    const s = api.scene();
    const st = cupsOf(s, kOf(s));
    const did = [];
    api.change((doc) => {
      for (const id of ids) {
        const c = st.cups.get(id);
        const o = doc.objects?.[id];
        const t = o?.traits?.[CUP];
        if (!c || !t) continue;
        if (c.covering) {
          writeTransform(o, lifted(c.t, c.k));
          t.up = true;
          if (ids.length > 1 && t.blind) t.blind = false;
          did.push(id);
        } else if (c.cup.blind) {
          t.blind = false;
          did.push(id);
        }
      }
    });
    if (did.length) api.send?.("lifted", { cups: did });
  }

  const liftAllState = (target, ctx) => {
    if (!inPlay(ctx?.local)) return null;
    const s = ctx?.scene ?? snap;
    if (target != null && !cupAt(target, s)) return null;
    const st = s === snap ? state : cupsOf(s, kOf(s));
    const any = [...st.cups.values()].some((c) => c.covering || (c.cup.blind && c.cup.holder));
    return any ? { title: "Lift every cup at the table, blind ones shown to their holders too" } : null;
  };

  function simple(id, ctx, test) {
    if (!inPlay(ctx?.local)) return null;
    const c = cupAt(id, ctx?.scene ?? snap);
    return c && !shaking.has(id) ? test(c) : null;
  }
  function move(id, to, fields = {}) {
    api.change((doc) => {
      const o = doc.objects?.[id];
      const t = o?.traits?.[CUP];
      if (!t) return;
      writeTransform(o, to);
      Object.assign(t, fields);
    });
  }

  return {
    audience: (scene) => policy(scene, seated(scene), kOf(scene)),
    update(snapshot, local, prev) {
      if (dead) return;
      if (snapshot !== snap) {
        snap = snapshot;
        state = cupsOf(snapshot, kOf(snapshot));
      }
      tellShaken();
      heal();
      work();
      lens();
      dressAll();
      drawLabels();
      settleWaiting();
      tellTurnedUp();
    },
    looks: () => looks,
    /** for probes: this view's own peek, and what it has dressed */
    debug: () => ({ peek, dressed: [...dressed.entries()].map(([id, d]) => [id, d.kind]) }),
    // a die under a cup can't be picked up through it; a cup being shaken is in someone's hand; a cup down over
    // dice can't be slid off part of them (picking it up is lifting it: Lift, or Knock over)
    carryable: (id) => !(state.covered.has(id) || shaking.has(id) || state.cups.get(id)?.under.length > 0),
    receive(type, data, from) {
      if (!data || typeof data !== "object" || !Object.hasOwn(MESSAGES, type) || !MESSAGES[type](data)) return;
      waiting.add({ type, data, from, at: Date.now() });
      settleWaiting();
    },
    hud() {
      const out = [];
      if (state.cups.size && !lotsApi()) out.push({ text: "Cups can't be shaken yet: rolls are drawn by lots, which aren't running here.", state: "warn" });
      const lots = lotsApi();
      const now = Date.now();
      const list = (vs) => (vs.length > 1 ? `${vs.slice(0, -1).join(", ")} and ${vs.at(-1)}` : vs[0]);
      const cap = (t) => t.replace(/^./, (x) => x.toUpperCase());
      for (const c of state.cups.values()) {
        const roll = c.cup.roll;
        if (!roll || roll.done) continue;
        const st = lots?.state?.(c.id);
        if (lots && !ours(st, c.cup)) {
          if (now - (astray.get(roll.draw) ?? now) >= ASTRAY_MS) out.push({ text: cap(`${whose(c.cup.holder)} dice can't be turned up: the lots on that cup aren't the ones its shake asked for (two shakes at once, or someone wrote over them). ${c.cup.holder === viewer ? "Your client is asking again" : `${who(c.cup.holder)}'s client asks again`}.`), state: "warn" });
          continue;
        }
        if (st && !fits(st, c.cup)) {
          out.push({ text: cap(`Nobody but ${who(c.cup.holder).replace(/^You$/, "you")} took part in the lots for ${whose(c.cup.holder)} blind shake, so it isn't blind: shake it again with someone else here.`), state: "warn" });
          continue;
        }
        if (c.covering) continue;
        // lifted, and its sealed parts not all here: to everyone (turned up), or, shaken blind, to those it's shown to
        const audience = api.audience(c.id);
        if (st && st.phase === "sealed" && (audience === "all" || (Array.isArray(audience) && audience.includes(viewer)))) {
          const w = st.waiting;
          const what = audience === "all" ? "turned up" : "shown to you";
          out.push({ text: cap(`${whose(c.cup.holder)} dice can't be ${what} until ${list(w.map(who))} ${w.length > 1 || w[0] === viewer ? "are" : "is"} here to open ${w.length > 1 ? "their parts" : w[0] === viewer ? "your part" : "their part"} of the roll.`), state: "warn" });
        }
      }
      return out;
    },
    commands: [
      { id: "shake", name: "Shake", key: "s", show: ["use", "menu", "inspector"], state: (id, ctx) => shakeState(id, ctx, false), run: (id) => shake(id, false) },
      { id: "shake-blind", name: "Shake blind", show: ["menu", "inspector"], state: (id, ctx) => shakeState(id, ctx, true), run: (id) => shake(id, true) },
      { id: "peek", name: "Peek", key: "p", hold: true, show: ["use", "menu"], state: peekState, run: peekRun },
      { id: "lift", name: "Lift", key: "l", show: ["use", "menu", "inspector"], state: liftState, run: (id) => liftState(id, { scene: api.scene(), local: api.local.get() }) && lift([id]) },
      {
        id: "lift-all",
        name: "Lift all cups",
        show: ["menu", "toolbar"],
        state: liftAllState,
        run: (target) => {
          if (!liftAllState(target, { scene: api.scene(), local: api.local.get() })) return;
          const s = api.scene();
          lift([...cupsOf(s, kOf(s)).cups.values()].filter((c) => c.covering || (c.cup.blind && c.cup.holder)).map((c) => c.id));
        },
      },
      {
        id: "cover",
        name: "Cover",
        show: ["menu"],
        state: (id, ctx) => simple(id, ctx, (c) => (c.cup.up && upright(c.t) ? { title: "Put it back down over the dice in front of it, without shaking" } : null)),
        run: (id) => {
          const c = cupAt(id, api.scene());
          if (c?.cup.up && upright(c.t)) move(id, lowered(c.t, c.k), { up: false });
        },
      },
      {
        id: "knock",
        name: "Knock over",
        show: ["menu"],
        state: (id, ctx) => simple(id, ctx, (c) => (upright(c.t) ? { title: "Tip it onto its side: whatever was under it is in plain sight" } : null)),
        run: (id) => {
          const c = cupAt(id, api.scene());
          if (c && upright(c.t)) move(id, knocked(c.t, c.k));
        },
      },
      {
        id: "stand",
        name: "Stand up",
        show: ["menu"],
        state: (id, ctx) => simple(id, ctx, (c) => (!upright(c.t) ? { title: "Stand it back up, mouth down" } : null)),
        run: (id) => {
          const c = cupAt(id, api.scene());
          if (c && !upright(c.t)) move(id, stoodUp(c.t, c.k));
        },
      },
    ],
    dispose() {
      dead = true;
      for (const s of shaking.values()) s.stop?.();
      shaking.clear();
      for (const id of [...dressed.keys()]) putBack(id);
    },
  };
}

const CSS = `
.scene-stage .label.dice-cup-tag { font: 600 11px/1.2 var(--scene-family, system-ui, sans-serif); padding: 2px 6px; border-radius: 6px;
  background: color-mix(in srgb, var(--scene-bg, #fff) 85%, transparent); color: var(--scene-fg, #222); white-space: nowrap; }
`;

export default {
  create(api) {
    api.style?.(CSS);
    return create(api);
  },
};
