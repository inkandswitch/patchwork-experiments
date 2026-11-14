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
// - plays what the engine plays from the screen (speaker.js): a panner at
//   the screen, this view's ears where its eye is;
// - has a seat per port at the screen (seating.js), the seats package's,
//   laid when its session is made: sitting in port N's seat takes port N
//   and puts its pad in your hand; standing up gives the port back. Escape
//   puts the pad down (the port stays yours while you sit); P picks it up.
//   A machine with no seats is played by Play alone: P takes a free port
//   with the pad, Escape gives it back.
//
// The screen shows one player's view for everyone (the trait's `player`,
// for a machine with a view per player: Doom), and its sound is that
// player's mix: a screen is a thing in the world, and everyone at it sees
// and hears the same.
//
// Starting is patient (start.js): a session nobody has written yet, or
// content still syncing, is asked for again on the stage's time, so a view
// that fails or leaves while making the session never strands the object.
//
// It lays out what is dropped: a machine doc anywhere is a new cabinet; a
// ROM or an IWAD dropped on a cabinet with no game yet is that cabinet's
// game (the scene:part, part.js, puts in an empty one).

import { Screen, ASPECT, viewOf } from "../present/screen.js";
import { listen, place, screenPanner } from "../present/sound.js";
import { speaker } from "../present/speaker.js";
import { WASM, MUSIC, bytes, load, portsOf, newSession, doomWads, gameOf } from "../patchwork/load.js";
import { pad, KEYS } from "../patchwork/input.js";
import { runMachine } from "./running.js";
import { retrying, makeSession } from "./start.js";
import { screenOf } from "./cabinet.js";
import { seatId, portOfSeat, seatsFor, placesFor, seatedPorts, follow, portToPlay } from "./seating.js";

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

/** The seats owner's `lay(d, seats)`, found by what its plugin says it is (`roster: true`), or null where nothing owns seats. */
async function findLay(registry) {
  const reg = await Promise.resolve(registry?.("scene:extension")).catch(() => null);
  for (const p of reg?.filter?.(() => true) ?? []) {
    if (p?.roster !== true || typeof p.id !== "string") continue;
    const loaded = await Promise.resolve(reg.load(p.id)).catch(() => null);
    const mod = loaded?.module?.default ?? loaded?.module;
    if (typeof mod?.lay === "function") return mod.lay;
  }
  return null;
}

/** The roster the seats owner contributes (seats/README.md, "Conventions"), or null. */
const rosterIn = (api) => api.collect("roster").find((c) => typeof c.value?.seats === "function")?.value ?? null;

