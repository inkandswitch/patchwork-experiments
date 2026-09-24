// Contract check for every source in this directory. Run with `npm run check`.
// Verifies what `node --check` cannot: the template exports are Automerge-safe JSON.
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const KINDS = new Set(["num", "int", "bool", "str", "color", "list", "data"]);
const CONTROLS = new Set(["number", "range", "seg", "select", "tiles", "checkbox", "color", "text", "list", "none"]);
const OPTIONS_CONTROLS = new Set(["seg", "select", "tiles"]);
let failures = 0;
const fail = (file, msg) => { failures++; console.log(`FAIL ${file}: ${msg}`); };

function walk(node, path, file) {
  if (node === undefined) return fail(file, `${path} is undefined`);
  if (typeof node === "number" && !Number.isFinite(node)) return fail(file, `${path} is ${node}`);
  if (typeof node === "function") return fail(file, `${path} is a function`);
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, file));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, file);
}

function checkParams(params, path, file) {
  const keys = new Set();
  for (const p of params) {
    const at = `${path}.${p.key ?? "?"}`;
    if (!p.key) fail(file, `${at} has no key`);
    if (keys.has(p.key)) fail(file, `${at} duplicates key ${p.key}`);
    keys.add(p.key);
    if (!KINDS.has(p.kind)) fail(file, `${at} has unknown kind ${p.kind}`);
    if (p.control && !CONTROLS.has(p.control)) fail(file, `${at} has unknown control ${p.control}`);
    if (OPTIONS_CONTROLS.has(p.control) && !Array.isArray(p.options)) fail(file, `${at} is ${p.control} without options`);
    if (p.kind === "list" && !Array.isArray(p.item)) fail(file, `${at} is a list without item`);
    if (p.kind === "list" && p.item) checkParams(p.item, at, file);
    if (p.bucket && p.bucket !== "design" && p.bucket !== "view") fail(file, `${at} has bucket ${p.bucket}`);
    const d = p.default;
    const want = { num: "number", int: "number", bool: "boolean", str: "string", color: "string" }[p.kind];
    if (want && typeof d !== want) fail(file, `${at} default should be ${want}, got ${typeof d}`);
    if (p.kind === "list" && d !== undefined && !Array.isArray(d)) fail(file, `${at} list default is not an array`);
    if (p.kind === "int" && typeof d === "number" && !Number.isInteger(d)) fail(file, `${at} int default ${d} is not an integer`);
    if (p.kind === "color" && typeof d === "string" && !/^#[0-9a-f]{6}$/i.test(d)) fail(file, `${at} color default ${d} is not #rrggbb`);
  }
}

for (const name of readdirSync(new URL(".", import.meta.url)).filter(n => n.endsWith(".js")).sort()) {
  const m = await import(pathToFileURL(new URL(name, import.meta.url).pathname).href);
  const tpl = { version: m.version, params: m.params, output: m.output, presets: m.presets, titleTemplate: m.titleTemplate };
  if (typeof m.version !== "number") fail(name, "version must be a number");
  if (!Array.isArray(m.params)) fail(name, "params must be an array");
  if (!m.output || !Array.isArray(m.output.surfaces) || !m.output.surfaces.length) fail(name, "output.surfaces must be a non-empty array");
  if (typeof m.render !== "function") fail(name, "render must be a function");
  for (const k of ["extent", "notes", "interact", "migrate"]) if (m[k] !== undefined && typeof m[k] !== "function") fail(name, `${k} must be a function`);
  walk(tpl, "template", name);
  if (Array.isArray(m.params)) checkParams(m.params, "params", name);
  const before = failures;
  if (failures === before) console.log(`ok   ${name}: ${m.params?.length ?? 0} params, ${(m.presets ?? []).length} presets, ${m.output?.surfaces?.join("+")}`);
}
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
