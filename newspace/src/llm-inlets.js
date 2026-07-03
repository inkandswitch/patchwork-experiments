// The LLM's inlet set, derived from its prompt. Kept in a tiny dep-free module (no
// @chee/patchwork-llm import) so it can be imported synchronously by the registry
// while the heavy mount stays lazy. A `{{var}}` hole in the prompt becomes a text
// inlet named `var`, filled into the prompt at run time.
import { anySchema, stringSchema } from "./ops.js";

export const VAR_RE = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g;

// the FIXED port names. A {{in}}/{{prompt}}/{{bang}} hole or an `@out out` line must
// not mint a twin of a fixed port — ports are name-keyed in the wiring, so a duplicate
// name collides. The fixed ports win; templates still FILL from them ({{in}} reads the
// fixed `in` inlet), they just don't redeclare them.
const RESERVED_INLETS = ["in", "prompt", "bang"];
const RESERVED_OUTLETS = ["out", "think", "code"];

export function promptVars(prompt) {
  const names = []; let m;
  const re = new RegExp(VAR_RE.source, "g");
  while ((m = re.exec(prompt || ""))) if (!names.includes(m[1]) && !RESERVED_INLETS.includes(m[1])) names.push(m[1]);
  return names;
}

// in/prompt/bang are fixed; each {{var}} adds a text inlet
export function llmInlets(config) {
  const base = [
    { name: "in", type: "json", schema: anySchema() },
    { name: "prompt", type: "text", schema: stringSchema() },
    { name: "bang", type: "bang" },
  ];
  return [...base, ...promptVars(config && config.prompt).map((n) => ({ name: n, type: "text", schema: stringSchema(), param: true }))];
}

// A `@out name` (or `@outlet name`) line in the prompt declares an EXTRA named outlet.
// So you ask the model for several things at once and wire each one separately.
const OUTLET_RE = /^[ \t]*@out(?:let)?\s+([a-zA-Z_]\w*)/gm;
export function promptOutlets(prompt) {
  const names = []; let m;
  const re = new RegExp(OUTLET_RE.source, "gm");
  while ((m = re.exec(prompt || ""))) if (!names.includes(m[1]) && !RESERVED_OUTLETS.includes(m[1])) names.push(m[1]);
  return names;
}
// `out` (the clean final result) + `think` (live tokens / reasoning, so `out` stays
// clean) + one outlet per `@out name` declaration.
export function llmOutlets(config) {
  const extra = promptOutlets(config && config.prompt);
  return [
    { name: "out", type: "json", schema: anySchema() },
    { name: "think", type: "text", schema: stringSchema() },
    // in λ code mode the generated transform is a BIDI text outlet — wire it to a
    // codemirror node to read/edit it; edits flow back, recompile, and re-run.
    ...(config && config.code ? [{ name: "code", type: "text", schema: stringSchema() }] : []),
    ...extra.map((n) => ({ name: n, type: "json", schema: anySchema() })),
  ];
}

// ── REAL schema→schema (ask for + validate the consumer's Standard Schema) ───
// Which inlets (on which items) does an outlet of node `itemId` feed? A pure scan
// of the layout items — an editor item's `inlets` map stores its wiring, a
// node-outlet wiring being `{node, outlet}` (see portWiring in wire.js).
export function outletConsumers(items, itemId, outlet = "out") {
  const found = [];
  for (const it of items || []) {
    if (!it || it.kind !== "editor" || !it.inlets) continue;
    for (const [name, w] of Object.entries(it.inlets)) {
      if (w && w.node === itemId && (w.outlet || "out") === outlet) found.push({ item: it, inlet: name });
    }
  }
  return found;
}

