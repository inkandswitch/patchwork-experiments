// Cross-scene drag-and-drop and Copy/Paste (STAGE.md, "Copying objects"),
// in headless Chrome with real HTML5 drags over CDP.
//
//   pnpm build            (and sailing's, for --mode sail)
//   node probes/xdnd-run.mjs [--mode main|sail] [--patch] [--port 4790] [--cdp 9790] [--show] [--shots <dir>]
//
// Serves the repo root (sailing's BUILT dist is loaded at runtime in sail
// mode, never its source) and opens probes/xdnd-probe.html: two scene views
// side by side, A and B, two docs in one in-memory repo.
//
// main: A's outline rows are dragged into B's view: a passthrough GLB crate
// (its file shared, its assets entry copied, its claims left behind), a
// group of two, a mast with its boom and sail under it (onto B's deck, where
// it snaps to the mast step; and with Alt, where it's dropped), and a built
// STL (a new render doc with the same params and build), and a barrel whose
// origin is its middle (it lands on its base). Into B's outline: at the top
// (put down where B's view is looking) and among the deck's attachments
// (snapped to the mast step). A is unchanged; a row of A's dropped in A's own
// view adds nothing, and in A's outline it only reorders. Then ⌘C in A and
// ⌘V twice in B (the second beside the first, under nothing), ⌘V twice in A
// (duplicates one and two widths along), and the right-click menu's Copy
// (what ⌘C writes, read back by a ⌘V in B) and Paste.
//
// sail: A gets sailing's sloop from its parts bin (she brings a sea); her
// row is dragged into an empty B. Everything under her comes, without her
// `motion` (with --patch: sailing.ship's describes says runtime ["motion"]
// and needs ["sailing.sea"], as the page registers it) and B says it needs
// a sea, without adding one.
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
const MODE = arg("mode", "main");
const PATCH = !!arg("patch", false);
const PORT = Number(arg("port", 4790));
const CDP = Number(arg("cdp", 9790));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-xdnd-shots")));
const pkg = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = resolve(pkg, "..");
if (!existsSync(join(pkg, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");
if (MODE === "sail" && !existsSync(join(ROOT, "sailing/dist/index.js"))) throw new Error("no sailing/dist: build sailing first");

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: `/scene/probes/xdnd-probe.html?mode=${MODE}${PATCH ? "&patch=1" : ""}`, width: 1820, height: 800, show: !!arg("show", false), timeout: 600_000 });
const { check, checks, details } = checklist();
const report = { mode: MODE, patch: PATCH, checks, details, counts: {}, shots: [] };
const P = (e) => b.js(`window.__p.${e}`);
const J = JSON.stringify;
const tag = MODE === "sail" ? `sail${PATCH ? "-patched" : ""}` : "main";
const shot = async (name, clip) => report.shots.push(await b.shot(join(SHOTS, `${tag}-${name}.png`), clip));
const near = (a, c, eps = 1e-3) => Array.isArray(a) && Array.isArray(c) && a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) <= eps);
const round = (v, n = 4) => (Array.isArray(v) ? v.map((x) => round(x, n)) : typeof v === "number" ? Number(v.toFixed(n)) : v);
const px = (p) => p && { x: Math.round(p.x), y: Math.round(p.y) };
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n]);
const ids = async (w) => Object.keys((await P(`doc("${w}")`)).objects);
const added = async (w, before) => (await ids(w)).filter((id) => !before.includes(id));
const sameJSON = (a, c) => J(a) === J(c);
/** world position (column-major translation) */
const pos = (m) => m && [m[12], m[13], m[14]];
const yawOf = (m) => Math.atan2(m[8], m[10]);
const angle = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));

/** drag a row of `from`'s outline to a page point (in B's view, or anywhere); returns what was added to `into` and the ring seen on the last step */
async function dragRow(from, id, to, { into = "b", mods = 0, ringIn = "b", entry = null } = {}) {
  const before = await ids(into);
  const beforeOther = await ids(from === into ? (into === "a" ? "b" : "a") : from);
  const r = await P(`row("${from}", "${id}")`);
  if (!r) throw new Error(`no row ${from}:${id}`);
  const c = await P(`canvas("${ringIn}")`);
  // a drop point off the view would be a probe mistake, not a refusal
  if (!entry && !(to.x > c.x + 2 && to.x < c.x + c.w - 2 && to.y > c.y + 2 && to.y < c.y + c.h - 2)) throw new Error(`drop point ${J(to)} is off ${ringIn}'s view ${J(c)}`);
  const e = entry ?? [c.x + 30, c.y + c.h / 2];
  const path = [e, ...towards(e, [to.x, to.y], 6)].map(([x, y]) => [Math.round(x), Math.round(y)]);
  const { seen, types } = await b.htmlDrag([Math.round(r.main.x), Math.round(r.main.y)], path, { mods, during: () => P(`ring("${ringIn}")`) });
  await sleep(600);
  const fresh = await added(into, before);
  return { added: fresh, ring: seen.at(-1), rings: seen, types, otherBefore: beforeOther };
}

