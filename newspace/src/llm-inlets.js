// The LLM's inlet set, derived from its prompt. Kept in a tiny dep-free module (no
// @chee/patchwork-llm import) so it can be imported synchronously by the registry
// while the heavy mount stays lazy. A `{{var}}` hole in the prompt becomes a text
// inlet named `var`, filled into the prompt at run time.
import { anySchema, stringSchema } from "./ops.js";

export const VAR_RE = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g;

export function promptVars(prompt) {
  const names = []; let m;
  const re = new RegExp(VAR_RE.source, "g");
  while ((m = re.exec(prompt || ""))) if (!names.includes(m[1])) names.push(m[1]);
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
  while ((m = re.exec(prompt || ""))) if (!names.includes(m[1])) names.push(m[1]);
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