const STD = "~standard";
// Derive a READABLE spec of a Standard Schema for the prompt. Two sources:
//   • a paramsSchema-style schema carries `.fields` — describe each field;
//   • otherwise PROBE the validator with a value no meaningful schema accepts
//     (a symbol passes no typeof/instanceof check), so the schema's own
//     rejection message ("expected a number") becomes the spec.
// anySchema / bang accept everything ⇒ null: no constraint worth prompting (and
// the caller then keeps the plain best-effort path).
const PROBE = typeof Symbol === "function" ? Symbol("schema probe") : { "schema probe": true };
const FIELD_TYPE = { color: "string (a colour)", text: "string", size: "number", slider: "number", number: "number", toggle: "boolean", select: "string" };
export function schemaSpec(schema) {
  if (!schema || !schema[STD]) return null;
  if (Array.isArray(schema.fields) && schema.fields.length) {
    const lines = schema.fields.map((f) => {
      const opts = f.type === "select" && f.options ? ` (one of: ${f.options.map((o) => (o && typeof o === "object" ? o.value : o)).join(", ")})` : "";
      return `  "${f.key}": ${FIELD_TYPE[f.type] || f.type}${opts}`;
    });
    return "a JSON object with these fields:\n" + lines.join("\n");
  }
  try {
    const res = schema[STD].validate(PROBE);
    if (!res || typeof res.then === "function") return null; // async — can't probe sync
    const msg = (res.issues || []).map((i) => i && i.message).filter(Boolean).join("; ");
    return msg || null;
  } catch {
    return null;
  }
}

// the system-prompt line derived from a spec
export const schemaRule = (spec) =>
  spec ? `The output MUST be ${spec}. Output ONLY a value matching that shape — nothing else.` : "";

// Validate a parsed result against a Standard Schema → { ok:true, value } (the
// schema may coerce it) or { ok:false, issues, message }. Async validation can't
// be awaited synchronously, so it passes through unchecked.
export function validateAgainst(schema, value) {
  const std = schema && schema[STD];
  if (!std) return { ok: true, value };
  let res;
  try { res = std.validate(value); } catch (e) { return failure([{ message: (e && e.message) || String(e) }]); }
  if (!res || typeof res.then === "function") return { ok: true, value };
  if (res.issues && res.issues.length) return failure(res.issues);
  return { ok: true, value: "value" in res ? res.value : value };
}
const failure = (issues) => ({ ok: false, issues, message: issues.map((i) => (i && i.message) || "invalid").join("; ") });

// The validate-or-retry DECISION (pure): a first failure ⇒ retry once with the
// validation issues appended to the prompt; a failing retry ⇒ surface an error
// op — never emit garbage. Returns one of:
//   { action:"emit",  value }               valid (possibly schema-coerced)
//   { action:"retry", appendix, message }   re-generate with `appendix` added
//   { action:"error", message, issues }     give up — push an error op
export function validationPlan(schema, value, attempt = 0, maxRetries = 1) {
  const check = validateAgainst(schema, value);
  if (check.ok) return { action: "emit", value: check.value };
  if (attempt < maxRetries)
    return {
      action: "retry",
      message: check.message,
      appendix:
        `Your previous output did not match the required shape. Validation issues: ${check.message}. ` +
        "Produce ONLY a corrected result that matches the required shape.",
    };
  return { action: "error", message: `output did not match the expected shape: ${check.message}`, issues: check.issues };
}

// Split a multi-outlet response into named blocks delimited by lines like
// `[[outlet:NAME]]`. Text before the first marker lands on `out`, so an unmarked
// response still works. Returns { name: content }.
export function parseOutletBlocks(text) {
  const src = text || "";
  const re = /^[ \t]*\[\[\s*outlet:\s*([a-zA-Z_]\w*)\s*\]\][ \t]*\n?/gm;
  const segs = []; let last = 0, name = null, m;
  while ((m = re.exec(src))) { segs.push({ name, body: src.slice(last, m.index) }); name = m[1]; last = re.lastIndex; }
  segs.push({ name, body: src.slice(last) });
  const out = {};
  for (const s of segs) {
    const body = s.body.trim();
    const key = s.name == null ? "out" : s.name;
    if (!body && s.name == null) continue;
    out[key] = out[key] ? out[key] + "\n" + body : body;
  }
  return out;
}

// Clamp parsed blocks to the DECLARED outlets (the fixed ports + the prompt's @out
// names): the model may label a block with a name nobody declared, and pushing that
// would mint a phantom live port. An undeclared block FOLDS INTO `out` — the same
// rule as unmarked text before the first marker — so no content is lost and no
// phantom port appears.
export function clampOutletBlocks(blocks, names = []) {
  const allowed = new Set([...RESERVED_OUTLETS, ...names]);
  const out = {};
  for (const [k, v] of Object.entries(blocks || {})) {
    const key = allowed.has(k) ? k : "out";
    out[key] = out[key] != null ? out[key] + "\n" + v : v;
  }
  return out;
}
