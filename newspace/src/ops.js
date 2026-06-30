// The op vocabulary — there are exactly TWO things:
//
//   snapshot  { type:"snapshot", value }     the whole value (sent on connect,
//                                             or to replace the root wholesale)
//   op        { path, range, value }          one universal mutation
//
// One op covers every case because `range` is overloaded:
//   • range = [from, to]  → splice the collection at `path`
//        text:  {path:[], range:[2,5], value:"xyz"}        (string splice)
//        bytes: {path:[], range:[2,5], value:Uint8Array}   (grows/shrinks!)
//        list:  {path:["items"], range:[0,1], value:[a,b]} (array splice)
//   • range = key (string|number) → assign/delete at `path`
//        json:  {path:["user"], range:"name", value:"bob"} (set)
//               {path:["user"], range:"name"}              (delete, value omitted)
//
// `path` is relative to the *opstream's own value*: a text stream's value IS the
// string, so its ops use `path:[]`. A bridge that binds the stream to a field of
// a larger document prepends that field's path on the way down.
//
// (TextOp/BytesOp/JSONOp from littlebook's ops.ts were specializations of this
// single op — collapsed here. The old BytesOp `{pos, value}` couldn't resize.)

export const snapshot = (value) => ({ type: "snapshot", value });

export const op = (path, range, value) => ({ path, range, value });

// sugar over the one op
export const splice = (path, from, to, value) => ({ path, range: [from, to], value });
export const set = (path, key, value) => ({ path, range: key, value });

export const isSnapshot = (x) => !!x && x.type === "snapshot";

// an ERROR flowing down a stream: a third op kind. A node that fails emits one
// instead of a value; downstream consumers can render an error state and the wire
// can go red. The next normal snapshot/op clears it. `error` is a short message.
export const errorOp = (error) => ({ type: "error", error: error && error.message ? error.message : String(error) });
export const isError = (x) => !!x && x.type === "error";

export const isOp = (x) => !!x && !isSnapshot(x) && !isError(x) && "range" in x;

// ── Standard Schema helpers (https://standardschema.dev) ─────────────────────
// An opstream/inlet can carry a `schema` that's a Standard Schema (`~standard`).
// Built-ins below; any zod/valibot/arktype schema also works (no dependency).
const STD = "~standard";

// accepts anything
export function anySchema() {
  return { [STD]: { version: 1, vendor: "sketchy", validate: (value) => ({ value }) } };
}

// a plain string value
export function stringSchema() {
  return {
    [STD]: {
      version: 1,
      vendor: "sketchy",
      validate: (value) => (typeof value === "string" ? { value } : { issues: [{ message: "expected a string" }] }),
      types: { input: "", output: "" },
    },
  };
}

// a finite number value
export function numberSchema() {
  return {
    [STD]: {
      version: 1,
      vendor: "sketchy",
      validate: (value) => (typeof value === "number" && Number.isFinite(value) ? { value } : { issues: [{ message: "expected a number" }] }),
      types: { input: 0, output: 0 },
    },
  };
}

// a File snapshot — what the `file` Source emits: `{ name, type, size,
// lastModified, text }` (the bytes read off disk, refreshed by the watcher). The
// File/handle itself rides in the stream's complement, not the value.
export function fileSchema() {
  return {
    [STD]: {
      version: 1,
      vendor: "sketchy",
      validate: (value) =>
        value && typeof value === "object" && typeof value.name === "string" && "text" in value
          ? { value }
          : { issues: [{ message: "expected a file snapshot { name, text, … }" }] },
    },
  };
}

// a tiny Standard Schema helper — `mk(predicate, message)` (so the discriminating
// schemas below don't repeat the boilerplate). These make ports HONEST about what
// they accept (a scope wants audio, an image display wants a frame, …) instead of
// anySchema()-accepts-anything.
const mk = (check, message) => ({ [STD]: { version: 1, vendor: "sketchy", validate: (value) => (check(value) ? { value } : { issues: [{ message }] }) } });
const isView = (v) => typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v);

// a typed-array buffer (audio samples / pixel data)
export const float32Schema = () => mk((v) => isView(v), "expected a typed array (e.g. Float32Array)");
// an AUDIO source: live levels { rms?, peak? } and/or an analyser in the complement
export const audioSchema = () => mk((v) => (!!v && typeof v === "object" && ("rms" in v || "peak" in v)) || v instanceof Float32Array, "expected an audio source (rms/peak levels or samples)");
// an IMAGE/frame: ImageData / ImageBitmap / { data, width, height } / a url string
export const imageSchema = () => mk(
  (v) => (typeof ImageData !== "undefined" && v instanceof ImageData) || (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) || (!!v && typeof v === "object" && "width" in v && "height" in v) || typeof v === "string",
  "expected an image (ImageData / ImageBitmap / {data,width,height} / url)");
// raw PIXELS: the above OR a bare typed array (dims come from the node's config)
export const pixelsSchema = () => mk(
  (v) => isView(v) || (typeof ImageData !== "undefined" && v instanceof ImageData) || (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) || (!!v && typeof v === "object" && "data" in v),
  "expected pixels (ImageData / {data,width,height} / a typed array)");
