// The Machine tool: an existing game, run as a deterministic engine that
// every viewer steps from a shared input log (../host). Pick a port to play;
// everyone else watches the same game.
import { compile, identify } from "../engine.js";
import { createSession, Host } from "../host/host.js";
import { seating } from "../host/session.js";
import { content as doomContent, lumps } from "../doom.js";
import { inputs, HELP } from "./input.js";
import { audio } from "./audio.js";
import css from "./tool.css?inline";

const WASM = {
  doom: new URL("../../engines/doom/dist/doom.wasm", import.meta.url),
  snes: new URL("../../engines/snes/dist/snes.wasm", import.meta.url),
};
const MUSIC = new URL("../../engines/doom/dist/music.wasm", import.meta.url);
const bytes = async (url, init) => {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url.pathname?.split("/").pop() ?? url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Docs and files arrive by sync and may not all be here yet when a viewer
// opens a machine: keep asking, and say what we're waiting for, rather than
// fail on the first timeout.
async function patiently(what, say, f, { tries = 12, wait = 2500 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw new Error(`${what}: ${e.message ?? e}`);
      say(`${what}… (still waiting, try ${i + 1})`);
      await sleep(wait);
    }
  }
}
const create = async (repo, value) => (repo.create2 ? await repo.create2(value) : repo.create(value));

