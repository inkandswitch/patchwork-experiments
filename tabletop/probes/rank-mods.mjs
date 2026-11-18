#!/usr/bin/env node
// How well the TTS importer (src/tts/) takes each Tabletop Simulator mod in
// this machine's cache, and what each mod's Lua does. Offline and read-only:
// it never fetches, never builds, never writes a doc. Re-run it as the
// importer improves.
//
//   node probes/rank-mods.mjs [--mods <Mods dir>] [--out <dir>] [--only <id,id…>] [--max-mb 2048]
//
// Mods dir: ~/Library/Tabletop Simulator/Mods (Workshop/*.json and the asset
// caches beside it). Out dir (default $TMPDIR/tts-rank) gets, one row per mod,
// appended as each finishes:
//   tts-rank.tsv     grade, name, players, objects, what the importer made and
//                    skipped/approximated and why, asset cache coverage by
//                    kind, asset bundles, alternate States, Lua/XML sizes,
//                    the scripting class, a one-line reason
//   tts-lua-api.tsv  per mod, how often each TTS API call / event appears
//                    (over the mod's distinct scripts, comments stripped)
//
// Each mod runs in its own child process (one at a time), capped at --max-mb
// of V8 heap: a mod that needs more is recorded as skipped, not retried.
//
// The import is the importer's own translation (translate.js, as
// importer.js's runImport calls it: once dry to learn which assets the game
// needs, then with the found ones), but assets are looked up in the cache by
// name and only their first bytes are read (sniff + image size), never kept,
// so a 600-asset mod stays small. An image over the importer's 32 MB limit
// counts as cached (the browser importer shrinks it; noted as "big").
//
// Grades (grade_if_fetched: the importer's, as if every asset were had;
// grade: that, capped by this cache's coverage — under 90% cached at best B,
// under 50% at best C):
//   A  imports nearly whole, no or trivial scripting
//   B  imports whole, but setup-only scripting, > 10 alternate States, any
//      grey-box stand-in, or > 5% built-in pieces / custom dice drawn plainly
//   C  rules/UI scripting, > 3% grey boxes (asset bundles, fixtures such as
//      counters/tablets/clocks, unknown Names), or over the 5000-object cap
//   D  doesn't import, heavy scripting, > 30% grey boxes, or under half the
//      objects placed (the rest spawned by Lua)
// A locked asset bundle under the table top is table furniture (the Flex
// Table's frame), not a grey box.
//
// Scripting class, from the mod's distinct scripts (comments stripped) and
// XML UI. The Flex Table Control widget (table chrome, in a third of the
// corpus) is set aside; memory bags (bags that place/recall their contents
// from positions in LuaScriptState: a setup recipe as data) count as setup.
// The rest ("rules" code) decides:
//   none      < 1.5 KB and no spawning/dealing, or < 10 KB with < 5
//             spawn/take/shuffle/deal calls, no setup button, small XML
//   setup     spawns/takes/shuffles/deals/places or memory bags; a setup
//             panel (setup button, XML < 5 KB, < 10 UI.* calls, ≤ 2 kinds of
//             event handler, < 40 KB) is still setup
//   rules/UI  otherwise: XML UI, UI.* calls, Turns, ≥ 3 kinds of event
//             handler, or ≥ 40 KB
//   heavy     ≥ 150 KB, or rules/UI and setup together at ≥ 60 KB

import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const MODS = opt("mods", join(homedir(), "Library", "Tabletop Simulator", "Mods"));
const OUT = opt("out", join(tmpdir(), "tts-rank"));
const MAX_MB = Number(opt("max-mb", 2048));
const SELF = fileURLToPath(import.meta.url);

