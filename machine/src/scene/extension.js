// scene:extension "machine": a machine as an object in a scene, built only
// from the scene's extension contract (scene/STAGE.md).
//
// The object's source (`sourceUrl`) is a machine doc (its kind, and the content it boots)
// and its content is the cabinet scene:source "machine" builds; its trait,
// `machine`, holds the session this object runs, so the object is one
// running machine and a copy is another (the session is runtime: a copy
// starts without one, and the first view able to makes it a new one).
//
// On every view that can write the scene (a pin or a mirror never acts),
// each machine object:
// - runs its session's host on the scene's world time (running.js): every
//   present peer steps the engine itself, the machine pauses with the world,
//   stops while nobody plays, and keeps a world going only while it runs;
// - draws the engine's own picture on the cabinet's screen: a Screen
//   texture on a quad where the cabinet's GLB says its screen is, in the
//   object's displayed frame, every frame (nothing goes through the doc);
// - offers Play: a port, and the pad in hand as the held tool, its keys its
//   own; Escape puts it down and gives the port back.
//
// The screen shows one player's view for everyone (the trait's `player`,
// for a machine with a view per player: Doom): a screen is a thing in the
// world, and everyone looking at it sees the same picture.
//
// Starting is patient (start.js): a session nobody has written yet, or
// content still syncing, is asked for again on the stage's time, so a view
// that fails or leaves while making the session never strands the object.

import { Screen, ASPECT, viewOf } from "../present/screen.js";
import { WASM, bytes, load, portsOf, newSession } from "../patchwork/load.js";
import { pad, KEYS } from "../patchwork/input.js";
import { runMachine } from "./running.js";
import { retrying, makeSession } from "./start.js";

export const TRAIT = "machine";
export const PROVIDER = "machine";
/** ms between tries at starting a machine that couldn't start yet (the stage's time). */
export const RETRY_MS = 2000;

/**
 * The port whose view the screen shows, and which Play offers first: the
 * trait's `player` for a machine with a view per player (Doom), within its
 * ports; 0 for one with one picture (the Super NES), whatever the trait says.
 */
export function playerOf(kind, player, ports) {
  if (kind !== "doom") return 0;
  const p = Math.floor(Number(player ?? 0));
  return Number.isFinite(p) ? Math.max(0, Math.min(ports - 1, p)) : 0;
}

/**
 * The screen's matrix, into `out`: the unit quad scaled to the screen's
 * width and height at its centre (`extras.machine.screen`, the cabinet's
 * frame), then by the object's displayed world matrix (`at`, api.worldOf).
 */
export function screenMatrix(THREE, at, screen, out = new THREE.Matrix4()) {
  const local = new THREE.Matrix4().compose(new THREE.Vector3(...screen.center), new THREE.Quaternion(), new THREE.Vector3(screen.width, screen.height, 1));
  return out.multiplyMatrices(new THREE.Matrix4().fromArray(at), local);
}

