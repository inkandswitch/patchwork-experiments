// What both of this package's views need before they can run a machine: the
// session, the content it boots and the engine it names, all checked against
// the session. Docs and files arrive by sync and may not all be here yet when
// a viewer opens a machine: keep asking, and say what we're waiting for,
// rather than fail on the first timeout.
import { identify } from "../engine.js";

export const WASM = {
  doom: new URL("../../engines/doom/dist/doom.wasm", import.meta.url),
  snes: new URL("../../engines/snes/dist/snes.wasm", import.meta.url),
};

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