/** wait for a set of new ids in a doc to appear (copies go through addObject one at a time) */
async function settle(w, n, ms = 8000) {
  const t0 = Date.now();
  let last = -1;
  for (;;) {
    const k = (await ids(w)).length;
    if (k >= n && k === last) return k;
    last = k;
    if (Date.now() - t0 > ms) return k;
    await sleep(250);
  }
}

/** a key press carrying an editing command (⌘C / ⌘V reach the page as copy / paste only with it) */
async function cmdKey(key, command) {
  const code = `Key${key.toUpperCase()}`;
  const vk = key.toUpperCase().charCodeAt(0);
  await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 4 });
  await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: 4, commands: [command] });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: 4 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 0 });
  await sleep(500);
}

async function menuPick(x, y, label) {
  await b.click(x, y, { button: "right" });
  await sleep(250);
  const items = await P("menuItems()");
  const it = items.find((i) => (typeof label === "string" ? i.text === label : label.test(i.text)));
  if (!it) {
    await b.key("Escape");
    return { picked: false, items: items.map((i) => i.text) };
  }
  await b.click(it.x, it.y);
  await sleep(600);
  return { picked: true, items: items.map((i) => i.text), text: it.text };
}

async function main() {
  check("allLoadedA", await b.waitFor(`__p.allLoaded("a")`, 30_000));
  check("allLoadedB", await b.waitFor(`__p.allLoaded("b")`, 30_000));
  const files = await P("files");
  const urlA = await P(`url("a")`);
  // the bracket's render built in A (so a copy can take its build)
  const aRenderUrl = (await P(`doc("a")`)).objects.bracket.renderUrl;
  check("aBracketBuilt", await b.waitFor(`__p.docOf(${J(aRenderUrl)}).then((r) => !!r.glbUrl)`, 30_000));
  await sleep(600);
  const A0 = await P(`doc("a")`);
  const aRender0 = await P(`docOf(${J(aRenderUrl)})`);
  const W0 = Object.fromEntries(await Promise.all(Object.keys(A0.objects).map(async (id) => [id, await P(`world("a", ${J(id)})`)])));
  report.counts.aObjects = Object.keys(A0.objects).length;
  report.counts.bObjectsAtStart = (await ids("b")).length;
  await shot("0-open");

  // ── 1. the crate (passthrough GLB) onto B's ground ─────────────────────
  {
    const to = px(await P(`at("b", null, [-0.8, 0, 1.6])`));
    const hit = await P(`pickAt("b", ${to.x}, ${to.y})`);
    const r = await dragRow("a", "crate", to);
    const B = await P(`doc("b")`);
    const id = r.added[0];
    const o = B.objects[id] ?? {};
    const a = A0.objects.crate;
    const sizeType = r.types.find((t) => t.startsWith("application/x-scene-object-size;"));
    const sizeR = sizeType ? Number(/r=([0-9.eE+-]+)/.exec(sizeType)?.[1]) : null;
    report.crate = { id, hit, types: r.types, ring: r.ring };
    check("dragTypesKeepLinks", ["application/x-scene-object", "text/x-patchwork-dnd", "text/x-patchwork-urls", "text/plain"].every((t) => r.types.includes(t)) && r.types.some((t) => t.startsWith("application/x-scene-object-from;")) && !!sizeType, r.types);
    check("crateOneCopy", r.added.length === 1 && !(id in A0.objects), r.added);
    check("crateSharesFile", o.sourceUrl === files.crate && o.providerId === "file-glb" && o.renderUrl === null, { sourceUrl: o.sourceUrl, renderUrl: o.renderUrl });
    check("crateAtHitPoint", hit?.id == null && o.parent == null && near(o.transform?.position, hit?.point, 2e-3), { hit, got: round(o.transform?.position) });
    check("crateKeepsHeadingAndScale", near(o.transform?.rotation, a.transform.rotation, 1e-6) && o.transform?.scale === 1.5, o.transform);
    check(
      "crateBehavioursCome",
      o.name === "Crate" && o.color === a.color && sameJSON(o.tags, a.tags) && sameJSON(o.traits, a.traits) && sameJSON(o.hint, a.hint) && o.locked === true && o.infoUrl === a.infoUrl,
      { name: o.name, color: o.color, tags: o.tags, traits: o.traits, hint: o.hint, locked: o.locked, infoUrl: o.infoUrl },
    );
    check("crateClaimsStayBehind", !!A0.objects.crate.claims && !("claims" in o), { source: A0.objects.crate.claims, copy: o.claims });
    check("crateAssetCopied", sameJSON(B.assets?.["probe/crate@1"], A0.assets["probe/crate@1"]) && !("probe/unused@1" in (B.assets ?? {})), B.assets);
    check("ringWhileDragging", r.ring && r.ring.at.parent == null && r.ring.radius > 0 && Math.abs(r.ring.radius - sizeR) < 1e-3 * sizeR, { ring: r.ring, sizeR });
    check("ringGoneAfterDrop", (await P(`ring("b")`)) === null);
    check("crateSelectedInB", (await P(`selected("b")`)) === id);
    check("crateLoadsInB", await b.waitFor(`__p.loaded("b", ${J(id)})`, 10_000));
    report.counts.crateCopies = r.added.length;
    await shot("1-crate");
  }

  // ── 1b. a barrel whose origin is its middle: lands on its base ────────
  {
    const to = px(await P(`at("b", null, [0.6, 0, 2.4])`));
    const hit = await P(`pickAt("b", ${to.x}, ${to.y})`);
    const boxA = await P(`box("a", "barrel")`);
    const lift = boxA ? W0.barrel[13] - boxA.min[1] : null;
    const r = await dragRow("a", "barrel", to);
    const o = (await P(`doc("b")`)).objects[r.added[0]] ?? {};
    const want = hit?.point && lift != null ? [hit.point[0], hit.point[1] + lift, hit.point[2]] : null;
    report.barrel = { hit, lift, got: round(o.transform?.position) };
    check("barrelLandsOnItsBase", r.added.length === 1 && hit?.id == null && Math.abs(lift - 0.3) < 2e-3 && near(o.transform?.position, want, 2e-3), report.barrel);
    report.counts.barrelCopies = r.added.length;
  }

  // ── 2. the group of two onto B's ground ────────────────────────────────
  {
    const to = px(await P(`at("b", null, [-1.6, 0, -1.2])`));
    const hit = await P(`pickAt("b", ${to.x}, ${to.y})`);
    const r = await dragRow("a", "g1", to);
    await settle("b", (await ids("b")).length);
    const B = await P(`doc("b")`);
    const fresh = (await ids("b")).filter((x) => !r.otherBefore.includes(x) && !(x in A0.objects));
    const newIds = r.added.length ? r.added : fresh;
    const g = newIds.find((x) => B.objects[x]?.kind === "group");
    const members = newIds.filter((x) => B.objects[x]?.group === g && B.objects[x]?.kind !== "group");
    const byName = Object.fromEntries(members.map((m) => [B.objects[m].name, m]));
    const wl = await P(`world("b", ${J(byName.Left)})`);
    const wr = await P(`world("b", ${J(byName.Right)})`);
    const dA = pos(W0.right).map((v, i) => v - pos(W0.left)[i]);
    const dB = wr && wl ? pos(wr).map((v, i) => v - pos(wl)[i]) : null;
    const mid = wl && wr ? [(Math.min(wl[12], wr[12]) + Math.max(wl[12], wr[12])) / 2, Math.min(wl[13], wr[13]), (Math.min(wl[14], wr[14]) + Math.max(wl[14], wr[14])) / 2] : null;
    report.group = { added: r.added, group: g, members, ring: r.ring };
    check("groupCopied", r.added.length === 3 && !!g && B.objects[g].name === "Pair" && members.length === 2 && newIds.every((x) => !(x in A0.objects)), { added: r.added, objects: newIds.map((x) => ({ x, kind: B.objects[x]?.kind, group: B.objects[x]?.group, name: B.objects[x]?.name })) });
    check("groupRelativeLayoutKept", dB && near(dA, dB, 1e-6), { dA: round(dA), dB: round(dB) });
    check("groupLandsAtHit", hit?.id == null && near(mid, hit?.point, 2e-3), { mid: round(mid), hit });
    check("groupMembersKeepRotationScale", near(B.objects[byName.Left]?.transform.rotation, A0.objects.left.transform.rotation, 1e-6) && near(B.objects[byName.Right]?.transform.rotation, A0.objects.right.transform.rotation, 1e-6) && B.objects[byName.Right]?.transform.scale === 0.8, { left: B.objects[byName.Left]?.transform, right: B.objects[byName.Right]?.transform });
    check("groupMembersShareFile", members.every((m) => B.objects[m].sourceUrl === files.member));
    report.counts.groupObjects = r.added.length;
    await shot("2-group");
  }

  // ── 3. the mast (boom and sail under it) onto B's deck: snaps to the step ──
  let mastCopy = null;
  {
    const step = await P("MAST_STEP");
    const to = px(await P(`at("b", "deck", [0.35, 0.3, 0.1])`));
    const hit = await P(`pickAt("b", ${to.x}, ${to.y})`);
    const r = await dragRow("a", "mast", to);
    await settle("b", 0);
    const B = await P(`doc("b")`);
    const m = r.added.find((x) => B.objects[x]?.name === "Mast");
    const boom = r.added.find((x) => B.objects[x]?.name === "Boom");
    const sail = r.added.find((x) => B.objects[x]?.name === "Sail");
    mastCopy = m;
    report.mast = { added: r.added, hit, ring: r.ring };
    check("mastSubtreeCopied", r.added.length === 3 && m && boom && sail && r.added.every((x) => !(x in A0.objects)), r.added.map((x) => [x, B.objects[x]?.name, B.objects[x]?.parent]));
    check("mastHitDeck", hit?.id === "deck", hit);
    check("mastSnapsToStep", B.objects[m]?.parent === "deck" && near(B.objects[m]?.transform.position, step, 1e-6), { parent: B.objects[m]?.parent, got: round(B.objects[m]?.transform.position), step });
    check("mastTurnsToStep", near(B.objects[m]?.transform.rotation, [0, 0, 0], 1e-6), B.objects[m]?.transform);
    check("mastChildrenRelationsKept", B.objects[boom]?.parent === m && B.objects[sail]?.parent === boom, { boom: B.objects[boom]?.parent, sail: B.objects[sail]?.parent });
    check("mastChildrenTransformsKept", sameJSON(B.objects[boom]?.transform, A0.objects.boom.transform) && sameJSON(B.objects[sail]?.transform, A0.objects.sail.transform), { boom: B.objects[boom]?.transform, sail: B.objects[sail]?.transform });
    check("ringSaysSnapped", r.ring?.snapped === true && r.ring?.at.parent === "deck", r.ring);
    // Alt: where it's dropped, no snap
    const free = await dragRow("a", "mast", to, { mods: ["alt"] });
    const B2 = await P(`doc("b")`);
    const fm = free.added.find((x) => B2.objects[x]?.name === "Mast" && B2.objects[x]?.parent === "deck");
    const want = hit?.id === "deck" ? await P(`toLocal("b", "deck", ${J(hit.point)})`) : null;
    check("altPlacesFreely", fm && near(B2.objects[fm].transform.position, want, 3e-3) && !near(B2.objects[fm].transform.position, step, 0.05) && free.ring?.snapped === false, { got: round(B2.objects[fm]?.transform.position), want: round(want), ring: free.ring });
    report.counts.mastObjects = r.added.length + free.added.length;
    await shot("3-mast");
  }

  // ── 4. the built STL: a new render doc, same params, same build ───────
  let bracketCopy = null;
  {
    const to = px(await P(`at("b", null, [1.9, 0, 1.9])`));
    const hit = await P(`pickAt("b", ${to.x}, ${to.y})`);
    const r = await dragRow("a", "bracket", to);
    const B = await P(`doc("b")`);
    const id = r.added[0];
    const o = B.objects[id] ?? {};
    bracketCopy = id;
    const rd = o.renderUrl ? await P(`docOf(${J(o.renderUrl)})`) : null;
    report.bracket = { id, renderUrl: o.renderUrl, render: rd && { params: rd.params, glbUrl: rd.glbUrl, builtAt: rd.builtAt, status: rd.status }, hit };
    check("bracketOneCopy", r.added.length === 1);
    check("bracketNewRenderDoc", !!o.renderUrl && o.renderUrl !== aRenderUrl && o.sourceUrl === files.stl && o.providerId === "file-stl", { renderUrl: o.renderUrl, a: aRenderUrl, sourceUrl: o.sourceUrl });
    check("bracketSameParams", rd && sameJSON(rd.params, aRender0.params) && rd.parent === files.stl && rd.providerId === "file-stl", rd && { params: rd.params, parent: rd.parent });
    check("bracketSameBuild", rd && rd.glbUrl === aRender0.glbUrl && sameJSON(rd.builtFrom, aRender0.builtFrom), rd && { glbUrl: rd.glbUrl, a: aRender0.glbUrl });
    check("bracketAtHitKeepsLook", near(o.transform?.position, hit?.point, 2e-3) && o.transform?.scale === 2 && near(o.transform?.rotation, A0.objects.bracket.transform.rotation, 1e-6) && o.color === "#6aa84f", { t: o.transform, hit, color: o.color });
    check("bracketLoadsInB", await b.waitFor(`__p.loaded("b", ${J(id)})`, 15_000));
    // tune B's copy: A's render doc doesn't change
    await b.js(`__p.repo ?? null`);
    await b.js(`(async () => { const h = await window.repo.find(${J(o.renderUrl)}); h.change((d) => { d.params.unit = "mm"; }); })()`);
    await sleep(800);
    const aR = await P(`docOf(${J(aRenderUrl)})`);
    const bR = await P(`docOf(${J(o.renderUrl)})`);
    check("tuningCopyLeavesSourceRender", aR.params.unit === "cm" && bR.params.unit === "mm", { a: aR.params, b: bR.params });
    await shot("4-bracket");
  }

  // ── 5. rows dropped in B's outline: the tree says where in the tree; put down as B's view would ──
  {
    // at the top (in front of the deck): where B's view is looking, under nothing
    const deckRow = await P(`row("b", "deck")`);
    const to = { x: Math.round(deckRow.li.x), y: Math.round(deckRow.li.top + deckRow.li.h * 0.15) };
    const c = await P(`canvas("b")`);
    const centre = await P(`pickAt("b", ${c.x + c.w / 2}, ${c.y + c.h / 2})`);
    const r = await dragRow("a", "crate", to, { entry: [to.x, to.y + 40] });
    const B = await P(`doc("b")`);
    const id = r.added[0];
    const w = id ? await P(`world("b", ${J(id)})`) : null;
    report.outlineDrop = { added: r.added, parent: B.objects[id]?.parent ?? null, centre, got: round(pos(w)) };
    check("outlineDropCopies", r.added.length === 1 && !(id in A0.objects) && B.objects[id]?.sourceUrl === files.crate, r.added);
    check("outlineDropLandsWhereViewLooks", (B.objects[id]?.parent ?? null) === null && centre?.point && near([w[12], w[14]], [centre.point[0], centre.point[2]], 2e-3) && !near(pos(w), pos(W0.crate), 0.05), report.outlineDrop);
    report.counts.outlineDropCopies = r.added.length;
    // among the deck's attachments (in front of the mast copy's row): on the deck, at its mast step, whatever the distance
    const mastRow = mastCopy ? await P(`row("b", ${J(mastCopy)})`) : null;
    let r2 = { added: [] };
    if (mastRow) {
      const to2 = { x: Math.round(mastRow.li.x), y: Math.round(mastRow.li.top + mastRow.li.h * 0.15) };
      r2 = await dragRow("a", "mast", to2, { entry: [to2.x, to2.y - 40] });
    }
    const B2 = await P(`doc("b")`);
    const m2 = r2.added.find((x) => B2.objects[x]?.name === "Mast");
    report.outlineAttach = { row: !!mastRow, added: r2.added, parent: B2.objects[m2]?.parent ?? null, got: round(B2.objects[m2]?.transform.position) };
    check("outlineDropAmongAttachmentsSnaps", !!m2 && B2.objects[m2].parent === "deck" && near(B2.objects[m2].transform.position, await P("MAST_STEP"), 1e-6) && r2.added.length === 3, report.outlineAttach);
    report.counts.outlineAttachCopies = r2.added.length;
  }

  // ── 6. A is unchanged by all of that ───────────────────────────────────
  {
    const A1 = await P(`doc("a")`);
    const aR = await P(`docOf(${J(aRenderUrl)})`);
    check("sourceSceneUnchanged", sameJSON(A1, A0), { before: Object.keys(A0.objects), after: Object.keys(A1.objects) });
    check("sourceRenderUnchanged", sameJSON(aR.params, aRender0.params) && aR.glbUrl === aRender0.glbUrl, aR.params);
  }

  // ── 7. same scene: a row dropped in A's own view adds nothing; in A's outline it only reorders ──
  {
    const before = await ids("a");
    const bBefore = await ids("b");
    const to = px(await P(`at("a", null, [0, 0, 0.6])`));
    const r = await dragRow("a", "crate", to, { into: "a", ringIn: "a" });
    check("sameSceneViewDropAddsNothing", r.added.length === 0 && (await ids("a")).length === before.length && (await ids("b")).length === bBefore.length && r.rings.every((x) => x === null), { added: r.added, rings: r.rings });
    const mastRow = await P(`row("a", "mast")`);
    const target = { x: Math.round(mastRow.li.x), y: Math.round(mastRow.li.top + mastRow.li.h * 0.12) };
    const orderBefore = (await P(`doc("a")`)).order;
    const r2 = await dragRow("a", "crate", target, { into: "a", ringIn: "a", entry: [target.x, target.y + 40] });
    const A2 = await P(`doc("a")`);
    const after = Object.keys(A2.objects);
    report.sameScene = { orderBefore, orderAfter: A2.order, parent: A2.objects.crate.parent ?? null };
    check("sameSceneRowReordersOnly", r2.added.length === 0 && after.length === before.length && after.every((x) => before.includes(x)) && A2.order.indexOf("crate") === A2.order.indexOf("mast") - 1 && !sameJSON(orderBefore, A2.order), report.sameScene);
    check("sameSceneNothingInB", (await ids("b")).length === bBefore.length);
    report.counts.sameSceneAdded = r.added.length + r2.added.length;
  }

  // ── 8. ⌘C in A, ⌘V in B; ⌘V in A (a duplicate beside) ────────────────
  {
    await b.js(`(() => {
      window.__clip = [];
      document.addEventListener("copy", (e) => window.__clip.push({ ev: "copy", types: [...(e.clipboardData?.types ?? [])], text: e.clipboardData?.getData("text/plain") ?? null, default: e.defaultPrevented }), false);
      window.addEventListener("copy", (e) => window.__clip.push({ ev: "copy@window", types: [...(e.clipboardData?.types ?? [])], default: e.defaultPrevented }), false);
      document.addEventListener("paste", (e) => window.__clip.push({ ev: "paste", types: [...(e.clipboardData?.types ?? [])], row: e.clipboardData?.getData("application/x-scene-object") ?? null }), true);
    })()`);
    // select the bracket by its row (a real click, which puts focus in A)
    const row = await P(`row("a", "bracket")`);
    await b.click(Math.round(row.main.x), Math.round(row.main.y));
    check("copySelected", (await P(`selected("a")`)) === "bracket" && (await P(`focusIn("a")`)), { sel: await P(`selected("a")`), active: await P("active()") });
    await cmdKey("c", "copy");
    // focus in B: a click on its open ground (selects nothing)
    const g = px(await P(`at("b", null, [-0.4, 0, 2.2])`));
    await b.click(g.x, g.y);
    const before = await ids("b");
    const c = await P(`canvas("b")`);
    const centre = await P(`pickAt("b", ${c.x + c.w / 2}, ${c.y + c.h / 2})`);
    await cmdKey("v", "paste");
    await settle("b", before.length + 1);
    const fresh = await added("b", before);
    const B = await P(`doc("b")`);
    const o = B.objects[fresh[0]] ?? {};
    const want = centre?.id ? await P(`toLocal("b", ${J(centre.id)}, ${J(centre.point)})`) : centre?.point;
    const clip = await b.js("window.__clip");
    report.copyPaste = { clip, added: fresh, centre, focusB: await P(`focusIn("b")`) };
    check("copyWritesRowPayload", clip.some((x) => x.ev === "copy@window" && x.types.includes("application/x-scene-object") && x.types.includes("text/plain") && x.default), clip);
    check("pasteCarriesRowPayload", clip.some((x) => x.ev === "paste" && x.types.includes("application/x-scene-object") && JSON.parse(x.row || "null")?.scene === urlA), clip);
    check("pasteInBCopies", fresh.length === 1 && o.sourceUrl === files.stl && o.renderUrl && o.renderUrl !== aRenderUrl && o.renderUrl !== B.objects[bracketCopy]?.renderUrl, { fresh, o });
    // a bracket takes no connector: on the surface there, under nothing (raised by its lift, measured in A)
    const boxA = await P(`box("a", "bracket")`);
    const lift = boxA ? W0.bracket[13] - boxA.min[1] : 0;
    const wantW = centre?.point && [centre.point[0], centre.point[1] + lift, centre.point[2]];
    check("pasteLandsWhereViewLooks", (o.parent ?? null) === null && near(o.transform?.position, wantW, 3e-3), { centre, got: round(o.transform?.position), want: round(wantW), parent: o.parent, lift, unused: want });
    // again: beside the first, under nothing (not stacked, not its child)
    const before2 = await ids("b");
    await cmdKey("v", "paste");
    await settle("b", before2.length + 1);
    const fresh2 = await added("b", before2);
    const o2 = (await P(`doc("b")`)).objects[fresh2[0]] ?? {};
    const d2 = o2.transform && o.transform ? o2.transform.position.map((v, i) => v - o.transform.position[i]) : null;
    report.copyPaste.again = { added: fresh2, parent: o2.parent ?? null, offset: d2 && round(d2) };
    check("pasteAgainBeside", fresh2.length === 1 && (o2.parent ?? null) === null && d2 && d2[0] > 0.1 && Math.abs(d2[2]) < 1e-6, report.copyPaste.again);
    report.counts.pastedInB = fresh.length + fresh2.length;
    await shot("5-paste-b");

    // ⌘V back in A: a duplicate beside the original
    const aBefore = await ids("a");
    const g2 = px(await P(`at("a", null, [0.2, 0, 2.2])`));
    await b.click(g2.x, g2.y);
    await cmdKey("v", "paste");
    await settle("a", aBefore.length + 1);
    const dup = await added("a", aBefore);
    await cmdKey("v", "paste");
    await settle("a", aBefore.length + 2);
    const dup2 = (await added("a", aBefore)).filter((x) => !dup.includes(x));
    const A3 = await P(`doc("a")`);
    const d = A3.objects[dup[0]] ?? {};
    const e2 = A3.objects[dup2[0]] ?? {};
    const orig = A3.objects.bracket;
    const off = d.transform && orig.transform ? d.transform.position.map((v, i) => v - orig.transform.position[i]) : null;
    const off2 = e2.transform && orig.transform ? e2.transform.position.map((v, i) => v - orig.transform.position[i]) : null;
    report.duplicate = { added: dup, offset: off && round(off), again: dup2, offset2: off2 && round(off2) };
    check("duplicateAgainTwoWidths", dup2.length === 1 && off && off2 && Math.abs(off2[0] - 2 * off[0]) < 1e-6 && Math.abs(off2[1]) < 1e-6 && Math.abs(off2[2]) < 1e-6, report.duplicate);
    check("pasteInSameSceneDuplicates", dup.length === 1 && d.sourceUrl === files.stl && d.renderUrl && d.renderUrl !== orig.renderUrl && (d.parent ?? null) === (orig.parent ?? null), { dup, d });
    check("duplicateBeside", off && off[0] > 0.1 && Math.abs(off[1]) < 1e-6 && Math.abs(off[2]) < 1e-6 && near(d.transform.rotation, orig.transform.rotation, 1e-6) && d.transform.scale === orig.transform.scale, { off });
    report.counts.duplicatedInA = dup.length + dup2.length;
    await shot("6-duplicate-a");
  }

  // ── 9. the right-click menu's Copy (what ⌘C writes), then ⌘V and the menu's Paste in B ──
  {
    const on = px(await P(`at("a", "crate", [0, 0.2, 0])`));
    const hitA = await P(`pickAt("a", ${on.x}, ${on.y})`);
    const cp = await menuPick(on.x, on.y, "Copy");
    await b.js("window.__clip.length = 0");
    // ⌘V in B: the clipboard has the row payload (not just the link)
    const g = px(await P(`at("b", null, [1.4, 0, -1.8])`));
    await b.click(g.x, g.y);
    const before = await ids("b");
    const c = await P(`canvas("b")`);
    const centre = await P(`pickAt("b", ${c.x + c.w / 2}, ${c.y + c.h / 2})`);
    await cmdKey("v", "paste");
    await settle("b", before.length + 1);
    const fresh = await added("b", before);
    const clip = await b.js("window.__clip");
    const row = clip.find((x) => x.ev === "paste")?.row ?? null;
    const payload = row ? JSON.parse(row) : null;
    const o = (await P(`doc("b")`)).objects[fresh[0]] ?? {};
    check("menuCopyOnObject", hitA?.id === "crate" && cp.picked, cp);
    check("menuCopyWritesRowPayload", payload?.scene === urlA && sameJSON(payload?.ids, ["crate"]) && typeof payload?.copy === "string", { clip });
    check("menuCopyPastesWithKeys", fresh.length === 1 && o.sourceUrl === files.crate && (o.parent ?? null) === null && centre?.point && near([o.transform.position[0], o.transform.position[2]], [centre.point[0], centre.point[2]], 3e-3), { fresh, got: round(o.transform?.position), centre });
    // the menu's Paste: the same Copy again, so beside that one
    const before2 = await ids("b");
    const ps = await menuPick(g.x, g.y, /^Paste/);
    await settle("b", before2.length + 1);
    const fresh2 = await added("b", before2);
    const o2 = (await P(`doc("b")`)).objects[fresh2[0]] ?? {};
    const d2 = o2.transform && o.transform ? o2.transform.position.map((v, i) => v - o.transform.position[i]) : null;
    report.menu = { hitA, copy: cp, paste: ps, added: [...fresh, ...fresh2], offset: d2 && round(d2) };
    check("menuPasteNamesIt", ps.picked && /Crate/.test(ps.text ?? ""), ps);
    check("menuPasteCopiesBeside", fresh2.length === 1 && o2.sourceUrl === files.crate && (o2.parent ?? null) === null && d2 && d2[0] > 0.1 && Math.abs(d2[2]) < 1e-6, report.menu);
    report.counts.menuPastedInB = fresh.length + fresh2.length;
    await shot("7-menu");
  }
  report.counts.bObjectsAtEnd = (await ids("b")).length;
  report.counts.aObjectsAtEnd = (await ids("a")).length;
}