// ─── the API calls counted ──────────────────────────────────────────────────
export const API = [
  ["getObjectFromGUID", /\bgetObjectFromGUID\s*\(/g],
  ["getAllObjects", /\bgetAllObjects\s*\(/g],
  ["getObjectsWithTag", /\bgetObjectsWithA?n?y?Tags?\s*\(/g],
  ["spawnObject", /\bspawnObject\s*\(/g],
  ["spawnObjectData/JSON", /\bspawnObject(Data|JSON)\s*\(/g],
  ["clone", /[:.]clone\s*\(/g],
  ["destruct", /[:.]destruct\s*\(/g],
  ["takeObject", /[:.]takeObject\s*\(/g],
  ["putObject", /[:.]putObject\s*\(/g],
  ["getObjects", /[:.]getObjects\s*\(/g],
  ["shuffle", /[:.]shuffle\s*\(/g],
  ["deal", /[:.]deal\s*\(/g],
  ["dealToColor", /[:.]dealToColor(WithOffset)?\s*\(/g],
  ["setPosition", /[:.]setPosition\s*\(/g],
  ["setPositionSmooth", /[:.]setPositionSmooth\s*\(/g],
  ["setRotation", /[:.]setRotation\s*\(/g],
  ["setRotationSmooth", /[:.]setRotationSmooth\s*\(/g],
  ["getPosition", /[:.]getPosition\s*\(/g],
  ["flip", /[:.]flip\s*\(/g],
  ["setLock", /[:.]setLock\s*\(/g],
  ["setState/getStates", /[:.](setState|getStates)\s*\(/g],
  ["roll/randomize", /[:.](roll|randomize)\s*\(/g],
  ["getValue/setValue", /[:.](getValue|setValue)\s*\(/g],
  ["setName/Description", /[:.](setName|setDescription|setGMNotes)\s*\(/g],
  ["setColorTint", /[:.]setColorTint\s*\(/g],
  ["setCustomObject/reload", /[:.](setCustomObject|reload)\s*\(/g],
  ["tags", /[:.](addTag|hasTag|removeTag|setTags|getTags)\s*\(/g],
  ["setSnapPoints", /\bsetSnapPoints\s*\(/g],
  ["setDecals", /[:.](setDecals|addDecal)\s*\(/g],
  ["highlight", /[:.]highlight(On|Off)\s*\(/g],
  ["createButton", /[:.]createButton\s*\(/g],
  ["editButton/clearButtons", /[:.](editButton|clearButtons|removeButton)\s*\(/g],
  ["createInput", /[:.](createInput|editInput)\s*\(/g],
  ["addContextMenuItem", /\baddContextMenuItem\s*\(/g],
  ["UI.*", /\bUI\s*\.\s*(set\w*|get\w*|show|hide)\s*\(/g],
  ["Wait.*", /\bWait\s*\.\s*(time|frames|condition|stop)\s*\(/g],
  ["startLuaCoroutine", /\bstartLuaCoroutine\s*\(/g],
  ["broadcast/print", /\b(broadcastToAll|broadcastToColor|printToAll|printToColor)\s*\(/g],
  ["Player[...]", /\bPlayer\s*(\[|\.\w+\s*\.)/g],
  ["getSeatedPlayers", /\bgetSeatedPlayers\s*\(/g],
  ["Turns", /\bTurns\s*\./g],
  ["Physics.cast", /\bPhysics\s*\.\s*cast\s*\(/g],
  ["Notes", /\bNotes\s*\./g],
  ["Global.call/.call", /(\bGlobal\s*[:.]\s*call|[:.]call)\s*\(/g],
  ["getVar/setVar/Table", /[:.](getVar|setVar|getTable|setTable)\s*\(/g],
  ["JSON.*", /\bJSON\s*\.\s*(encode|decode|encode_pretty)\s*\(/g],
  ["Timer.*", /\bTimer\s*\.\s*(create|destroy)\s*\(/g],
  ["Hands/Tables/Grid/Lighting", /\b(Hands|Tables|Grid|Lighting|MusicPlayer)\s*\./g],
  ["WebRequest", /\bWebRequest\s*\./g],
  ["onLoad", /\bfunction\s+onLoad\s*\(/g],
  ["onSave", /\bfunction\s+onSave\s*\(/g],
  ["onUpdate", /\bfunction\s+on(Fixed)?Update\s*\(/g],
  ["onObjectDrop/PickUp", /\bfunction\s+on(Object)?(Drop|PickUp)\s*\(/g],
  ["onObjectEnter/LeaveContainer", /\bfunction\s+on(Object)?(Enter|Leave)Container\s*\(/g],
  ["onObjectEnter/LeaveZone", /\bfunction\s+on(Object)?(Enter|Leave)(Scripting)?Zone\s*\(/g],
  ["onPlayerTurn/ChangeColor", /\bfunction\s+onPlayer(Turn|ChangeColor|Connect|Disconnect|Action)\s*\(/g],
  ["onObjectRandomize/Rotate/Flip", /\bfunction\s+on(Object)?(Randomize|Rotate|Flip|NumberTyped|StateChange|Spawn|Destroy|Hover)\s*\(/g],
  ["onCollision", /\bfunction\s+onCollision(Enter|Exit|Stay)\s*\(/g],
  ["onScriptingButton/Chat", /\bfunction\s+on(ScriptingButton(Down|Up)|Chat|ExternalMessage)\s*\(/g],
];
const EVENTS = ["onObjectDrop/PickUp", "onObjectEnter/LeaveContainer", "onObjectEnter/LeaveZone", "onPlayerTurn/ChangeColor", "onObjectRandomize/Rotate/Flip", "onCollision", "onScriptingButton/Chat", "onUpdate"];
const SETUP_CALLS = ["spawnObject", "spawnObjectData/JSON", "takeObject", "putObject", "shuffle", "deal", "dealToColor", "clone"];

/** Lua without its comments (long and line), whitespace squeezed. */
export function stripLua(src) {
  return String(src ?? "")
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
/** XML UI without comments and whitespace: what's left is the UI. */
const stripXml = (x) => String(x ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();

// ─── one mod, in a child ────────────────────────────────────────────────────
async function one(file) {
  const { readSave, walk, collectAssets, classify } = await import("../src/tts/tts.js");
  const { translate } = await import("../src/tts/translate.js");
  const { AssetIndex, cacheCandidates } = await import("../src/tts/cache.js");
  const { sniff } = await import("../src/tts/sniff.js");
  const { imageSize } = await import("../src/tts/image-size.js");
  const { DEFAULT_SETTINGS } = await import("../src/tts/settings.js");

  const jsonBytes = statSync(file).size;
  let raw = JSON.parse(readFileSync(file, "utf8"));
  const out = { file: basename(file), jsonBytes, name: raw.SaveName || raw.GameMode || "", players: raw.PlayerCounts ?? null, gameType: raw.GameType ?? "", tags: raw.Tags ?? [] };

  // ── Lua, XML UI and alternate States, from the raw JSON ──
  const lua = { global: stripLua(raw.LuaScript).length, globalRaw: String(raw.LuaScript ?? "").length, objects: 0, scripted: 0, stateBytes: String(raw.LuaScriptState ?? "").length, xml: stripXml(raw.XmlUI).length, xmlObjects: 0 };
  const scripts = new Map(); // stripped text → count
  if (stripLua(raw.LuaScript)) scripts.set(stripLua(raw.LuaScript), 1);
  let statesObjects = 0;
  let statesTotal = 0;
  let rawObjects = 0;
  const bundles = new Map(); // assetbundle url → uses
  const rawWalk = (list) => {
    for (const o of list ?? []) {
      if (!o || typeof o !== "object") continue;
      rawObjects++;
      const s = stripLua(o.LuaScript);
      if (s) {
        lua.scripted++;
        lua.objects += s.length;
        scripts.set(s, (scripts.get(s) ?? 0) + 1);
      }
      lua.stateBytes += String(o.LuaScriptState ?? "").length;
      const x = stripXml(o.XmlUI);
      if (x) {
        lua.xml += x.length;
        lua.xmlObjects++;
      }
      const ab = o.CustomAssetbundle;
      if (ab) for (const k of ["AssetbundleURL", "AssetbundleSecondaryURL"]) if (ab[k]) bundles.set(String(ab[k]).trim(), (bundles.get(String(ab[k]).trim()) ?? 0) + 1);
      const st = o.States && typeof o.States === "object" ? Object.values(o.States) : [];
      if (st.length) {
        statesObjects++;
        statesTotal += st.length;
      }
      rawWalk(o.ContainedObjects);
      rawWalk(st);
      rawWalk(o.ChildObjects);
    }
  };
  rawWalk(raw.ObjectStates);
  // distinct scripts, sorted: table chrome (the Flex Table Control widget, in a third of the
  // corpus: it resizes the table, nothing about the game) is set aside; memory bags (a bag that
  // remembers where its contents go and places/recalls them: a setup recipe as data, in
  // LuaScriptState) are setup by definition; the rest decide the class
  const CHROME = /tableHeightOffset|tableImageData/;
  const MEMORY = /memoryList|buttonClick_place|placeStuff|record_objects|place_objects|recall_objects/;
  const all = [...scripts.keys()].filter((t) => !CHROME.test(t));
  const memory = all.filter((t) => MEMORY.test(t));
  const rest = all.filter((t) => !MEMORY.test(t));
  lua.chrome = [...scripts.keys()].length - all.length;
  lua.memoryBags = memory.reduce((n, t) => n + scripts.get(t), 0);
  const code = all.join("\n");
  const restCode = rest.join("\n");
  lua.distinct = all.length;
  lua.distinctBytes = code.length;
  lua.restBytes = restCode.length;
  const api = {};
  for (const [k, re] of API) api[k] = (code.match(re) ?? []).length;
  const rapi = {};
  for (const [k, re] of API) rapi[k] = (restCode.match(re) ?? []).length;
  // a setup/start button: a click_function named for it, or such a function
  const setupButton = lua.memoryBags > 0 || /click_function\s*=\s*["'][^"']*(setup|start|begin|deal|prepare|init|place|layout)/i.test(restCode) || /function\s+\w*(setup|start(game)?|begin)\w*\s*\(/i.test(restCode);
  lua.setupButton = setupButton;
  out.api = api;

  const events = EVENTS.filter((k) => rapi[k] > 0).length;
  const setupCalls = SETUP_CALLS.reduce((n, k) => n + rapi[k], 0);
  const uiCalls = rapi["UI.*"];
  const bytes = lua.restBytes;
  const setup = setupCalls > 0 || rapi.setPosition + rapi.setPositionSmooth > 3 || lua.memoryBags > 0;
  // a setup panel (XML or buttons that start the game) isn't rules: below these it's setup
  const smallUI = lua.xml < 5000 && uiCalls < 10 && events <= 2 && rapi.Turns === 0 && bytes < 40e3;
  const rulesUI = !(setupButton && smallUI) && (lua.xml > 400 || uiCalls >= 5 || rapi.Turns > 0 || events >= 3 || bytes >= 40e3);
  let scripting;
  if (!lua.memoryBags && ((bytes < 1500 && lua.xml < 400 && setupCalls === 0) || (bytes < 10e3 && setupCalls < 5 && lua.xml < 5000 && events <= 2 && !setupButton))) scripting = "none";
  else if (bytes >= 150e3 || (rulesUI && setup && bytes >= 60e3)) scripting = "heavy";
  else if (rulesUI) scripting = "rules/UI";
  else scripting = "setup";
  out.lua = { ...lua, events, setupCalls, uiCalls, scripting };
  out.states = { objects: statesObjects, total: statesTotal };
  out.rawObjects = rawObjects;

  // ── the importer: its own reading and translation ──
  let save;
  try {
    save = readSave(raw);
  } catch (err) {
    out.import = { ok: false, error: String(err?.message ?? err) };
    return out;
  }
  const notes = raw.Note, rules = raw.Rules;
  raw = null; // let the raw JSON go before translating
  void notes, rules;

  // kinds, as the importer classifies them: placed things (top level, children, contents) — not other States
  const kinds = {};
  const stateNodes = new Set();
  for (const { node, parent } of walk(save.objects)) {
    if (parent && parent.states.includes(node)) stateNodes.add(node);
    if (stateNodes.has(parent)) stateNodes.add(node);
  }
  let objects = 0;
  for (const { node } of walk(save.objects)) {
    if (stateNodes.has(node)) continue;
    objects++;
    // a locked asset bundle under the table top is table furniture (the Flex Table's frame), not a game piece
    const furniture = node.kind === "assetbundle" && node.locked && Number(node.transform?.posY) < 0;
    const k = furniture ? "table furniture" : node.kind === "zone" ? (node.name === "HandTrigger" ? "hand" : node.name === "ScriptingTrigger" ? "scripting zone" : "zone") : node.kind === "text" ? (node.name === "3DText" ? "3D text" : "notecard") : node.kind;
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  out.objects = objects;
  out.kinds = kinds;

  // the asset cache, by name (no bytes read until a URL needs one)
  const index = new AssetIndex();
  for (const dir of ["Images", "Models", "Images Raw", "Models Raw", "PDF"]) {
    const d = join(MODS, dir);
    if (existsSync(d)) for (const n of readdirSync(d)) index.add(`Mods/${dir}/${n}`, join(d, n));
  }
  const bundleStems = new Set(existsSync(join(MODS, "Assetbundles")) ? readdirSync(join(MODS, "Assetbundles")).map((n) => n.replace(/\.[^.]*$/, "")) : []);

  const options = { unit: DEFAULT_SETTINGS.metresPerUnit, flipObjX: true, includeContents: true, maxObjects: DEFAULT_SETTINGS.maxObjects };
  const needed = new Map();
  try {
    translate(save, { ...options, file: (u) => (needed.set(u, (needed.get(u) ?? 0) + 1), null) });
  } catch (err) {
    out.import = { ok: false, error: `translate (dry): ${err?.message ?? err}` };
    return out;
  }
  const referenced = collectAssets(save.objects, { tableURL: save.tableURL });
  const head = (path, n = 512 * 1024) => {
    const fd = openSync(path, "r");
    try {
      const b = Buffer.alloc(Math.min(n, statSync(path).size));
      readSync(fd, b, 0, b.length, 0);
      return new Uint8Array(b.buffer, b.byteOffset, b.length);
    } finally {
      closeSync(fd);
    }
  };
  const found = new Map(); // url → { fileUrl, dims }
  const assets = { image: { refs: 0, needed: 0, cached: 0 }, model: { refs: 0, needed: 0, cached: 0 }, pdf: { refs: 0, cached: 0 }, assetbundle: { refs: bundles.size, cached: 0 }, wrongType: 0, big: 0 };
  for (const r of referenced.values()) {
    assets[r.type].refs++;
    if (r.type === "pdf" && index.find(r.url)) assets.pdf.cached++;
  }
  for (const b of bundles.keys()) if (cacheCandidates(b).some((s) => bundleStems.has(s))) assets.assetbundle.cached++;
  let k = 0;
  for (const u of needed.keys()) {
    const role = /\.obj(\?|#|$)/i.test(u) || referenced.get(u)?.type === "model" ? "model" : "image";
    assets[role].needed++;
    const hit = index.find(u);
    if (!hit) continue;
    let bytes;
    try {
      bytes = head(hit.value);
    } catch {
      continue;
    }
    const t = sniff(bytes);
    if (role === "model" ? t.extension !== "obj" : !t.image) {
      assets.wrongType++;
      continue;
    }
    if (statSync(hit.value).size > DEFAULT_SETTINGS.maxStoredBytes) assets.big++;
    assets[role].cached++;
    found.set(u, { fileUrl: `automerge:asset${k++}`, dims: t.image ? imageSize(bytes) : null });
  }
  out.assets = assets;

  let t;
  try {
    t = translate(save, { ...options, file: (u) => found.get(u)?.fileUrl ?? null, imageSize: (u) => found.get(u)?.dims ?? null });
  } catch (err) {
    out.import = { ok: false, error: `translate: ${err?.message ?? err}` };
    return out;
  }
  // skip reasons, grouped: "Name (why)" → why
  const skipped = {};
  for (const [key, n] of Object.entries(t.skipped)) {
    const why = /\(([^)]*)\)$/.exec(key)?.[1] ?? (/Trigger|Zone/.test(key) ? `zone ${key}` : /3DText|Notecard/.test(key) ? `text ${key}` : key);
    skipped[why] = (skipped[why] ?? 0) + n;
  }
  // stand-ins the importer makes even with every asset had (asset bundles, unknowns, custom dice
  // images, built-in pieces): a third translation, every URL "found"
  const ideal = translate(save, { ...options, file: (u) => `automerge:${u.length}` });
  out.import = { ok: true, counts: t.counts, skipped, approximated: t.approximated, structural: ideal.approximated, warnings: t.warnings.slice(0, 5), truncated: t.warnings.some((w) => /stopped at/.test(w)), seats: Object.keys(t.game.seats ?? {}).length };
  out.memMB = Math.round(process.memoryUsage().rss / 1e6);
  return out;
}

// ─── the grade ──────────────────────────────────────────────────────────────
export function grade(r) {
  if (r.skippedRun) return { grade: "D", fetched: "D", reason: r.skippedRun };
  if (!r.import?.ok) return { grade: "D", fetched: "D", reason: `import failed: ${r.import?.error ?? "?"}` };
  const c = r.import.counts;
  const placed = Math.max(1, c.placed);
  const kinds = r.kinds ?? {};
  // what the importer draws as a grey box whatever the cache has: asset bundles, fixtures
  // (counters, tablets, clocks), unknown Names; built-in pieces and custom dice are drawn as
  // shapes / plain dice, a lesser loss
  const serious = (kinds.assetbundle ?? 0) + (kinds.fixture ?? 0) + (kinds.unknown ?? 0);
  const structural = Object.values(r.import.structural ?? {}).reduce((x, y) => x + y, 0);
  const minor = Math.max(0, structural - serious);
  const a = r.assets;
  const need = a.image.needed + a.model.needed;
  const have = a.image.cached + a.model.cached;
  const cov = need ? have / need : 1;
  const sc = r.lua.scripting;
  const why = [];
  if (kinds.assetbundle) why.push(`${kinds.assetbundle} asset bundles`);
  if (serious - (kinds.assetbundle ?? 0)) why.push(`${serious - (kinds.assetbundle ?? 0)} fixtures/unknown`);
  if (minor) why.push(`${minor} built-in/custom-dice stand-ins`);
  why.push(`assets ${have}/${need} cached`);
  if (kinds["3D text"] || kinds.notecard) why.push(`${(kinds["3D text"] ?? 0) + (kinds.notecard ?? 0)} text/notecards left out`);
  if (r.states.total) why.push(`${r.states.total} alt States on ${r.states.objects}`);
  if (r.import.truncated) why.push("over 5000 objects (truncated)");
  if (c.placed < 0.5 * (r.objects ?? 0)) why.push(`only ${c.placed} of ${r.objects} objects placed`);
  why.push(`Lua ${sc} (${Math.round(r.lua.restBytes / 1000)} KB${r.lua.memoryBags ? `, ${r.lua.memoryBags} memory bags` : ""}${r.lua.xml ? `, XML ${Math.round(r.lua.xml / 1000)} KB` : ""})`);
  // the importer's grade: as if every asset were had (fetched)
  const s = serious / placed;
  let f;
  if (sc === "heavy" || s > 0.3 || c.placed < 0.5 * (r.objects ?? 0)) f = "D";
  else if (sc === "rules/UI" || s > 0.03 || r.import.truncated) f = "C";
  else if (sc === "setup" || r.states.total > 10 || minor / placed > 0.05 || serious > 0) f = "B";
  else f = "A";
  // on this machine: the cache's coverage too
  const order = "ABCD";
  const cacheGrade = cov < 0.5 ? "C" : cov < 0.9 ? "B" : "A";
  const g = order[Math.max(order.indexOf(f), order.indexOf(cacheGrade))];
  return { grade: g, fetched: f, reason: why.join("; "), coverage: cov };
}

const COLS = ["grade", "grade_if_fetched", "name", "file", "players", "jsonMB", "objects", "placed", "pieces", "decks", "cards", "bags", "dice", "seats", "kinds", "skipped", "standins", "uncached_standins", "img_cached/needed", "obj_cached/needed", "pdf_cached/refs", "bundles_cached/refs", "states_objs/total", "lua_global_KB", "lua_objects_KB", "lua_distinct_KB", "lua_rules_KB", "scripted_objs", "distinct_scripts", "memory_bags", "chrome", "xml_KB", "events", "setup_calls", "ui_calls", "setup_button", "scripting", "memMB", "reason"];

function row(r) {
  const g = grade(r);
  const kb = (n) => (n / 1000).toFixed(1);
  const fmt = (o) => Object.entries(o ?? {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(", ");
  const c = r.import?.counts ?? {};
  const a = r.assets ?? { image: {}, model: {}, pdf: {}, assetbundle: {} };
  const v = {
    grade: g.grade, grade_if_fetched: g.fetched, name: r.name, file: r.file, players: Array.isArray(r.players) ? r.players.join("-") : r.players ?? "", jsonMB: ((r.jsonBytes ?? 0) / 1e6).toFixed(1),
    objects: r.objects ?? r.rawObjects ?? "", placed: c.placed ?? "", pieces: c.pieces ?? "", decks: c.decks ?? "", cards: c.cards ?? "", bags: c.bags ?? "", dice: c.dice ?? "", seats: r.import?.seats ?? "",
    kinds: fmt(r.kinds), skipped: fmt(r.import?.skipped), standins: fmt(r.import?.structural), uncached_standins: fmt(Object.fromEntries(Object.entries(r.import?.approximated ?? {}).map(([k, n]) => [k, n - (r.import.structural?.[k] ?? 0)]).filter(([, n]) => n > 0))),
    "img_cached/needed": `${a.image.cached ?? ""}/${a.image.needed ?? ""}`, "obj_cached/needed": `${a.model.cached ?? ""}/${a.model.needed ?? ""}`, "pdf_cached/refs": `${a.pdf.cached ?? ""}/${a.pdf.refs ?? ""}`, "bundles_cached/refs": `${a.assetbundle.cached ?? ""}/${a.assetbundle.refs ?? ""}`,
    "states_objs/total": r.states ? `${r.states.objects}/${r.states.total}` : "",
    lua_global_KB: r.lua ? kb(r.lua.global) : "", lua_objects_KB: r.lua ? kb(r.lua.objects) : "", lua_distinct_KB: r.lua ? kb(r.lua.distinctBytes) : "", lua_rules_KB: r.lua ? kb(r.lua.restBytes) : "", scripted_objs: r.lua?.scripted ?? "", distinct_scripts: r.lua?.distinct ?? "", memory_bags: r.lua?.memoryBags ?? "", chrome: r.lua?.chrome ?? "", xml_KB: r.lua ? kb(r.lua.xml) : "",
    events: r.lua?.events ?? "", setup_calls: r.lua?.setupCalls ?? "", ui_calls: r.lua?.uiCalls ?? "", setup_button: r.lua?.setupButton ? "yes" : "no", scripting: r.lua?.scripting ?? "", memMB: r.memMB ?? "", reason: g.reason,
  };
  return COLS.map((k) => String(v[k] ?? "").replace(/[\t\n]/g, " ")).join("\t");
}

async function main() {
  if (args[0] === "--one") {
    const r = await one(args[1]);
    process.stdout.write(JSON.stringify(r));
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const rank = join(OUT, "tts-rank.tsv");
  const apiFile = join(OUT, "tts-lua-api.tsv");
  writeFileSync(rank, COLS.join("\t") + "\n");
  writeFileSync(apiFile, ["name", "file", "scripting", ...API.map(([k]) => k)].join("\t") + "\n");
  const only = opt("only", "") ? new Set(opt("only").split(",")) : null;
  const dir = join(MODS, "Workshop");
  const files = readdirSync(dir).filter((n) => /^\d+\.json$/.test(n) && (!only || only.has(n.replace(/\.json$/, "")))).sort((x, y) => statSync(join(dir, x)).size - statSync(join(dir, y)).size);
  const all = [];
  for (const n of files) {
    const f = join(dir, n);
    const t0 = Date.now();
    const p = spawnSync(process.execPath, [`--max-old-space-size=${MAX_MB}`, SELF, "--one", f, "--mods", MODS], { maxBuffer: 64e6, encoding: "utf8" });
    let r;
    try {
      r = JSON.parse(p.stdout);
    } catch {
      const oom = /heap out of memory|Allocation failed/i.test(p.stderr ?? "");
      r = { file: n, name: n, jsonBytes: statSync(f).size, skippedRun: oom ? `skipped: needs more than ${MAX_MB} MB` : `runner failed: ${(p.stderr ?? "").split("\n").find((l) => /Error/.test(l)) ?? p.status}` };
    }
    all.push(r);
    appendFileSync(rank, row(r) + "\n");
    if (r.api) appendFileSync(apiFile, [r.name, r.file, r.lua.scripting, ...API.map(([k]) => r.api[k])].join("\t") + "\n");
    const g = grade(r);
    console.log(`${g.grade}/${g.fetched}  ${r.name}  (${n}, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.memMB ?? "?"} MB)`);
  }
  writeFileSync(join(OUT, "tts-rank.json"), JSON.stringify(all));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
