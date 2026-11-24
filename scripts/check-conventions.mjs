#!/usr/bin/env node
/**
 * Check that every name by which one package reaches another is written down.
 *
 * Packages here never import each other; they meet at run time through names
 * (scene/CONVENTIONS.md). This scans the source of every package present in
 * the checkout (a top-level folder with a package.json whose source registers
 * a `scene:*` plugin; tests, probes, scripts, fixtures, contract folders,
 * vendored and generated code left out, comments stripped) for those names,
 * works out which cross a package boundary, and fails when one isn't listed
 * in CONVENTIONS.md's "Names" table (or, for a name with no other owner,
 * stated in scene's STAGE.md, NATIVE.md or EDITOR.md: the kernel's members,
 * the native services, the editor's).
 *
 * Who owns a name:
 *   - a dotted name `ns.rest` (a trait key, a part or plugin id, a
 *     contribution) is the package that registers a `scene:*` plugin whose id
 *     is `ns` or starts `ns.`;
 *   - a bare name equal to a registered plugin id (`seats`, `water`,
 *     `doom-map`) is that plugin's package;
 *   - any other name (a contribution, service, ambient, body id, GLB extras
 *     field, MIME type, DOM event) has no owner the code can show: it crosses
 *     when two or more packages mention it in that role, and the table says
 *     who owns it.
 *
 * What it sees, by role (NAME is a string literal, or a same-file
 * `const X = "literal"`):
 *   - any string literal shaped `ns.rest` with a known namespace (a file name
 *     such as "scene.js" is not one);
 *   - traits: `traits?.[NAME]`, `traits.name`, `traits[NAME] =`, the first
 *     key of `traits: { … }`;
 *   - plugin ids: `.get(NAME)`, `.has(NAME)`, `.load(NAME)`, `id === NAME`,
 *     `providerId: NAME`;
 *   - contributions, services, ambients: `collect(NAME)`, `use(NAME)`,
 *     `ambient(NAME)` read; offered as an object key `name:` or method
 *     `name(` at the start of an object entry;
 *   - body ids: `body.enter(NAME`, `body.id === NAME`, `start … body: NAME`;
 *     offered as `id: NAME`;
 *   - GLB extras fields: `extras.name`, `extras[NAME]` read; the keys of
 *     `extras: { … }` / `extras = { … }` (up to the first `}`) offered;
 *   - MIME types `application|text|model/x-…`; DOM events with a `:` in
 *     `CustomEvent(NAME`; plugin types `x:y` after `type:` or in
 *     `registry(NAME)` / `getRegistry(NAME)`.
 *
 * What it can't see: a name built at run time (`${ns}.${k}`), passed through
 * a function parameter or imported from another file of the same package; a
 * field read inside a value (a trait's fields, a contribution's members, a
 * doc format such as patchwork-rig: only the name that leads to it); plugin
 * metadata fields read off the registry (`roster`, `keeper`); `userData` on
 * three.js objects; channel keys; names in comments (stripped). Comment
 * stripping is a small tokenizer that doesn't know regex literals, so a
 * regex holding a quote can hide or invent a name. It checks that a listed
 * name's spec file mentions it (a word in backticks), not that the spec is
 * right.
 *
 * The scene package names no other package's name at all, listed or not.
 *
 * Usage: node scripts/check-conventions.mjs [--list]
 *   --list   print every crossing name found, with who uses it
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONVENTIONS = join(ROOT, "scene", "CONVENTIONS.md");
const CONTRACTS = ["STAGE.md", "NATIVE.md", "EDITOR.md"].map((p) => join(ROOT, "scene", p));
const SKIP = new Set(["node_modules", "dist", ".git", ".pushwork", ".claude", "static-dist", ".pnpm-store", "test", "tests", "probes", "scripts", "fixtures", "bench", "vendor", "public", "contract", "generated"]);
const SOURCE = /\.(m?js|ts|tsx|jsx)$/;
const NOT_SOURCE = /(\.test\.|\.spec\.|^vite\.config|^vitest)/;
const FILE_EXT = /\.(m?js|ts|json|glb|gltf|md|css|html|wasm|png|jpe?g|svg|scad|wad|stl|txt)$/;
const list = process.argv.includes("--list");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (SOURCE.test(name) && !NOT_SOURCE.test(name)) yield p;
  }
}

/** The text with comments blanked out (strings kept; regex literals not understood). */
function stripComments(t) {
  let out = "";
  for (let i = 0; i < t.length; ) {
    const c = t[i];
    const n = t[i + 1];
    if (c === "/" && n === "/") {
      while (i < t.length && t[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = t.indexOf("*/", i + 2);
      const stop = end < 0 ? t.length : end + 2;
      out += t.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < t.length && t[j] !== c && !(c !== "`" && t[j] === "\n")) j += t[j] === "\\" ? 2 : 1;
      out += t.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ─── the packages present, their source, and the plugin ids they register ───

const packages = new Map(); // name → [{ path, code, consts }]
const ids = new Map(); // plugin id → package
for (const name of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, name);
  if (SKIP.has(name) || name.startsWith(".") || !statSync(dir).isDirectory() || !existsSync(join(dir, "package.json"))) continue;
  const srcs = [];
  for (const path of files(dir)) {
    const code = stripComments(readFileSync(path, "utf8"));
    const consts = new Map();
    for (const m of code.matchAll(/\b([A-Z_][A-Z0-9_]*|[a-z][A-Za-z0-9]*)\s*=\s*(["'])([^"'\n]+)\2\s*[,;\n]/g)) consts.set(m[1], m[3]);
    srcs.push({ path, code, consts });
  }
  const own = [];
  for (const { code } of srcs) {
    for (const m of code.matchAll(/type:\s*["']scene:(?:extension|view|source|template|part)["']/g)) {
      const after = code.slice(m.index + m[0].length, m.index + 400).split(/\btype:\s*["']/)[0];
      const id = after.match(/\bid:\s*["'`]([a-z][\w-]*(?:\.[\w-]+)*)/)?.[1];
      if (id) own.push(id);
    }
  }
  if (!own.length) continue;
  // a constant another file of the package imports: its one value across the package
  const shared = new Map();
  for (const { consts } of srcs) for (const [k, v] of consts) shared.set(k, shared.has(k) && shared.get(k) !== v ? null : v);
  for (const src of srcs) src.consts = new Map([...[...shared].filter(([, v]) => v != null), ...src.consts]);
  packages.set(name, srcs);
  for (const id of own) {
    if (ids.has(id) && ids.get(id) !== name) console.log(`AMBIGUOUS  plugin id "${id}" is registered by both ${ids.get(id)} and ${name}`);
    ids.set(id, name);
  }
}
const namespaces = new Map(); // first segment of a dotted plugin id → package
for (const [id, pkg] of ids) if (!namespaces.has(id.split(".")[0])) namespaces.set(id.split(".")[0], pkg);

/** Who owns a name, if the code can say. */
function ownerOf(name) {
  if (ids.has(name)) return ids.get(name);
  const dot = name.indexOf(".");
  if (dot > 0 && !FILE_EXT.test(name)) return namespaces.get(name.slice(0, dot)) ?? null;
  const colon = name.indexOf(":");
  if (colon > 0 && packages.has(name.slice(0, colon))) return name.slice(0, colon);
  return null;
}

// ─── what each package mentions ──────────────────────────────────────────────

const uses = new Map(); // name → { kinds: Set, by: Map(pkg → Set(file:line)) }
function use(name, kind, pkg, path, code, index) {
  if (!name) return;
  const line = code.slice(0, index).split("\n").length;
  const u = uses.get(name) ?? { kinds: new Set(), by: new Map() };
  u.kinds.add(kind);
  (u.by.get(pkg) ?? u.by.set(pkg, new Set()).get(pkg)).add(`${relative(ROOT, path)}:${line}`);
  uses.set(name, u);
}

const LIT = String.raw`(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z_$][\w$]*))`;
const valueOf = (m, at, consts) => m[at] ?? m[at + 1] ?? (m[at + 2] != null ? (consts.get(m[at + 2]) ?? null) : null);
const ROLES = [
  // [kind, pattern: its first literal group is the name]
  ["trait", String.raw`traits\??\.?\[\s*${LIT}\s*\]`],
  ["trait", String.raw`traits:\s*\{\s*\[?\s*${LIT}\s*\]?\s*:`],
  ["plugin id", String.raw`\b(?:registry|getRegistry|parts|reg)\b[^;\n]{0,60}?\.(?:get|has|load)\??\.?\(\s*${LIT}\s*\)`],
  ["plugin id", String.raw`(?<!typeof\s+(?:[\w$]+\??\.)*)\bid\s*===\s*${LIT}`],
  ["plugin id", String.raw`providerId:\s*${LIT}`],
  ["contribution", String.raw`\bcollect\??\.?\(\s*${LIT}`],
  ["service", String.raw`\buse\??\.?\(\s*${LIT}`],
  ["ambient", String.raw`\bambient\??\.?\(\s*${LIT}`],
  ["body id", String.raw`\bbody\??\.enter\(\s*${LIT}`],
  ["body id", String.raw`\bbody\??\.id\s*[!=]==\s*${LIT}`],
  ["body id", String.raw`\bstart\b[^;]{0,80}?\bbody:\s*${LIT}`],
  ["extras", String.raw`\bextras\??\.\??\[\s*${LIT}\s*\]`],
  ["event", String.raw`\bCustomEvent\(\s*${LIT}`],
  ["plugin type", String.raw`\b(?:getRegistry|registry)\??\.?\(\s*${LIT}`],
].map(([kind, re]) => [kind, new RegExp(re, "g")]);

const offers = []; // [pkg, code, consts] for the offered-side lookups below
for (const [pkg, srcs] of packages) {
  for (const { path, code, consts } of srcs) {
    offers.push([pkg, code, consts]);
    // any dotted literal in a known namespace
    for (const m of code.matchAll(/(["'`])([a-z][\w-]*(?:\.[\w-]+)+)\1/g)) if (ownerOf(m[2]) && !FILE_EXT.test(m[2])) use(m[2], "name", pkg, path, code, m.index);
    for (const [kind, re] of ROLES) {
      for (const m of code.matchAll(re)) {
        const name = valueOf(m, 1, consts);
        if (kind !== "plugin id" || ownerOf(name ?? "")) use(name, kind, pkg, path, code, m.index);
      }
    }
    for (const m of code.matchAll(/(?<![\w/.$])traits\??\.([a-z][\w]*)\b(?!\s*\()/g)) if (!["length", "map", "some", "add", "has", "every", "filter", "includes", "forEach", "find", "push"].includes(m[1])) use(m[1], "trait", pkg, path, code, m.index);
    for (const m of code.matchAll(/\bextras\??\.([a-zA-Z_]\w*)/g)) use(m[1], "extras", pkg, path, code, m.index);
    for (const m of code.matchAll(/\bextras\s*[:=]\s*\{([^}]*)/g)) for (const k of m[1].matchAll(/(?:^|,)\s*([a-zA-Z_]\w*)\s*:/g)) use(k[1], "extras", pkg, path, code, m.index);
    for (const m of code.matchAll(/(["'`])((?:application|text|model)\/x-[\w.+-]+)\1/g)) use(m[2], "MIME type", pkg, path, code, m.index);
    for (const m of code.matchAll(/\btype:\s*(["'])([a-z][\w-]*:[a-z][\w-]*)\1/g)) use(m[2], "plugin type", pkg, path, code, m.index);
  }
}
// the offered side of contributions, services, ambients and body ids, for names something reads
for (const [name, u] of uses) {
  if (!["contribution", "service", "ambient", "body id"].some((k) => u.kinds.has(k)) || ownerOf(name)) continue;
  const esc = name.replace(/[$]/g, "\\$&");
  const key = new RegExp(String.raw`(?:^|[{,])\s*(?:(?:${esc}|"${esc}")\s*:|(?:get\s+"${esc}"|${esc})\s*\([^)]*\)\s*\{)`, "m");
  const idKey = new RegExp(String.raw`\bid:\s*["']${esc}["']`);
  for (const [pkg, code, consts] of offers) {
    const computed = [...consts].some(([k, v]) => v === name && new RegExp(String.raw`\[\s*${k}\s*\]\s*:`).test(code));
    const offered = u.kinds.has("body id") && u.kinds.size === 1 ? idKey.test(code) : key.test(code) || computed;
    if (offered) {
      if (!u.by.has(pkg)) u.by.set(pkg, new Set([`${pkg} (offers it)`]));
    }
  }
}

// ─── what is written down ─────────────────────────────────────────────────────

const table = new Map(); // name → { owner, spec }
const text = existsSync(CONVENTIONS) ? readFileSync(CONVENTIONS, "utf8") : "";
const section = text.split(/^## /m).find((s) => s.startsWith("Names")) ?? "";
for (const row of section.split("\n").filter((l) => l.startsWith("| `"))) {
  const cells = row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  const [names, , owner, , spec] = cells;
  for (const m of names.matchAll(/`([^`]+)`/g)) table.set(m[1], { owner: owner.replace(/`/g, ""), spec: spec ?? "" });
}
const stated = new Set();
for (const p of CONTRACTS) if (existsSync(p)) for (const m of readFileSync(p, "utf8").matchAll(/`"?([^`"\s(:,{[]+)/g)) stated.add(m[1]);

// ─── crossings ────────────────────────────────────────────────────────────────

const bad = [];
const crossing = [];
for (const [name, u] of [...uses].sort(([a], [b]) => a.localeCompare(b))) {
  const owner = ownerOf(name);
  const users = [...u.by.keys()];
  const crosses = owner ? users.some((p) => p !== owner) : users.length >= 2;
  if (!crosses) continue;
  const kind = [...u.kinds].filter((k) => k !== "name").join(", ") || "name";
  crossing.push({ name, kind, owner, users });
  const row = table.get(name);
  const where = (p) => [...u.by.get(p)].slice(0, 2).join(", ");
  if (owner && owner !== "scene" && u.by.has("scene")) bad.push(`LEAK     scene names ${owner}'s \`${name}\` (${where("scene")})`);
  if (row) {
    if (owner && row.owner !== owner) bad.push(`OWNER    \`${name}\` is ${owner}'s, the table says ${row.owner}`);
    continue;
  }
  if ((!owner || owner === "scene") && stated.has(name)) continue;
  const strangers = users.filter((p) => p !== owner);
  bad.push(`UNLISTED \`${name}\` (${kind}${owner ? `, ${owner}'s` : ""}) used by ${strangers.map((p) => `${p} (${where(p)})`).join("; ")}`);
}
// each listed name is stated where the table says (when that package is here)
for (const [name, { spec }] of table) {
  const file = spec.match(/[\w./-]+\.md/)?.[0];
  if (!file) continue;
  const path = file.includes("/") ? join(ROOT, file) : join(ROOT, "scene", file);
  if (!existsSync(dirname(path)) || !existsSync(path)) {
    if (existsSync(dirname(path))) bad.push(`NO SPEC  \`${name}\`: ${file} doesn't exist`);
    continue;
  }
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(String.raw`(?<![\w-])${esc}(?![\w-])`);
  if (![...readFileSync(path, "utf8").matchAll(/`([^`\n]+)`/g)].some((m) => word.test(m[1]))) bad.push(`NO SPEC  \`${name}\` isn't stated in ${file}`);
}

if (list) for (const c of crossing) console.log(`${c.name.padEnd(28)} ${c.kind.padEnd(22)} ${(c.owner ?? "?").padEnd(10)} ${c.users.join(", ")}`);
for (const b of bad) console.log(b);
const byKind = {};
for (const c of crossing) byKind[c.kind.split(", ")[0]] = (byKind[c.kind.split(", ")[0]] ?? 0) + 1;
console.log(`${packages.size} packages, ${crossing.length} names cross a package boundary (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")}); ${table.size} listed${bad.length ? `; ${bad.length} problems` : "; all written down"}`);
if (bad.length) process.exitCode = 1;