async function sail() {
  const before = await ids("a");
  await b.waitFor(`__p.part("a", "sailing.sloop")`, 20_000);
  const it = await P(`part("a", "sailing.sloop")`);
  if (!it) await shot("0-no-bin");
  check("sloopInBin", !!it, it);
  await b.click(Math.round(it.x), Math.round(it.y));
  await b.waitFor(`Object.keys(__p.doc("a").objects).length > 3`, 20_000);
  await settle("a", before.length + 2, 10_000);
  const A = await P(`doc("a")`);
  const ship = Object.keys(A.objects).find((id) => A.objects[id].traits?.["sailing.ship"]);
  check("sloopPlacedInA", !!ship && !!A.traits?.["sailing.sea"], { ship, traits: Object.keys(A.traits ?? {}) });
  if (!ship) return;
  // runtime state on her, as play would leave it
  await b.js(`__p.change("a", (d) => { d.objects[${J(ship)}].traits["sailing.ship"].motion = { position: [1, 0, 2], velocity: [0.5, 0, 0], t: 12 }; d.objects[${J(ship)}].claims = { sim: { viewer: "viewer:zz", session: "s-9" } }; })`);
  await b.waitFor(`__p.allLoaded("a")`, 30_000);
  await sleep(800);
  const A0 = await P(`doc("a")`);
  // her subtree in A: everything attached under her
  const under = new Set([ship]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, o] of Object.entries(A0.objects)) if (!under.has(id) && under.has(o.parent)) (under.add(id), (grew = true));
  }
  report.counts.aShipSubtree = under.size;
  report.counts.aObjects = Object.keys(A0.objects).length;
  await shot("0-sloop-in-a");
  const to = px(await P(`at("b", null, [0, 0, 0])`));
  const r = await dragRow("a", ship, to);
  await settle("b", under.size, 15_000);
  const B = await P(`doc("b")`);
  const bIds = Object.keys(B.objects);
  const bShip = bIds.find((id) => B.objects[id].traits?.["sailing.ship"]);
  const toasts = await P(`toasts("b")`);
  report.sail = { ship, aSubtree: [...under].map((id) => A0.objects[id].name), bObjects: bIds.map((id) => [B.objects[id].name, B.objects[id].parent]), toasts, bTraits: Object.keys(B.traits ?? {}), shipTrait: B.objects[bShip]?.traits?.["sailing.ship"], ring: r.ring, types: r.types };
  report.counts.bObjects = bIds.length;
  check("shipSubtreeCopied", bIds.length === under.size && bIds.every((id) => !(id in A0.objects)), { b: bIds.length, a: under.size });
  // relationships: each copy's parent is the copy of its original's parent (matched by name and depth)
  const names = (doc, id) => { const out = []; for (let x = id; x; x = doc.objects[x]?.parent) out.push(doc.objects[x]?.name); return out.join("<"); };
  const aChains = [...under].map((id) => names(A0, id)).sort();
  const bChains = bIds.map((id) => names(B, id)).sort();
  check("shipRelationsKept", sameJSON(aChains, bChains), { aChains, bChains });
  check("shipTraitsCome", bIds.every((id) => sameJSON(Object.keys(B.objects[id].traits ?? {}).sort(), Object.keys(A0.objects[[...under].find((x) => names(A0, x) === names(B, id))]?.traits ?? {}).sort())));
  check("shipClaimsStayBehind", !("claims" in (B.objects[bShip] ?? {})));
  check("seaNotAddedSilently", !B.traits?.["sailing.sea"], Object.keys(B.traits ?? {}));
  const assetKeys = Object.keys(A0.assets ?? {});
  check("shipAssetsCopied", assetKeys.length > 0 && assetKeys.filter((k) => bIds.some((id) => B.objects[id].sourceUrl === A0.assets[k].url)).every((k) => sameJSON(B.assets?.[k], A0.assets[k])), { a: assetKeys, b: Object.keys(B.assets ?? {}) });
  const notice = toasts.find((t) => /needs a sea/i.test(t));
  if (PATCH) {
    check("motionLeftBehind", B.objects[bShip]?.traits?.["sailing.ship"] && !("motion" in B.objects[bShip].traits["sailing.ship"]), B.objects[bShip]?.traits);
    check("needsSeaNotice", notice === "This ship needs a sea: add Sea to the scene.", toasts);
  } else {
    // sailing doesn't say yet: the copy takes `motion`, and nothing is said (what the build report asks sailing to add)
    report.unpatched = { motionCopied: !!B.objects[bShip]?.traits?.["sailing.ship"]?.motion, notice: notice ?? null };
    check("unpatchedAsExpected", report.unpatched.motionCopied && !notice, report.unpatched);
  }
  check("sourceUnchanged", sameJSON(await P(`doc("a")`), A0));
  await sleep(300);
  await shot("1-ship-in-b");
}

try {
  if (!(await b.waitFor("window.__ready", 60_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${J(await P("errors"))}`);
  await (MODE === "sail" ? sail() : main());
  const errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  report.errors = errors;
  check("noErrors", errors.length === 0, errors);
} catch (err) {
  check("ran", false, String(err?.stack ?? err));
}
report.logs = b.logs.filter((l) => !/KHR_parallel/.test(l)).slice(-30);
report.passed = Object.values(checks).filter(Boolean).length;
report.total = Object.keys(checks).length;
console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