const made = async (repo, value) => (repo.create2 ? await repo.create2(value) : repo.create(value));

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

  // ---- sound: one AudioContext for this view, made with the first machine
  // to run; the browser lets it play once the viewer has pressed something
  let audio = null;
  const hearing = () => {
    if (audio === null) {
      try {
        audio = new AudioContext();
      } catch {
        audio = false; // no WebAudio here: machines play silently
      }
    }
    return audio || null;
  };
  const wake = () => {
    if (audio && audio.state === "suspended") audio.resume().catch(() => {});
  };
  api.listen(api.root, "pointerdown", wake, { capture: true });
  api.listen(api.root, "keydown", wake, { capture: true });

  const traitOf = (id) => api.scene().objects?.[id]?.traits?.[TRAIT] ?? null;

  function entry(id, o) {
    const e = { id, url: o.sourceUrl, session: o.traits[TRAIT].session ?? null, note: "Starting…", m: null, screen: null, mesh: null, view: null, pad: null, sound: null, kind: null, title: null, ports: 1, gone: false, stop: null };
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
    if (!e.kind || !doc.content) return say("No game yet: drop a ROM or an IWAD on it, or choose one in the Machine tool"), false;
    if (!api.writable()) return say("A machine plays only where the scene can be written"), false;
    if (!e.session) {
      const done = await makeSession(sessionMaker(e, doc));
      if (!done) say("Starting…"); // another view is making it: it may fail or leave
      return done;
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
    // its sound, out of a panner at the screen (the picture doesn't wait for it)
    const ctx = hearing();
    if (ctx) {
      const panner = screenPanner(ctx);
      panner.connect(ctx.destination);
      e.sound = { panner, out: null };
      const musicWasm = e.kind === "doom" ? await bytes(MUSIC).catch(() => null) : null;
      const out = await speaker(ctx, { kind: e.kind, wads: e.kind === "doom" ? doomWads(content) : [], musicWasm, out: panner, port: playerOf(e.kind, traitOf(e.id)?.player, e.ports) });
      if (e.gone) out.close();
      else e.sound.out = out;
    }
    return true;
  }

  // A copy of a machine object, or one just laid out, has no session yet:
  // the view holding the object's claim makes one (on the scene's world
  // time, so its tick 0 is now) and writes it on the trait, laying a seat
  // per port in the same change where something here owns seats; every view
  // then opens it (start.js).
  const sessionMaker = (e, doc) => {
    let seats = null;
    let lay = null;
    return {
      claim: () => api.claim(e.id, "machine.session"),
      has: () => e.gone || !!traitOf(e.id)?.session,
      content: async () => {
        const b = (await api.repo.find(doc.content)).doc()?.bytes;
        return b?.length ? new Uint8Array(b) : null;
      },
      create: async (content) => {
        lay = await findLay(api.registry);
        seats = seatsFor(e.id, { title: e.title, ports: portsOf(e.kind, content), screen: screenOf(e.kind) });
        return (await newSession(api.repo, { kind: e.kind, wasm: await bytes(WASM[e.kind]), content, wall: api.clock.t() * 1000 })).url;
      },
      write: (url) =>
        api.change((d) => {
          const t = d.objects?.[e.id]?.traits?.[TRAIT];
          if (!t || t.session) return;
          t.session = url;
          lay?.(d, seats);
        }),
    };
  };

  function close(e) {
    e.gone = true;
    e.stop?.();
    if (held?.id === e.id) held.put();
    machines.delete(e.id);
    e.mesh?.removeFromParent();
    e.mesh?.material.dispose();
    e.screen?.dispose();
    e.sound?.out?.close();
    e.sound?.panner.disconnect();
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

  // ---- the seats: which port this view sits at, per machine

  /** The seats laid in this snapshot, and the seat this view sits in now (the roster's); none where nothing owns seats. */
  function seating(snap = api.scene()) {
    const roster = rosterIn(api);
    if (!roster) return { laid: new Set(), sitting: null };
    return { laid: new Set(roster.seats(snap).map((r) => r.id)), sitting: roster.sitting?.() ?? null };
  }
  /** Does machine `e` have seats here (its port 1's is laid)? */
  const seated = (e, laid) => laid.has(seatId(e.id, 0));

  // Sitting is holding: the port this view's seat names, taken (with the pad
  // in hand) when it sits down and given back when it stands up. A port
  // someone else still holds (their seat ended a moment ago, or they took it
  // by Play where there are no seats for them) is asked for again next frame.
  function followSeat(e, { laid, sitting }) {
    if (!seated(e, laid)) return;
    follow(e.m, portOfSeat(e.id, e.ports, sitting), {
      pickUp: (port) => holdPad(e, port),
      putDown: () => held?.id === e.id && held.put(),
    });
  }

  // Every frame while there are machines: step each host, show its picture
  // on its screen where its object is drawn, play its sound from there, take
  // or give back the port this view sits at, and say what's up beside it.
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
    const seats = seating();
    if (audio) hear();
    for (const e of machines.values()) {
      const screen = api.content(e.id)?.extras?.machine?.screen;
      const at = api.worldOf(e.id);
      if (at) m4.fromArray(at);
      const centre = screen && at ? new THREE.Vector3(...screen.center).applyMatrix4(m4) : null;
      if (e.m) {
        followSeat(e, seats);
        e.m.frame();
        const player = playerOf(e.kind, traitOf(e.id)?.player, e.ports);
        if (e.view?.player !== player) e.view = Object.assign(viewOf(e.m.host, { player }), { player });
        e.screen.show(e.view());
        if (screen && at) {
          screenMatrix(THREE, at, screen, e.mesh.matrix);
          e.mesh.matrixWorldNeedsUpdate = true;
          e.mesh.visible = true;
        }
        if (e.sound?.out) {
          if (centre) place(e.sound.panner, { position: centre.toArray(), forward: new THREE.Vector3(0, 0, 1).transformDirection(m4).toArray() });
          e.sound.out.port = player;
          e.sound.out.feed(e.m.host);
        } else e.m.host.output(); // taken either way, so it never piles up
      }
      const note = e.note ?? stoppedNote(e, seats);
      if (note && centre) items.push({ key: `machine:${e.id}`, text: note, position: [centre.x, centre.y - (screen.height / 2) - 0.08, centre.z], className: "machine-note" });
    }
    labels.set(items);
  }

  // This view's ears where its eye is (the top body's, else the camera's), in the stage's frame, as the screens are.
  function hear() {
    const cam = api.camera.get();
    const eye = api.body.eye();
    const forward = eye?.direction ?? cam.target.map((v, i) => v - cam.position[i]);
    listen(audio, { position: eye?.position ?? cam.position, forward, up: cam.up ?? [0, 1, 0] });
  }

  function stoppedNote(e, { laid }) {
    if (!e.m || e.m.clock.running()) return null;
    if (!api.clock.running()) return null; // the world's own pause says so already
    if (e.m.holders().some(Boolean)) return "Paused";
    return seated(e, laid) ? "Stopped while nobody plays: sit at it to play" : "Stopped while nobody plays: P to play";
  }

  // ---- the pad in hand

  /** Puts machine `e`'s pad for `port` in this view's hand. Put down (Escape), it gives the port back only where the machine has no seats: a seat holds it while you sit. */
  function holdPad(e, port) {
    const mine = { id: e.id, put: null };
    const input = {
      key: (ev) => (e.pad.key(ev.code, true), true),
      keyup: (ev) => (e.pad.key(ev.code, false), true),
      put() {
        if (held === mine) held = null;
        e.pad.clear();
        if (!seated(e, seating().laid)) e.m?.leave();
      },
    };
    held = mine;
    mine.put = api.hold({ name: `${e.title} · P${port + 1}`, keys: KEYS[e.kind] ?? [] }, input);
  }

  function play(id) {
    const e = machines.get(id);
    if (!e?.m) return;
    if (held?.id === id) return void held.put();
    const seats = seating();
    if (seated(e, seats.laid)) {
      // sitting at it: the pad back in hand (the port is the seat's)
      const port = portOfSeat(e.id, e.ports, seats.sitting);
      if (port !== null && e.m.host.seat?.port === port) holdPad(e, port);
      return;
    }
    const port = portToPlay(e.m.holders(), playerOf(e.kind, traitOf(id)?.player, e.ports));
    if (port === null || e.m.play(port) === null) return void api.notify("Every port on that machine is taken");
    holdPad(e, port);
  }

  function verbOf(target) {
    const e = target != null ? machines.get(target) : null;
    if (!e) return null;
    if (!e.m) return { label: "Play", disabled: true, title: e.note ?? "Starting…" };
    if (held?.id === target) return { label: "Put the pad down" };
    const seats = seating();
    if (seated(e, seats.laid)) {
      if (portOfSeat(e.id, e.ports, seats.sitting) === null) return { label: "Play", disabled: true, title: "Sit at one of its seats to play (F)" };
      return { label: "Pick up the pad" };
    }
    if (!e.m.holders().includes(null)) return { label: "Play", disabled: true, title: "Every port is taken" };
    return { label: "Play" };
  }

  // What P acts on: the machine looked at; looking at nothing of its own, the
  // one you sit at or hold the pad of (seated, your hands are on it wherever
  // the pointer is).
  function playing(target) {
    if (target != null) return target;
    if (held) return held.id;
    const { sitting } = seating();
    for (const e of machines.values()) if (portOfSeat(e.id, e.ports, sitting) !== null) return e.id;
    return null;
  }

  sync();

  return {
    update(scene, _local, prev) {
      if (scene !== prev?.scene) sync();
    },
    // where each port's seat is on its cabinet (seats/README.md, "Conventions"): only for seats laid
    seatPlaces(snap) {
      const { laid } = seating(snap);
      const out = [];
      for (const [id, o] of Object.entries(snap?.objects ?? {})) if (o?.traits?.[TRAIT]) out.push(...placesFor(id, seatedPorts(id, laid), laid));
      return out;
    },
    commands: [
      {
        id: "play",
        name: "Play",
        key: "p",
        reach: true,
        show: ["use", "menu"],
        state: (target) => verbOf(playing(target)),
        run: (target) => play(playing(target)),
      },
    ],
    dispose() {
      for (const e of [...machines.values()]) close(e);
      stopLoop?.();
      stopLoop = null;
      labels.set([]);
      plane.dispose();
      if (audio) audio.close().catch(() => {});
    },
  };
}

