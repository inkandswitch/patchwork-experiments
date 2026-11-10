// A scene's packages (STAGE.md, "Packages"), in headless Chrome.
//
//   pnpm build
//   node probes/packages-run.mjs [--port 4840] [--cdp 9840] [--show] [--shots <dir>]
//
// Opens probes/packages-probe.html: the BUILT tool on a scene whose
// doc.packages lists two packages nothing here has registered (one served,
// one whose load fails), with a third that IS registered here and unlisted.
// Then, with real clicks:
//   - the prompt: one card naming both packages, nothing imported, the
//     scene's trait extension not running and its object without a provider;
//     the registered package gets listed (reconcile), bare;
//   - Not now: the card goes, nothing is imported or remembered; opened
//     again, it asks again;
//   - Load: the served package is imported at its heads and registered under
//     its bare URL, its extension starts, its provider builds the object;
//     the other's failure is on the card and stopped nothing; only the one
//     that loaded is remembered;
//   - opened again: the remembered one loads without a click, and only the
//     other is asked about.
// Prints a JSON report and exits non-zero if any check fails.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, checklist, sleep } from "./cdp.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const PORT = Number(arg("port", 4840));
const CDP = Number(arg("cdp", 9840));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-packages-shots")));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const PAGE = "/probes/packages-probe.html";
const b = await browser({ root, port: PORT, cdp: CDP, page: `${PAGE}?fresh`, width: 1200, height: 760, show: !!arg("show", false) });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [] };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `packages-${name}.png`)));
const ready = async () => {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${JSON.stringify(await P("errors"))}`);
};
/** open the scene again: a new page, the same localStorage */
const reopen = async () => {
  await b.send("Page.navigate", { url: `http://127.0.0.1:${PORT}${PAGE}?again=${Date.now()}` });
  await sleep(300);
  await ready();
};
const click = async (action) => {
  const at = await P(`button(${JSON.stringify(action)})`);
  if (!at) throw new Error(`no ${action} button`);
  await b.mouse("mouseMoved", at.x, at.y);
  await b.mouse("mousePressed", at.x, at.y);
  await b.mouse("mouseReleased", at.x, at.y);
  await sleep(100);
};
const urls = (list) => (list ?? []).map((e) => e.url);

