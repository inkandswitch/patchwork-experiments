// scene:extension "machine": a machine as an object in a scene, built only
// from the scene's extension contract (scene/STAGE.md).
//
// The object's source (`sourceUrl`) is a machine doc (its kind, and the content it boots)
// and its content is the cabinet scene:source "machine" builds; its trait,
// `machine`, holds the session this object runs and the source it was made
// for (`source`), so the object is one running machine and a copy is
// another (both are runtime: a copy starts without them, and the first view
// able to makes a new session). A session made for another source than the
// object's (its source changed: a game given at once by two views, the
// merge keeping the other) is no session of this object's: a new one is
// made, for the source it has.
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
//   laid on the object, not lasting, when its session is made, and listed
//   by port on the trait (`seats`): sitting in port N's seat takes port N
//   and puts its pad in your hand; standing up gives the port back. Play
//   (a click on the cabinet, P, the use prompt, the menu) is the way in: it
//   sits you at the first free port's seat, through the seats' roster. A
//   click is Play's only while you hold no pad and sit nowhere (hands.js
//   `clicks`); holding the editor, its click selects first. Escape puts the pad down
//   (the port stays yours while you sit); P picks it up. A machine whose
//   trait lists no seats is played by Play alone: P takes a free port with
//   the pad, Escape gives it back;
// - while you hold a pad, shows what its keys do (controls.js), at the top
//   left of the view, folding to its title after a few seconds;
// - never shows a stopped machine's screen black: a blank picture there is
//   replaced by the engine's first picture from that state (present/poster.js,
//   shown.js), with the stopped note under the screen saying how to play it.
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
// game, a machine doc of its own (the scene:part, part.js, puts in an empty
// cabinet).

import { Screen, ASPECT, viewOf } from "../present/screen.js";
import { posters } from "../present/poster.js";
import { compile } from "../engine.js";
import { doomWorld, mapOf } from "../present/doom-world.js";
import { Spectator } from "../present/spectator.js";
import { QUERY, level as decodeLevel } from "../doom.js";
import { listen, place, screenPanner } from "../present/sound.js";
import { speaker } from "../present/speaker.js";
import { WASM, MUSIC, bytes, load, portsOf, newSession, doomWads, gameOf } from "../patchwork/load.js";
import { pad } from "../patchwork/input.js";
import { runMachine } from "./running.js";
import { retrying, makeSession } from "./start.js";
import { screenOf } from "./cabinet.js";
import { seatsFor, placesFor } from "./seating.js";
import { hands } from "./hands.js";
import { panel as controlsPanel } from "./controls.js";
import { screenShows, stoppedNote } from "./shown.js";
import { WORLD, MAP_SOURCE, registered, worldCommand, stateOf, besideCabinet, wadFile } from "./worlds.js";

export const TRAIT = "machine";
export const PROVIDER = "machine";
/** ms between tries at starting a machine that couldn't start yet (the stage's time). */
export const RETRY_MS = 2000;
/** How far ahead (s of the engine's ticks) a stopped screen with a blank picture looks for one (present/poster.js). */
export const POSTER_SECONDS = 2;

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

/** The session of a machine object's trait, if it was made for the source the object has now; else null (none yet, or another game's). */
export const sessionOf = (o) => {
  const t = o?.traits?.[TRAIT];
  return t?.session && t.source && t.source === o.sourceUrl ? t.session : null;
};

const made = async (repo, value) => (repo.create2 ? await repo.create2(value) : repo.create(value));