// Content records (doom.js content()): u32 length + bytes, the first the
// start arguments, then the WADs.
function records(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  for (let at = 0; at + 4 <= b.length; ) {
    const n = v.getUint32(at, true);
    out.push(b.subarray(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}
const doomArgs = (b) => new TextDecoder().decode(records(b)[0]).split("\0").filter(Boolean);
const doomWads = (b) => records(b).slice(1);

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat().filter((k) => k != null));
  return e;
};

export default function MachineTool(handle, element) {
  const repo = window.repo;
  const style = el("style");
  style.textContent = css;
  const root = el("div", { class: "machine-tool", tabindex: "0" });
  element.append(style, root);
  let disposed = false;
  let stop = () => {};

  const show = async () => {
    stop();
    stop = () => {};
    root.replaceChildren();
    const doc = handle.doc();
    if (!doc?.session) stop = setup(doc);
    else {
      root.append(el("p", { class: "note" }, "Loading the game…"));
      try {
        stop = await play(doc);
      } catch (e) {
        root.replaceChildren(el("p", { class: "note", "data-error": true }, String(e.message ?? e)));
      }
    }
  };

  // ---- making a machine: an engine and what it boots
  function setup() {
    const status = el("p", { class: "note" });
    const make = async (kind, file, opts) => {
      status.textContent = "Starting…";
      try {
        const raw = new Uint8Array(await file.arrayBuffer());
        let content = raw;
        let title = file.name.replace(/\.[^.]+$/, "");
        if (kind === "doom") {
          const episodic = lumps(raw).has("E1M1");
          const args = ["-skill", String(opts.skill), "-warp", ...(episodic ? ["1", "1"] : ["1"]), "-players", String(opts.players)];
          content = doomContent({ wads: [raw], args });
          title = `${title} · ${episodic ? "E1M1" : "MAP01"} · ${opts.players}p`;
        }
        const wasm = await bytes(WASM[kind]);
        await compile(wasm); // refuses a broken engine before anything is written
        const c = await create(repo, { title, bytes: content });
        const session = await createSession(repo, { wasm, content });
        // Time starts stopped: it runs while someone holds a port.
        session.change((d) => void (d.clock = { t: 0, at: Date.now(), until: 0 }));
        handle.change((d) => {
          d.kind = kind;
          d.content = c.url;
          d.session = session.url;
          d.title = title;
        });
      } catch (e) {
        status.textContent = `Couldn't start it: ${e.message ?? e}`;
      }
    };
    const players = el("select", {}, ...[1, 2, 3, 4].map((n) => el("option", { value: n, selected: n === 2 }, `${n} players`)));
    const skill = el("select", {}, ...["I'm too young to die", "Hey, not too rough", "Hurt me plenty", "Ultra-Violence", "Nightmare!"].map((s, i) => el("option", { value: i + 1, selected: i === 2 }, s)));
    const pick = (kind, accept) =>
      el("input", { type: "file", accept, onchange: (e) => e.target.files[0] && make(kind, e.target.files[0], { players: +players.value, skill: +skill.value }) });
    root.append(
      el("h2", {}, "A machine"),
      el("p", { class: "note" }, "An existing game, run as is, in step for everyone here. Choose what it runs."),
      el("section", { class: "card" }, el("h3", {}, "Doom"), el("p", {}, "An IWAD: Freedoom's freedoom1.wad or freedoom2.wad, or Doom's own."), el("div", { class: "row" }, players, skill), pick("doom", ".wad,.WAD")),
      el("section", { class: "card" }, el("h3", {}, "Super Nintendo"), el("p", {}, "A ROM (.sfc or .smc). Up to four players through a multitap."), pick("snes", ".sfc,.smc,.SFC,.SMC")),
      status,
    );
    return () => {};
  }

  // ---- playing
  async function play(doc) {
    const kind = doc.kind;
    const note = root.querySelector(".note");
    const say = (t) => note && (note.textContent = t);
    say("Fetching the game…");
    const session = await patiently("Fetching the session", say, () => repo.find(doc.session));
    const want = session.doc().engine;
    say("Fetching what it runs…");
    const contentBytes = await patiently("Fetching what it runs", say, async () => {
      const b = (await repo.find(doc.content)).doc()?.bytes;
      if (!b?.length) throw new Error("not here yet");
      const u = b instanceof Uint8Array ? b : new Uint8Array(b);
      if ((await identify(new Uint8Array(), u)).content !== want.content) throw new Error("not all here yet");
      return u;
    });
    // The engine is a file of this package: until sync has all of it, what
    // comes back isn't the engine the session names. Ask again, bypassing caches.
    say("Fetching the engine…");
    const wasm = await patiently("Fetching the engine", say, async (i) => {
      const w = await bytes(WASM[kind], { cache: "reload" });
      if ((await identify(w)).engine !== want.wasm) throw new Error("not the session's engine yet");
      return w;
    });
    say("Joining the session…");
    const me = await name();
    let mine = () => input.sample();
    const host = await Host.open(repo, doc.session, { wasm, content: contentBytes, by: me, input: () => mine() });
    const engine = host.engine;
    const [num, den] = session.doc().engine.hz;
    const hz = num / den;
    const ports = kind === "doom" ? +(doomArgs(contentBytes)[doomArgs(contentBytes).indexOf("-players") + 1] ?? 1) : 4;
    const input = inputs(kind, root, engine.inputBytes);
    let watching = 0;
    let sound = null;

    // Nobody holds a port: time stands still where the last player left it,
    // so nobody comes back to hours of an empty world to catch up on.
    const quiet = () => {
      const s = session.doc();
      const held = seating(s.seats, ports).some((p) => p.at(-1)?.until === Infinity);
      const c = s.clock;
      if (!held && c.until === undefined) {
        const last = Math.max(0, ...Object.values(s.seats ?? {}).map((x) => (x.until ?? 0) / hz));
        session.change((d) => void (d.clock = { t: last, at: Date.now(), until: last }));
      }
    };
    quiet();

    // the view
    const canvas = el("canvas", { class: "screen", "data-kind": kind });
    const g = canvas.getContext("2d");
    const seats = el("div", { class: "seats" });
    const info = el("span", { class: "info" });
    const soundBtn = el("button", { class: "sound", onclick: async () => {
      if (!sound) {
        soundBtn.disabled = true;
        const wads = kind === "doom" ? doomWads(contentBytes) : [];
        sound = await audio({ kind, wads, musicWasm: kind === "doom" ? await bytes(MUSIC) : null });
        soundBtn.remove();
      }
      await sound.resume();
    } }, "🔊 Sound");
    const pause = el("button", { onclick: () => (host.clock?.running?.() ? host.pause() : host.resume()) }, "⏸ Pause");
    const stopped = el("div", { class: "stopped" });
    root.replaceChildren(
      el("header", {}, el("strong", {}, doc.title ?? "Machine"), seats, el("span", { class: "grow" }), soundBtn, pause),
      el("div", { class: "stage" }, canvas, stopped),
      el("footer", {}, el("span", { class: "help" }, HELP[kind]), info),
    );
    canvas.addEventListener("click", () => {
      root.focus();
      if (kind === "doom" && host.seat) canvas.requestPointerLock?.();
    });

    const holders = () => {
      const s = session.doc();
      return seating(s.seats, ports).map((p) => {
        const last = p.at(-1);
        return last && last.until === Infinity ? { id: last.id, by: s.seats[last.id]?.by ?? "someone" } : null;
      });
    };
    let seatsKey = "";
    const drawSeats = () => {
      const h = holders();
      const key = JSON.stringify([h, host.seat?.port, watching]);
      if (key === seatsKey) return;
      seatsKey = key;
      seats.replaceChildren(
        ...h.map((x, port) => {
          const mineHere = host.seat?.port === port;
          const label = mineHere ? `P${port + 1}: you — leave` : x ? `P${port + 1}: ${x.by}` : `P${port + 1}: play`;
          return el("button", {
            "data-mine": mineHere, "data-taken": !!x && !mineHere, "data-watching": !host.seat && watching === port,
            onclick: () => {
              if (mineHere) {
                host.stand();
                if (!holders().some(Boolean)) host.pause();
              } else if (x) watching = port;
              else {
                if (host.seat) host.stand();
                if (!host.clock?.running?.()) host.resume();
                host.sit(port);
                watching = port;
                root.focus();
              }
              drawSeats();
            },
          }, label);
        }),
      );
    };

    let raf = 0, image = null, lastInfo = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      try {
        host.frame();
      } catch (e) {
        info.textContent = `error: ${e.message}`;
      }
      const view = kind === "doom" ? (host.seat?.port ?? watching) : 0;
      const pic = host.picture(view);
      if (pic && pic.width) {
        if (canvas.width !== pic.width || canvas.height !== pic.height) {
          canvas.width = pic.width;
          canvas.height = pic.height;
          image = null;
        }
        image ??= new ImageData(pic.width, pic.height);
        image.data.set(pic.rgba);
        g.putImageData(image, 0, 0);
      }
      const out = host.output();
      if (sound) sound.play(out, host.engine, view, hz);
      drawSeats();
      const now = performance.now();
      if (now - lastInfo > 500) {
        lastInfo = now;
        const s = host.status, st = host.stats ?? {};
        const running = host.clock?.running?.();
        pause.textContent = running ? "⏸ Pause" : "▶ Resume";
        const anyone = holders().some(Boolean);
        stopped.hidden = !!running;
        stopped.textContent = anyone ? "Paused" : "Stopped while nobody plays: take a port above (P1: play) to start";
        info.textContent = [
          `tick ${host.tick}`,
          host.loading ? "catching up…" : null,
          st.rewinds ? `${st.rewinds} rollbacks` : null,
          s.fault ? `engine fault at ${s.fault.tick}` : null,
          s.desync?.length ? "out of step!" : null,
        ].filter(Boolean).join(" · ");
      }
    };
    loop();
    root.focus();

    return () => {
      cancelAnimationFrame(raf);
      if (host.seat) {
        host.stand();
        if (!holders().some(Boolean)) host.pause();
      }
      host.close();
      input.dispose();
      sound?.close();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }

  async function name() {
    try {
      const c = window.accountDocHandle?.doc()?.contactUrl;
      return (c && (await repo.find(c)).doc()?.name) || "someone";
    } catch {
      return "someone";
    }
  }

  let last = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
  const onChange = () => {
    const now = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
    if (now !== last) {
      last = now;
      show();
    }
  };
  handle.on("change", onChange);
  show();

  return () => {
    disposed = true;
    handle.off("change", onChange);
    stop();
    root.remove();
    style.remove();
  };
}