try {
  await ready();
  const PKG = await P("PKG");
  const BROKEN = await P("BROKEN");
  const LOCAL = await P("LOCAL");

  // ── the prompt ────────────────────────────────────────────────────────────
  {
    // not at once: the registry has to have been quiet for a moment
    const early = await P("packages()");
    const asked = await b.waitFor(`window.__p.packages().ask.length === 2 && window.__p.packages().ask.every((e) => e.name)`, 10_000);
    const card = await P("card()");
    await shot("prompt");
    check("notOfferedBeforeTheRegistrySettles", early.ask.length === 0, early);
    check("asksOnceForBoth", !!asked && card?.count === 1 && !card.hidden && card.title === "This scene uses 2 packages you don't have.", card);
    check(
      "namesEachByNameAndUrl",
      JSON.stringify(card?.rows.map((r) => [r.url, r.name, r.state])) === JSON.stringify([[PKG, "@probe/sea-and-boxes", "ask"], [BROKEN, "@probe/broken", "ask"]]) && card.rows.every((r) => r.shown?.startsWith("automerge:")),
      card?.rows,
    );
    check("warnsAndOffersLoadOrNotNow", /runs its code/.test(card?.warning ?? "") && JSON.stringify(card?.actions) === JSON.stringify(["Not now", "Load them"]), { warning: card?.warning, actions: card?.actions });
    const before = { imported: await P("imported()"), registered: await P("registered()"), running: await P("running()"), status: await P('status("box")'), sea: await P("sea()") };
    check(
      "nothingLoadedBeforeAYes",
      before.imported.length === 0 && before.registered.every((p) => p.id === "probe.local") && !before.running.includes("probe.sea") && before.sea.started === 0 && before.status === "warn",
      before,
    );
    // reconcile: the package this viewer has, and the scene's trait calls for, is now listed (bare), after the two that were
    const listed = await P("listed()");
    check("listsWhatThisViewerHas", JSON.stringify(listed) === JSON.stringify([PKG, BROKEN, LOCAL]), listed);
  }

  // ── Not now ───────────────────────────────────────────────────────────────
  {
    await click("dismiss");
    await sleep(300);
    const after = { card: await P("card()"), imported: await P("imported()"), accepted: await P("accepted()"), running: await P("running()"), packages: await P("packages()") };
    await shot("declined");
    check("notNowLoadsNothing", after.card?.hidden === true && after.imported.length === 0 && after.accepted.length === 0 && !after.running.includes("probe.sea") && after.packages.ask.length === 0, after);
    await reopen();
    const again = await b.waitFor(`window.__p.packages().ask.length === 2`, 10_000);
    check("askedAgainNextOpen", !!again && (await P("imported()")).length === 0, await P("packages()"));
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  {
    await b.waitFor(`window.__p.card() && !window.__p.card().hidden`, 5_000);
    await click("load");
    const settled = await b.waitFor(`window.__p.packages().failed.length === 1 && window.__p.packages().loading.length === 0 && window.__p.running().includes("probe.sea")`, 15_000);
    const imported = await P("imported()");
    const registered = await P("registered()");
    check("loadedAtItsHeads", !!settled && imported.length === 2 && imported.every((u) => /^automerge:[^#]+#.+/.test(u)) && imported.some((u) => u.startsWith(`${PKG}#`)), imported);
    const mine = registered.filter((p) => p.id !== "probe.local");
    check("registeredUnderItsBareUrl", mine.length === 3 && mine.every((p) => p.importUrl === PKG), registered);
    const sea = await P("sea()");
    check("itsExtensionStarted", sea.started === 1 && sea.shown && (await P("running()")).includes("probe.sea"), sea);
    const built = await b.waitFor(`window.__p.loaded("box") && window.__p.status("box") !== "warn"`, 20_000);
    check("itsProviderBuiltTheObject", !!built && (await P("sea()")).built >= 1, { loaded: await P('loaded("box")'), status: await P('status("box")'), state: await b.js(`window.__p.dbg.manager && JSON.stringify(window.__p.dbg.local.get().status)`) });
    const card = await P("card()");
    const packages = await P("packages()");
    await shot("loaded");
    check(
      "theOtherFailureIsReported",
      JSON.stringify(urls(packages.failed)) === JSON.stringify([BROKEN]) && !card.hidden && card.title === "A package this scene uses couldn't be loaded." && card.rows.length === 1 && /no package at/.test(card.rows[0].error ?? "") && JSON.stringify(card.actions) === JSON.stringify(["Dismiss", "Try again"]),
      { packages, card },
    );
    const accepted = await P("accepted()");
    check("onlyWhatLoadedIsRemembered", JSON.stringify(accepted) === JSON.stringify([PKG]), accepted);
    const listed = await P("listed()");
    check("loadingAddsNothingToTheList", JSON.stringify(listed) === JSON.stringify([PKG, BROKEN, LOCAL]), listed);
  }

  // ── remembered ────────────────────────────────────────────────────────────
  {
    await reopen();
    const started = await b.waitFor(`window.__p.running().includes("probe.sea") && window.__p.packages().ask.length === 1`, 15_000);
    const packages = await P("packages()");
    const card = await P("card()");
    await shot("remembered");
    check("rememberedLoadsWithoutAsking", !!started && (await P("imported()")).length === 1 && (await P("imported()"))[0].startsWith(`${PKG}#`), { imported: await P("imported()"), packages });
    check("theOtherIsStillAskedAbout", JSON.stringify(urls(packages.ask)) === JSON.stringify([BROKEN]) && card.title === "This scene uses a package you don't have." && JSON.stringify(card.actions) === JSON.stringify(["Not now", "Load it"]), card);
    check("builtAgainUnasked", !!(await b.waitFor(`window.__p.loaded("box")`, 20_000)), await P('status("box")'));
  }

  // SwiftShader's WebGL says it lacks an extension; the package that isn't served is meant to fail
  const errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e) && !/couldn't load the package automerge:3aB6/.test(e));
  check("noErrors", errors.length === 0, errors);
} catch (err) {
  check("ran", false, String(err?.stack ?? err));
}

console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