function create(api) {
  const { THREE } = api;
  const clock = api.use("clock");
  const claims = api.use("claims");
  const layer = api.world();
  layer.name = "machine.screens";
  layer.userData.noPick = true;
  const labels = api.labels();
  const plane = new THREE.PlaneGeometry(1, 1);
  const machines = new Map(); // object id → entry
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

  const traitOf = (id, trait = TRAIT) => (id == null ? null : (api.scene().objects?.[id]?.traits?.[trait] ?? null));
  /** The seat of each port that machine `id` laid, by port (its trait's), or null: a machine played by Play. */
  const seatsOfMachine = (id, snap = api.scene()) => {
    const s = snap.objects?.[id]?.traits?.[TRAIT]?.seats;
    return Array.isArray(s) && s.length ? s : null;
  };

  function entry(id, o) {
    const e = { id, url: o.sourceUrl, session: sessionOf(o), note: "Starting…", m: null, content: null, screen: null, mesh: null, view: null, last: null, poster: null, pad: null, sound: null, kind: null, title: null, ports: 1, gone: false, stop: null };
    machines.set(id, e);
    e.stop = retrying({
      attempt: () => open(e),
      after: (ms, fn) => api.after(ms, fn),
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
      world: clock,
      now: () => api.now(),
      writable: () => api.writable(),
      by: api.channel.viewer ?? null,
      input: () => e.pad.sample(),
    });
    if (e.gone) return m.close(), true;
    e.m = m;
    e.content = content;
    // a stopped screen's poster: the engine's first picture from the state it stopped in, on an engine of its own
    let compiled = null;
    const [num, den] = session.doc().engine.hz;
    e.poster = posters({ make: async () => (compiled ??= await compile(wasm)).boot(content), vacant: session.doc().vacant, max: Math.ceil((POSTER_SECONDS * num) / den) });
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

  // A copy of a machine object, or one just laid out or given a game, has no
  // session for its source yet: the view holding the object's claim makes
  // one (on the scene's world time, so its tick 0 is now) and writes it on
  // the trait with the source it's for, laying a seat per port on the
  // object in the same change where something here owns seats, and listing
  // them on the trait; every view then opens it (start.js).
  const sessionMaker = (e, doc) => {
    let seats = null;
    let lay = null;
    const current = () => sessionOf(api.scene().objects?.[e.id]) !== null;
    return {
      claim: () => claims.claim(e.id, "machine.session"),
      has: () => e.gone || current(),
      content: async () => {
        const b = (await api.repo.find(doc.content)).doc()?.bytes;
        return b?.length ? new Uint8Array(b) : null;
      },
      create: async (content) => {
        lay = await findLay(api.registry);
        seats = seatsFor(e.id, { title: e.title, ports: portsOf(e.kind, content), screen: screenOf(e.kind) });
        return (await newSession(api.repo, { kind: e.kind, wasm: await bytes(WASM[e.kind]), content, wall: clock.t() * 1000 })).url;
      },
      write: (url) =>
        api.change((d) => {
          const o = d.objects?.[e.id];
          const t = o?.traits?.[TRAIT];
          if (!t || o.sourceUrl !== e.url || (t.session && t.source === e.url)) return;
          t.session = url;
          t.source = e.url;
          if (lay && seats) {
            lay(d, seats, e.id);
            t.seats = Object.keys(seats);
          }
        }),
    };
  };

  function close(e) {
    e.gone = true;
    e.stop?.();
    e.poster?.dispose();
    pads.drop(e.id);
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
      if (e && e.session === sessionOf(o) && e.url === o.sourceUrl) continue;
      if (e) close(e);
      entry(id, o);
    }
    for (const [id, e] of machines) if (!objects[id]?.traits?.[TRAIT]) close(e);
    for (const id of Object.keys(objects)) if (objects[id]?.traits?.[WORLD] && !worlds.has(id)) world(id);
    for (const [id, w] of worlds) if (!objects[id]?.traits?.[WORLD]) unworld(w);
    // a world whose machine isn't here is as built (the frame loop, which draws worlds, may have stopped with it)
    for (const w of worlds.values()) if (!machines.get(traitOf(w.id, WORLD)?.machine)?.m) w.view.rest();
    loop();
  }

  // ---- the pad in hand, and the port it holds (hands.js)

  /** The seat this view sits in now, anywhere (the roster's: { of, seat }), or null: sitting nowhere, or nothing here owns seats. */
  const sitting = () => rosterIn(api)?.sitting?.() ?? null;
  const pads = hands({
    machines,
    hold: (spec, input) => api.hold(spec, input),
    sitting,
    seatsOf: (id) => seatsOfMachine(id),
    prefer: (e) => playerOf(e.kind, traitOf(e.id)?.player, e.ports),
    notify: (text) => api.use("notices")?.notify(text),
    roster: () => rosterIn(api),
  });

  // ---- what the keys do, while a pad is in hand (controls.js): this extension's
  // own overlay, at the top left, open for a few seconds and then folded to its
  // title (hovered, it opens again)
  api.style?.(CONTROLS_CSS);
  const overlay = api.overlay?.() ?? null;
  const box = overlay ? overlay.ownerDocument.createElement("div") : null;
  if (box) {
    box.className = "machine-controls";
    box.hidden = true;
    overlay.append(box);
  }
  const controlsAt = controlsPanel();
  let panelKey = null;
  /** The controls of the pad in hand, or none. */
  function showControls() {
    if (!box) return;
    const h = pads.held();
    const e = h ? machines.get(h.id) : null;
    const p = controlsAt(e ? { id: e.id, kind: e.kind, title: e.title, port: e.m?.host.seat?.port ?? null } : null, api.now()); // the stage's own time, which never pauses
    const key = p?.key ?? null;
    if (key === panelKey) return;
    panelKey = key;
    box.hidden = !p;
    if (!p) return box.replaceChildren();
    box.classList.toggle("folded", !p.open);
    const doc = box.ownerDocument;
    const el = (tag, cls, text) => Object.assign(doc.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
    const rows = el("div", "machine-controls-keys");
    for (const { label, keys } of p.rows) {
      const item = el("span", "machine-controls-key");
      for (const k of keys) item.append(el("kbd", null, k));
      item.append(el("span", null, label));
      rows.append(item);
    }
    box.replaceChildren(el("div", "machine-controls-title", `${p.title} · keys`), rows, el("div", "machine-controls-foot", "Esc puts the pad down · P picks it up"));
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
    const seat = sitting();
    if (audio) hear();
    for (const e of machines.values()) {
      const screen = api.content(e.id)?.extras?.machine?.screen;
      const at = api.worldOf(e.id);
      if (at) m4.fromArray(at);
      const centre = screen && at ? new THREE.Vector3(...screen.center).applyMatrix4(m4) : null;
      if (e.m) {
        pads.follow(e, seat);
        e.m.frame();
        const player = playerOf(e.kind, traitOf(e.id)?.player, e.ports);
        if (e.view?.player !== player) e.view = Object.assign(viewOf(e.m.host, { player }), { player });
        // stopped on a blank picture: its poster, once found (until then, what's shown stays)
        const shows = screenShows({ running: e.m.clock.running(), now: e.view(), last: e.last, poster: () => e.poster.get(e.m.host, player) });
        e.last = shows.last;
        e.screen.show(shows.show);
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
      const note = e.note ?? stoppedNote({ started: !!e.m, running: !!e.m?.clock.running(), world: clock.running(), holders: e.m?.holders() ?? [] });
      if (note && centre) items.push({ key: `machine:${e.id}`, text: note, position: [centre.x, centre.y - (screen.height / 2) - 0.08, centre.z], className: "machine-note" });
    }
    for (const w of worlds.values()) show(w);
    labels.set(items);
    showControls();
  }

  // ---- worlds: a map showing a machine's game (WORLD). Its things and doors
  // are drawn from the engine's state while the machine is a Doom that runs
  // here, the game it was laid out for, and the game is on the map's level;
  // otherwise the map is as built (every door shut, no things). worlds.js
  // decides; this draws.

  const worlds = new Map(); // map object id → { id, view: Spectator, world: doomWorld | null, e, key } (worlds.js stateOf keeps the last three)
  function world(id) {
    const w = { id, view: new Spectator({ THREE }), world: null, e: null, key: null };
    w.view.group.name = `machine.world:${id}`;
    layer.add(w.view.group);
    worlds.set(id, w);
    return w;
  }
  function unworld(w) {
    w.view.dispose();
    worlds.delete(w.id);
  }
  function show(w) {
    const trait = traitOf(w.id, WORLD);
    const c = api.content(w.id);
    const state = stateOf(w, trait, machines.get(trait?.machine), c);
    if (!state) return w.view.rest();
    w.view.draw({ world: w.world, state, frame: api.worldOf(w.id), eye: eye(), root: c.root });
  }
  /** This view's eye in the stage's frame: the top body's, else the camera's. */
  const eye = () => api.body.eye()?.position ?? api.camera.get().position;

  /**
   * Lays out the world of Doom machine `e` beside its cabinet: doom/'s whole
   * map of the level it's on (or was last on, between levels), from a WAD
   * file doc of the IWAD it runs (worlds.js wadFile: one per game), carrying
   * the trait that has this machine drawn in it (worlds.js besideCabinet
   * says where). The map's source is doom/'s, asked for by id: without the
   * doom package nothing builds it, and the command says so. Where it goes
   * is worked out before doom/ has built it, so in the frame machine's
   * doomWorld gives by default (HOST.md, Decision 36).
   */
  async function layOut(e) {
    const wads = doomWads(e.content);
    const lvl = e.m.host.query(QUERY.level);
    if (!lvl) throw new Error("its game hasn't loaded yet");
    const name = mapOf(wads, decodeLevel(lvl));
    const base = (e.title ?? "Doom").split(" · ")[0];
    const file = await wadFile(api, e, base);
    const add = await api.addObject(file, {
      providerId: MAP_SOURCE,
      name: `${name} · ${base}`,
      render: { providerId: MAP_SOURCE, params: { map: name, door: null, line: null, whole: true } },
      transform: besideCabinet(THREE, api.scene().world(e.id), doomWorld(wads, name).extent),
      fields: { traits: { [WORLD]: { machine: e.id, source: e.url } } },
    });
    api.change(add);
    api.view.select(add.id);
    return add.id;
  }

  // This view's ears where its eye is (the top body's, else the camera's), in the stage's frame, as the screens are.
  function hear() {
    const cam = api.camera.get();
    const eye = api.body.eye();
    const forward = eye?.direction ?? cam.target.map((v, i) => v - cam.position[i]);
    listen(audio, { position: eye?.position ?? cam.position, forward, up: cam.up ?? [0, 1, 0] });
  }

  // doom/'s map source, here or not now (late-bound: the registry, by id, read when asked)
  const mapSource = registered(api.registry, "scene:source", MAP_SOURCE);

  sync();

  return {
    // a click on a cabinet is Play while it's the way in (hands.js `clicks`:
    // no pad in hand, sitting nowhere), through the stage, so the verb's
    // state and reach apply as on every surface; what Play can't do there is
    // said. It reaches a cabinet as its trait's holder (STAGE.md, "The input
    // chain"), after the Edit hand's click, which selects.
    input: {
      click: (ev) => pads.click(ev.holder, () => api.run({ ext: api.id, command: "play", target: ev.holder, hit: ev.hit })),
      cursor: (ev) => (pads.clicks(ev.holder) ? "pointer" : null),
    },
    update(scene, _local, prev) {
      if (scene !== prev?.scene) sync();
    },
    // where each port's seat is on its cabinet (seats/README.md, "Conventions"): the seats its trait lists, which are the object's own
    seatPlaces(snap) {
      const out = [];
      for (const id of Object.keys(snap?.objects ?? {})) {
        const seats = seatsOfMachine(id, snap);
        if (seats) out.push(...placesFor(id, seats));
      }
      return out;
    },
    commands: [
      {
        id: "play",
        name: "Play",
        key: "p",
        reach: true,
        show: ["use", "menu"],
        state: (target) => pads.verb(target),
        run: (target) => pads.play(target),
      },
      {
        id: "world",
        name: "Lay out its world",
        show: ["menu"],
        state: (target) => worldCommand(target != null ? machines.get(target) : null, mapSource()),
        run: (target) => {
          const e = machines.get(target);
          const state = worldCommand(e, mapSource());
          if (state && !state.disabled) layOut(e).catch((err) => api.use("notices")?.notify(`Couldn't lay out its world: ${err?.message ?? err}`, "error"));
        },
      },
    ],
    dispose() {
      for (const w of [...worlds.values()]) unworld(w);
      for (const e of [...machines.values()]) close(e);
      stopLoop?.();
      stopLoop = null;
      labels.set([]);
      box?.remove();
      plane.dispose();
      if (audio) audio.close().catch(() => {});
    },
  };
}

/**
 * A machine doc dropped (or pasted) in the scene: its cabinet, standing where
 * it was dropped, carrying the trait. Its session comes once it's in.
 * A ROM or an IWAD (a file doc) dropped on a cabinet with no game yet: that
 * cabinet's game (give). Any other file, or a game file anywhere else, is
 * left to others.
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

/**
 * A file dropped on a cabinet: its game, if the file makes one and the
 * cabinet has none yet. The game is a machine doc of its own (kind, content,
 * title), its content a doc holding the bytes it boots; the cabinet's source
 * is pointed at it, one write of one key, so two views giving one cabinet a
 * game at once end with one of the two whole, never a mix. A session made
 * meanwhile for the other is for another source, and gives way (sessionOf).
 * A cabinet with a game already doesn't take it: it's left to others.
 */
export async function give(ctx, info) {
  const target = info.at?.hitId ?? null;
  const o = target != null ? ctx.scene().objects?.[target] : null;
  if (!o?.traits?.[TRAIT] || !o.sourceUrl) return false;
  const raw = info.doc.content;
  const game = gameOf(info.doc.name ?? "", raw instanceof Uint8Array ? raw : new Uint8Array(raw ?? []));
  if (!game) return false;
  if ((await ctx.repo.find(o.sourceUrl)).doc()?.kind) return false;
  const content = await made(ctx.repo, { title: game.title, bytes: game.content });
  const machine = await made(ctx.repo, { "@patchwork": { type: "machine" }, title: game.title, kind: game.kind, content: content.url });
  ctx.change((d) => {
    const t = d.objects?.[target];
    if (t?.traits?.[TRAIT] && t.sourceUrl === o.sourceUrl) t.sourceUrl = machine.url;
  });
  return true;
}

/**
 * The controls panel: compact, at the top left of the view (clear of the use
 * prompt by the look and the legends at the bottom left), in the scene's
 * label colours. Folded, it is its title alone, and opens while hovered.
 */
const CONTROLS_CSS = `
.machine-controls { position: absolute; left: 12px; top: 12px; max-width: min(340px, calc(100% - 24px)); padding: 6px 8px; border-radius: 6px;
  background: var(--scene-label-bg, rgba(255, 255, 255, 0.82)); color: var(--scene-fg, black); border: 1px solid var(--scene-border, #ddd);
  box-shadow: var(--scene-shadow, 0 2px 8px rgba(0, 0, 0, 0.12)); font: 11px/1.4 var(--scene-family, system-ui, sans-serif); }
.machine-controls[hidden] { display: none; }
.machine-controls-title { font-weight: 600; }
.machine-controls-keys { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 4px; }
.machine-controls-key { white-space: nowrap; }
.machine-controls kbd { display: inline-block; min-width: 1.3em; padding: 0 3px; margin-right: 2px; border: 1px solid var(--scene-border, #ccc); border-radius: 3px;
  font: 10px/1.45 var(--scene-family-code, ui-monospace, monospace); text-align: center; background: var(--scene-surface, #f4f4f4); }
.machine-controls-key > span { margin-left: 1px; color: var(--scene-muted, #666); }
.machine-controls-foot { margin-top: 4px; color: var(--scene-muted, #666); }
.machine-controls.folded:not(:hover) .machine-controls-keys, .machine-controls.folded:not(:hover) .machine-controls-foot { display: none; }
`;

export default { create, drop };
