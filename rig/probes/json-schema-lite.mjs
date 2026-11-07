// A small JSON Schema (2020-12) checker for the keywords contract/v1/schema.json
// uses: type, $ref (local #/$defs/…), properties, required,
// additionalProperties, items, enum, const, anyOf, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, minItems, maxItems. Anything else in
// the schema is reported, so a schema that grows a keyword can't pass by
// being ignored. Written for the probe, independent of contract/v1/validate.js,
// so the GLB's extras.rig is checked against the schema file itself.

const KNOWN = new Set(["$schema", "$id", "$defs", "title", "description", "type", "$ref", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "default", "examples", "$comment"]);

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === "number" && typeOf(v) === "integer");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateSchema(root, value) {
  const errors = [];
  const unknown = new Set();
  const resolve = (ref) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
    return ref.slice(2).split("/").reduce((o, k) => o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], root);
  };
  function check(s, v, path, out) {
    if (s === true) return;
    if (s === false) return void out.push({ path, message: "not allowed" });
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) unknown.add(k);
    if (s.$ref) {
      const t = resolve(s.$ref);
      if (!t) return void out.push({ path, message: `unresolved ${s.$ref}` });
      check(t, v, path, out);
    }
    if (s.type) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some((t) => isType(v, t))) return void out.push({ path, message: `is ${typeOf(v)}, wants ${ts.join("|")}` });
    }
    if (s.const !== undefined && !eq(s.const, v)) out.push({ path, message: `≠ const ${JSON.stringify(s.const)}` });
    if (s.enum && !s.enum.some((e) => eq(e, v))) out.push({ path, message: `${JSON.stringify(v)} not in enum` });
    if (s.anyOf) {
      const tries = s.anyOf.map((sub) => { const o = []; check(sub, v, path, o); return o; });
      if (!tries.some((o) => o.length === 0)) out.push({ path, message: `matches none of anyOf (${tries.map((o) => o[0]?.message).join(" / ")})` });
    }
    if (typeof v === "number") {
      if (s.minimum != null && !(v >= s.minimum)) out.push({ path, message: `${v} < minimum ${s.minimum}` });
      if (s.maximum != null && !(v <= s.maximum)) out.push({ path, message: `${v} > maximum ${s.maximum}` });
      if (s.exclusiveMinimum != null && !(v > s.exclusiveMinimum)) out.push({ path, message: `${v} ≤ exclusiveMinimum ${s.exclusiveMinimum}` });
      if (s.exclusiveMaximum != null && !(v < s.exclusiveMaximum)) out.push({ path, message: `${v} ≥ exclusiveMaximum ${s.exclusiveMaximum}` });
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) out.push({ path, message: `${v.length} items < ${s.minItems}` });
      if (s.maxItems != null && v.length > s.maxItems) out.push({ path, message: `${v.length} items > ${s.maxItems}` });
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}/${i}`, out));
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const r of s.required ?? []) if (!(r in v)) out.push({ path, message: `missing ${r}` });
      const props = s.properties ?? {};
      for (const [k, x] of Object.entries(v)) {
        if (k in props) check(props[k], x, `${path}/${k}`, out);
        else if (s.additionalProperties === false) out.push({ path: `${path}/${k}`, message: "additional property" });
        else if (s.additionalProperties && typeof s.additionalProperties === "object") check(s.additionalProperties, x, `${path}/${k}`, out);
      }
    }
  }
  check(root, value, "", errors);
  return { ok: errors.length === 0 && unknown.size === 0, errors, unknownKeywords: [...unknown] };
}
