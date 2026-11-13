// Publishes example machines to the sync server: Freedoom's E1M1 (co-op, up
// to four) and Unarmed (SNES, up to four). Each is three docs: the content
// (the IWAD with its start arguments, or the ROM), the host's session, and
// the machine doc that names them and suggests this package.
//
//   node probes/publish-machines.mjs [--sync wss://…] [--settle 8000]
//
// Needs engines/doom/test/freedoom1.wad (sh engines/doom/test/fetch-freedoom.sh)
// and this package pushworked (.pushwork/config.json names its url).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../src/host/host.js";
import { content as doomContent } from "../src/doom.js";
import { CHECKPOINT_SECONDS } from "../src/patchwork/datatype.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("sync", process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com");
const pkg = JSON.parse(readFileSync(join(root, ".pushwork/config.json"), "utf8")).rootUrl;
const read = (p) => new Uint8Array(readFileSync(join(root, p)));

const EXAMPLES = [
  {
    title: "Doom · Freedoom E1M1 · co-op",
    kind: "doom",
    content: () => doomContent({ wads: [read("engines/doom/test/freedoom1.wad")], args: ["-skill", "3", "-warp", "1", "1", "-players", "4"] }),
    contentTitle: "freedoom1.wad · E1M1 · 4p",
  },
  {
    title: "Super Nintendo · Unarmed",
    kind: "snes",
    content: () => read("engines/snes/test/unarmed.sfc"),
    contentTitle: "unarmed.sfc",
  },
];

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
console.log(`connected to ${SYNC}; package ${pkg}`);
const made = [];
for (const ex of EXAMPLES) {
  const wasm = read(`engines/${ex.kind}/dist/${ex.kind}.wasm`);
  const content = ex.content();
  const c = await repo.create2({ title: ex.contentTitle, bytes: content });
  const session = await createSession(repo, { wasm, content, seconds: { every: CHECKPOINT_SECONDS[ex.kind] } });
  // Time starts stopped: it runs while someone holds a port.
  session.change((d) => void (d.clock = { t: 0, at: Date.now(), until: 0 }));
  const m = await repo.create2({
    "@patchwork": { type: "machine", suggestedImportUrl: pkg },
    title: ex.title,
    kind: ex.kind,
    content: c.url,
    session: session.url,
  });
  made.push({ title: ex.title, machine: m.url, content: c.url, session: session.url, bytes: content.length });
}
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(arg("settle", 8000))));

const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
let bad = 0;
for (const m of made) {
  for (const [what, url] of Object.entries({ machine: m.machine, session: m.session, content: m.content })) {
    try {
      const d = (await within(120000, checker.find(url))).doc();
      const ok = what === "content" ? d?.bytes?.length === m.bytes : what === "session" ? !!d?.engine?.genesis : d?.["@patchwork"]?.type === "machine";
      if (!ok) throw new Error("came back wrong");
    } catch (e) {
      bad++;
      console.error(`  ${m.title}: ${what} ${url}: ${e.message}`);
    }
  }
  console.log(`${m.title}\n  https://patchwork.inkandswitch.com/#doc=${m.machine}`);
}
console.log(bad ? `${bad} docs did not come back` : "every doc came back from a fresh repo");
process.exit(bad ? 1 : 0);
