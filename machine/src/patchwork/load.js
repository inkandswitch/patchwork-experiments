// What both of this package's views need before they can run a machine: the
// session, the content it boots and the engine it names, all checked against
// the session. Docs and files arrive by sync and may not all be here yet when
// a viewer opens a machine: keep asking, and say what we're waiting for,
// rather than fail on the first timeout.
import { identify } from "../engine.js";
import { content as doomContent, lumps } from "../doom.js";
import { createSession } from "../host/host.js";
import { CHECKPOINT_SECONDS } from "./datatype.js";

export const WASM = {
  doom: new URL("../../engines/doom/dist/doom.wasm", import.meta.url),
  snes: new URL("../../engines/snes/dist/snes.wasm", import.meta.url),
};
/** Doom's music player (doom-music.js). */
export const MUSIC = new URL("../../engines/doom/dist/music.wasm", import.meta.url);

export const bytes = async (url, init) => {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url.pathname?.split("/").pop() ?? url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function patiently(what, say, f, { tries = 12, wait = 2500 } = {}) {
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

/** { session (handle), content, wasm } for a machine doc, checked. */
export async function load(repo, doc, say) {
  say("Fetching the game…");
  const session = await patiently("Fetching the session", say, () => repo.find(doc.session));
  const want = session.doc().engine;
  say("Fetching what it runs…");
  const content = await patiently("Fetching what it runs", say, async () => {
    const b = (await repo.find(doc.content)).doc()?.bytes;
    if (!b?.length) throw new Error("not here yet");
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    if ((await identify(new Uint8Array(), u)).content !== want.content) throw new Error("not all here yet");
    return u;
  });
  // The engine is a file of this package: until sync has all of it, what
  // comes back isn't the engine the session names. Ask again, bypassing caches.
  say("Fetching the engine…");
  const wasm = await patiently("Fetching the engine", say, async () => {
    const w = await bytes(WASM[doc.kind], { cache: "reload" });
    if ((await identify(w)).engine !== want.wasm) throw new Error("not the session's engine yet");
    return w;
  });
  return { session, content, wasm };
}

// Doom's content records (doom.js content()): u32 length + bytes, the first
// the start arguments, then the WADs.
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
export const doomArgs = (b) => new TextDecoder().decode(records(b)[0]).split("\0").filter(Boolean);
export const doomWads = (b) => records(b).slice(1);

/**
 * The game a file makes, or null: a Super NES ROM (.sfc, .smc) is its own
 * content; an IWAD (.wad, "IWAD") boots Doom at its first map (E1M1, or
 * MAP01 for a game without episodes), with `players` ports at `skill`.
 * Anything else (a PWAD alone, another file) makes none. Pure.
 * @returns {{ kind: "doom" | "snes", title: string, content: Uint8Array } | null}
 */
export function gameOf(name, raw, { players = 4, skill = 3 } = {}) {
  const ext = /\.([^.]+)$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
  const base = (name ?? "").replace(/\.[^.]+$/, "") || "Game";
  if (ext === "sfc" || ext === "smc") return raw?.length ? { kind: "snes", title: base, content: raw } : null;
  if (ext !== "wad" || raw?.length < 12 || new TextDecoder().decode(raw.subarray(0, 4)) !== "IWAD") return null;
  const episodic = lumps(raw).has("E1M1");
  const args = ["-skill", String(skill), "-warp", ...(episodic ? ["1", "1"] : ["1"]), "-players", String(players)];
  return { kind: "doom", title: `${base} · ${episodic ? "E1M1" : "MAP01"} · ${players}p`, content: doomContent({ wads: [raw], args }) };
}

/** How many ports people can play: Doom's from its start arguments, the Super NES's four through its multitap. */
export function portsOf(kind, content) {
  if (kind !== "doom") return 4;
  const args = doomArgs(content);
  return +(args[args.indexOf("-players") + 1] ?? 1);
}

/**
 * A new session for a machine, its time stopped at 0 (it runs while someone
 * holds a port: quiet.js). `wall` is the shared time its clock is measured
 * in, ms: the wall for the Machine tool, world time in a scene.
 */
export async function newSession(repo, { kind, wasm, content, wall }) {
  const every = CHECKPOINT_SECONDS[kind];
  const session = await createSession(repo, { wasm, content, wall, seconds: every ? { every } : {} });
  session.change((d) => void (d.clock = { t: 0, at: wall, until: 0 }));
  return session;
}