// a { x, y } point
export const pointSchema = () => mk((v) => !!v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number", "expected a point { x, y }");
// a MediaStream (a camera/audio stream)
export const streamSchema = () => mk((v) => typeof MediaStream !== "undefined" && v instanceof MediaStream, "expected a MediaStream");
// one of a fixed set of strings (the template-doc <"a"|"b"> enum)
export const enumSchema = (options = []) => mk((v) => options.includes(v), `expected one of: ${options.join(", ")}`);
// a bang — a trigger/edge. Its value is opaque (a unique pulse), so this accepts
// anything; matching is by the "bang" TYPE tag (outletFeedsInlet), not the value.
export const bangSchema = () => mk(() => true, "");

// COMPOSITE schemas — for the TypeScript-ish template syntax (`{a: string}[]` etc.).
const ok = (schema, v) => !schema || !schema[STD] || !schema[STD].validate(v).issues;
export const boolSchema = () => mk((v) => typeof v === "boolean", "expected a boolean");
export const arraySchema = (item) => mk((v) => Array.isArray(v) && v.every((x) => ok(item, x)), "expected an array");
export const objectSchema = (shape = {}, optional = []) => {
  const opt = new Set(optional);
  return mk((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    for (const k of Object.keys(shape)) { if (!(k in v)) { if (!opt.has(k)) return false; continue; } if (!ok(shape[k], v[k])) return false; }
    return true;
  }, "expected an object matching the shape");
};

// A PARAMS schema — BOTH a Standard Schema (validates a { key: value } config object)
// AND an introspectable list of FIELDS the properties panel renders. This is the "real
// schema" a brush/surface declares: one source of truth for validation AND the UI.
//   fields: [{ key, label, type, default?, min?, max?, step?, options? }]
//   type ∈ color | size | slider | number | toggle | select | text
// Unknown keys validate (forward-compatible). `.fields` + `.defaults` hang off the schema.
const FIELD_CHECK = {
  color: (v) => typeof v === "string",
  text: (v) => typeof v === "string",
  size: (v) => typeof v === "number" && v >= 0,
  slider: (v) => typeof v === "number",
  number: (v) => typeof v === "number",
  toggle: (v) => typeof v === "boolean",
};
export function paramsSchema(fields = []) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const schema = mk((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    for (const [k, val] of Object.entries(v)) {
      const f = byKey.get(k);
      if (!f) continue; // unknown key — allowed
      if (f.type === "select") { if (!(f.options || []).some((o) => (o && typeof o === "object" ? o.value : o) === val)) return false; }
      else { const c = FIELD_CHECK[f.type]; if (c && !c(val)) return false; }
    }
    return true;
  }, "invalid params");
  schema.fields = fields;
  schema.defaults = Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
  return schema;
}

// Binary / streaming values that must NEVER be JSON-stringified or deep-compared — a
// camera frame is megabytes of pixel data, and JSON.stringify on it (or Array.from)
// freezes the tab. Treated by identity only, and rendered as a short descriptor.
export function isBinary(v) {
  return !!v && typeof v === "object" && (
    v instanceof ArrayBuffer || ArrayBuffer.isView(v) ||
    (typeof ImageData !== "undefined" && v instanceof ImageData) ||
    (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) ||
    (typeof Blob !== "undefined" && v instanceof Blob) ||
    (typeof MediaStream !== "undefined" && v instanceof MediaStream)
  );
}
export function describeBinary(v) {
  if (typeof ImageData !== "undefined" && v instanceof ImageData) return `[ImageData ${v.width}×${v.height}]`;
  if (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) return `[ImageBitmap ${v.width}×${v.height}]`;
  if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength}b]`;
  if (ArrayBuffer.isView(v)) return `[${v.constructor.name}(${v.length})]`;
  if (typeof Blob !== "undefined" && v instanceof Blob) return `[Blob ${v.size}b]`;
  if (typeof MediaStream !== "undefined" && v instanceof MediaStream) return "[MediaStream]";
  return null;
}
// a JSON.stringify replacer that swaps any binary value for its descriptor — so a
// value carrying (or nested with) a frame stringifies safely instead of freezing.
export const binarySafeReplacer = (_k, val) => describeBinary(val) ?? val;

// Cheap value equality — used to make write-backs IDEMPOTENT so bidirectional
// wires don't loop (a write that changes nothing must not emit → no feedback storm).
// Object.is for primitives/identity; a bounded JSON compare for plain structures.
export function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (isBinary(a) || isBinary(b)) return false; // identity-only; never stringify binary
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// run a Standard Schema synchronously → `{value}` or `{issues}`
export function validate(schema, value) {
  const std = schema && schema[STD];
  if (!std) return { value };
  const out = std.validate(value);
  if (out && typeof out.then === "function") throw new Error("ops: async Standard Schema validation unsupported");
  return out;
}
