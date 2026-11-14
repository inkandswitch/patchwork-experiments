// The kept hull, in headless Chrome, with a real Rhino model: link it (one
// conversion, then a stash), reopen (no load of the original, no
// conversion), flip the bow and drop a part (neither needs the original),
// add a part the stash lacks (one read, a new stash), Re-read (the same),
// and a case without a stash (read, nothing written; Keep writes one).
//
//   node probes/stash-run.mjs [--model ~/Dev/jims-boats/37 ft Daysailor for PVH.3dm]
//
// Needs ../model-viewer (its .3dm reader) and network for its rhino3dm.
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const MODEL = resolve(arg("--model", `${homedir()}/Dev/jims-boats/37 ft Daysailor for PVH.3dm`));
const b = await browser({
  root: PKG, port: 4805, cdp: 9805, page: "/probes/ui-probe.html", width: 1300, height: 950, timeout: 600_000,
  mounts: { "/hulls/": resolve(PKG, "../naval/src/test/fixtures/camber"), "/model/": dirname(MODEL), "/mv/": resolve(PKG, "../model-viewer") },
});
const P = (e) => b.js(`window.__p.${e}`);
const list = checklist();
const { check } = list;
const ready = async (re = /built by|kept with the case/) => {
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const c = (await P("hullChip()")) ?? "";
    if (re.test(c) && (await P("figures()")).length > 5) return c;
  }
  return (await P("hullChip()")) ?? "";
};
const settle = () => sleep(1500);
const lwl = async () => (await P("figures()")).find((r) => r[0] === "Length, waterline")?.[1];

await b.waitFor("window.__ready === true", 20000, 60);
await P("setup()");
await b.waitFor("window.__p.figures().length > 5", 20000, 60);
await P("countFinds()");
await b.js(`import("/mv/source.js").then((m) => m.loadRhino()).then(() => true)`);
const file = await P(`linkFile({ path: "/model/${encodeURIComponent(basename(MODEL))}", name: ${JSON.stringify(basename(MODEL))}, ext: "3dm", plugins: "/mv/index.js", viaUi: true })`);
const reads = async () => ({ finds: (await P("finds"))?.[file] ?? 0, builds: (await P("builds")) ?? 0 });

// 1. link: one conversion, then the hull is kept
await ready();
await settle();
const link1 = await P("hullLink()");
const r1 = await reads();
const LWL = await lwl();
check("linking reads the model once and keeps its hull with the case", r1.builds === 1 && typeof link1?.stash === "string", { r1, link1 });

// 2. reopen: a fresh tool reads only the stash
await b.js("window.__p.finds = {}; window.__p.builds = 0; true");
await P("remount()");
const chip2 = await ready(/kept with the case/);
await settle();
const r2 = await reads();
check("reopening reads only the kept hull: the original isn't loaded, nothing is converted", r2.finds === 0 && r2.builds === 0 && /kept with the case/.test(chip2), { r2, chip2 });
check("and measures it the same", (await lwl()) === LWL, { before: LWL, after: await lwl() });

// 3. the bow, and 4. dropping a part: neither needs the original
await P(`change("d.hull.bow = '-x'")`);
await settle();
const kept = (await P("hullLink()")).stash;
const someParts = await b.js(`[...document.querySelectorAll(".hull-parts input[data-part]:checked")].map((x) => x.dataset.part)`);
await P(`change(${JSON.stringify(`d.hull.parts = ${JSON.stringify(someParts.slice(0, -1))}`)})`);
await settle();
const r34 = await reads();
check("turning the bow and dropping a part read nothing and keep the same stash", r34.finds === 0 && r34.builds === 0 && (await P("hullLink()")).stash === kept, { r34, dropped: someParts.at(-1) });

// 5. a part the stash doesn't hold: one read, a new stash
const all = await b.js(`[...document.querySelectorAll(".hull-parts input[data-part]")].map((x) => x.dataset.part)`);
const extra = all.find((n) => !someParts.includes(n) && !/water/i.test(n));
await P(`change(${JSON.stringify(`d.hull.parts = ${JSON.stringify([...someParts, extra])}`)})`);
await ready(/built by/);
await settle();
const r5 = await reads();
const link5 = await P("hullLink()");
check("adding a part the stash lacks reads the model once and keeps a new stash", r5.builds === 1 && link5.stash && link5.stash !== kept, { r5, extra, stash: link5.stash });

// 6. Re-read
await P("remount()");
await ready(/kept with the case/);
await b.js("window.__p.builds = 0; true");
check("Re-read is offered", await P(`click(".openfoam .hull-reread")`));
await ready(/built by/);
await settle();
const link6 = await P("hullLink()");
check("Re-read reads the model once and keeps it again", (await P("builds")) === 1 && link6.stash !== link5.stash, { builds: await P("builds") });

// 7. a case with no stash: read, nothing written on open; Keep writes one
await P(`change("delete d.hull.stash")`);
await b.js("window.__p.builds = 0; true");
await P("remount()");
await ready(/built by/);
await settle();
const link7 = await P("hullLink()");
check("a case without a kept hull reads the model on open and writes nothing", (await P("builds")) === 1 && !link7.stash, link7);
check("and offers to keep it", await P(`click(".openfoam .hull-keep")`));
await settle();
check("Keep keeps it", typeof (await P("hullLink()")).stash === "string");
check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
console.log(JSON.stringify({ checks: list.checks, details: list.details }, null, 1));
b.stop(list.failed ? 1 : 0);