function create(api) {
  const { THREE } = api;
  const layer = api.world();
  layer.name = "machine.screens";
  layer.userData.noPick = true;
  const labels = api.labels();
  const plane = new THREE.PlaneGeometry(1, 1);
  const machines = new Map(); // object id → entry
  let held = null; // { id, put }: the pad in this view's hand
  let stopLoop = null;

  const traitOf = (id) => api.scene().objects?.[id]?.traits?.[TRAIT] ?? null;

  function entry(id, o) {
    const e = { id, url: o.sourceUrl, session: o.traits[TRAIT].session ?? null, note: "Starting…", m: null, screen: null, mesh: null, view: null, pad: null, kind: null, title: null, ports: 1, gone: false, stop: null };
    machines.set(id, e);
    e.stop = retrying({
      attempt: () => open(e),
      after: (ms, fn) => api.clock.after(ms, fn),
      every: RETRY_MS,
      failed: (err) => void (e.gone || (e.note = `Couldn't start it yet: ${err?.message ?? err}. Trying again`)),
    });
    return e;
  }

  // One try at starting the machine: true once it runs (or its session is
  // written, which opens a new entry for it), false to try again later.
  async function open(e) {
    const say = (t) => void (e.gone || (e.note = t));
    const doc = (await api.repo.find(e.url)).doc();
    if (e.gone) return true;
    e.kind = doc?.kind ?? null;
    e.title = doc?.title ?? "Machine";
    if (!e.kind || !doc.content) return say("No game yet: open it in the Machine tool and choose one"), false;
    if (!api.writable()) return say("A machine plays only where the scene can be written"), false;
    if (!e.session) {
      const made = await makeSession(sessionMaker(e, doc));
      if (!made) say("Starting…"); // another view is making it: it may fail or leave
      return made;
    }
    const { session, content, wasm } = await load(api.repo, { session: e.session, content: doc.content, kind: e.kind }, say);
    if (e.gone) return true;
    e.pad = pad(e.kind, session.doc().engine.inputBytes);
    e.ports = portsOf(e.kind, content);
    say("Joining…");
    const m = await runMachine({
      repo: api.repo,
      url: e.session,
      wasm,
      content,
      ports: e.ports,
      world: api.clock,
      now: () => api.clock.now(),
      writable: () => api.writable(),
      by: api.viewer ?? null,
      input: () => e.pad.sample(),
    });
    if (e.gone) return m.close(), true;
    e.m = m;
    e.screen = new Screen({ THREE, aspect: ASPECT[e.kind] ?? ASPECT.square });
    e.mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: e.screen.texture, toneMapped: false }));
    e.mesh.matrixAutoUpdate = false;
    e.mesh.raycast = () => {}; // the cabinet behind it is what a press finds
    e.mesh.userData.noPick = true;
    e.mesh.name = `machine.screen:${e.id}`;
    e.mesh.visible = false;
    layer.add(e.mesh);
    e.note = null;
    loop();
    return true;
  }

  // A copy of a machine object, or one just laid out, has no session yet:
  // the view holding the object's claim makes one (on the scene's world
  // time, so its tick 0 is now) and writes it on the trait; every view then
  // opens it (start.js).
  const sessionMaker = (e, doc) => ({
    claim: () => api.claim(e.id, "machine.session"),
    has: () => e.gone || !!traitOf(e.id)?.session,
    content: async () => {
      const b = (await api.repo.find(doc.content)).doc()?.bytes;
      return b?.length ? new Uint8Array(b) : null;
    },
    create: async (content) => (await newSession(api.repo, { kind: e.kind, wasm: await bytes(WASM[e.kind]), content, wall: api.clock.t() * 1000 })).url,
    write: (url) =>
      api.change((d) => {
        const t = d.objects?.[e.id]?.traits?.[TRAIT];
        if (t && !t.session) t.session = url;
      }),
  });

  function close(e) {
    e.gone = true;
    e.stop?.();
    if (held?.id === e.id) held.put();
    machines.delete(e.id);
    e.mesh?.removeFromParent();
    e.mesh?.material.dispose();
    e.screen?.dispose();
    e.m?.close();
  }

  // Each object with the trait has one entry, for the session its trait names.
  function sync() {
    const objects = api.scene().objects ?? {};
    for (const [id, o] of Object.entries(objects)) {
      const t = o?.traits?.[TRAIT];
      if (!t) continue;
      const e = machines.get(id);
      if (e && e.session === (t.session ?? null) && e.url === o.sourceUrl) continue;
      if (e) close(e);
      entry(id, o);
    }
    for (const [id, e] of machines) if (!objects[id]?.traits?.[TRAIT]) close(e);
    loop();
  }

  // Every frame while there are machines: step each host, show its picture
  // on its screen where its object is drawn, and say what's up beside it.
  const m4 = new THREE.Matrix4();
  function loop() {
    if (machines.size && !stopLoop) stopLoop = api.loop(frame);
    else if (!machines.size && stopLoop) {
      stopLoop();
      stopLoop = null;
    }
  }
  function frame() {
    const items = [];
    for (const e of machines.values()) {
      const screen = api.content(e.id)?.extras?.machine?.screen;
      const at = api.worldOf(e.id);
      const centre = screen && at ? new THREE.Vector3(...screen.center).applyMatrix4(m4.fromArray(at)) : null;
      if (e.m) {
        e.m.frame();
        const player = playerOf(e.kind, traitOf(e.id)?.player, e.ports);
        if (e.view?.player !== player) e.view = Object.assign(viewOf(e.m.host, { player }), { player });
        e.screen.show(e.view());
        if (screen && at) {
          screenMatrix(THREE, at, screen, e.mesh.matrix);
          e.mesh.matrixWorldNeedsUpdate = true;
          e.mesh.visible = true;
        }
      }
      const note = e.note ?? stoppedNote(e);
      if (note && centre) items.push({ key: `machine:${e.id}`, text: note, position: [centre.x, centre.y - (screen.height / 2) - 0.08, centre.z], className: "machine-note" });
    }
    labels.set(items);
  }

  function stoppedNote(e) {
    if (!e.m || e.m.clock.running()) return null;
    if (!api.clock.running()) return null; // the world's own pause says so already
    return e.m.holders().some(Boolean) ? "Paused" : "Stopped while nobody plays: P to play";
  }

  // ---- the pad in hand

  function play(id) {
    const e = machines.get(id);
    if (!e?.m) return;
    if (held?.id === id) return void held.put();
    const port = e.m.play(playerOf(e.kind, traitOf(id)?.player, e.ports));
    if (port == null) return void api.notify("Every port on that machine is taken");
    const mine = { id, put: null };
    const input = {
      key: (ev) => (e.pad.key(ev.code, true), true),
      keyup: (ev) => (e.pad.key(ev.code, false), true),
      put() {
        if (held === mine) held = null;
        e.pad.clear();
        e.m?.leave();
      },
    };
    held = mine;
    mine.put = api.hold({ name: `${e.title} · P${port + 1}`, keys: KEYS[e.kind] ?? [] }, input);
  }

  function verbOf(target) {
    const e = target != null ? machines.get(target) : null;
    if (!e) return null;
    if (!e.m) return { label: "Play", disabled: true, title: e.note ?? "Starting…" };
    if (held?.id === target) return { label: "Leave" };
    if (!e.m.holders().includes(null)) return { label: "Play", disabled: true, title: "Every port is taken" };
    return { label: "Play" };
  }

  sync();

  return {
    update(scene, _local, prev) {
      if (scene !== prev?.scene) sync();
    },
    commands: [
      {
        id: "play",
        name: "Play",
        key: "p",
        reach: true,
        show: ["use", "menu"],
        state: (target) => verbOf(target),
        run: (target) => play(target),
      },
    ],
    dispose() {
      for (const e of [...machines.values()]) close(e);
      stopLoop?.();
      stopLoop = null;
      labels.set([]);
      plane.dispose();
    },
  };
}

/**
 * A machine doc dropped (or pasted) in the scene: its cabinet, standing where
 * it was dropped, carrying the trait. Its session comes once it's in.
 */
async function drop(ctx, info) {
  if (info?.doc?.["@patchwork"]?.type !== "machine") return false;
  const p = info.at?.point;
  const id = await ctx.addObject(info.url, {
    providerId: PROVIDER,
    group: info.group ?? null,
    fields: { traits: { [TRAIT]: {} } },
    ...(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? { transform: { position: [...p], rotation: [0, 0, 0], scale: 1 } } : {}),
  });
  ctx.select?.(id);
  return true;
}

export default { create, drop };