/**
 * A machine doc dropped (or pasted) in the scene: its cabinet, standing where
 * it was dropped, carrying the trait. Its session comes once it's in.
 * A ROM or an IWAD (a file doc) dropped on a cabinet with no game yet: that
 * cabinet's game, written on its machine doc (a game is chosen once, here or
 * in the Machine tool). Any other file is left to others.
 */
async function drop(ctx, info) {
  const type = info?.doc?.["@patchwork"]?.type;
  if (type === "file") return give(ctx, info);
  if (type !== "machine") return false;
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

/** A file dropped on a cabinet: its game, if the file makes one and the cabinet has none yet. */
export async function give(ctx, info) {
  const target = info.at?.hitId ?? null;
  const o = target != null ? ctx.scene().objects?.[target] : null;
  if (!o?.traits?.[TRAIT] || !o.sourceUrl) return false;
  const raw = info.doc.content;
  const game = gameOf(info.doc.name ?? "", raw instanceof Uint8Array ? raw : new Uint8Array(raw ?? []));
  if (!game) return false;
  const machine = await ctx.repo.find(o.sourceUrl);
  if (machine.doc()?.kind) {
    ctx.notify?.("That machine already has a game: put in another cabinet (Parts) for this one");
    return true;
  }
  const c = await made(ctx.repo, { title: game.title, bytes: game.content });
  machine.change((d) => {
    if (d.kind) return;
    d.kind = game.kind;
    d.content = c.url;
    d.title = game.title;
  });
  return true;
}

export default { create, drop };
