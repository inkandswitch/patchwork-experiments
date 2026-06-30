// A relaxed TypeScript-ish template syntax for the template-doc. Write an object literal where
//   • LITERAL values stay literal:        "@patchwork": { type: "folder" }
//   • TYPE annotations become wireable INLETS to fill:
//        docs: { url: string, title: string, type?: string }[]
//        conf: { a: string }
//
// A "type" is a bare `string | number | boolean | any`, an object type `{ … }`, or an array
// `T[]`. A `?` after a key marks it optional. The inlet for a nested hole is named by its dot
// path (`conf.a`); an object-array (`{…}[]`) is ONE inlet whose schema is array-of-object.
//
//   parseTemplateTS(text) -> { holes: [{ name, type, schema, optional }], build(get), error }
import { stringSchema, numberSchema, boolSchema, anySchema, arraySchema, objectSchema } from "./ops.js";

function tokenize(src) {
  const toks = [];
  let i = 0; const n = src.length;
  const isIdent = (c) => /[A-Za-z0-9_@$.]/.test(c);
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "\n") { toks.push({ type: "nl" }); i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if ("{}[]:,?".includes(c)) { toks.push({ type: c }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, s = "";
      while (j < n && src[j] !== q) { if (src[j] === "\\") { s += src[j + 1]; j += 2; } else { s += src[j]; j++; } }
      toks.push({ type: "str", value: s }); i = j + 1; continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1; while (j < n && /[0-9.eE+-]/.test(src[j])) j++;
      toks.push({ type: "num", value: Number(src.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_@$]/.test(c)) {
      let j = i + 1; while (j < n && isIdent(src[j])) j++;
      toks.push({ type: "ident", value: src.slice(i, j) }); i = j; continue;
    }
    i++; // skip anything else
  }
  return toks;
}

const primSchema = (name) => name === "string" ? stringSchema() : name === "number" ? numberSchema() : name === "boolean" ? boolSchema() : anySchema();
const coarse = (name) => name === "string" ? "text" : name === "number" ? "number" : "json";

export function parseTemplateTS(text) {
  let toks;
  try { toks = tokenize(text || ""); } catch (e) { return fail(e); }
  let pos = 0; const holes = [];
  const peek = () => toks[pos];
  const skip = () => { while (peek() && peek().type === "nl") pos++; };
  const at = (t) => { skip(); return peek() && peek().type === t; };
  const next = () => { skip(); return toks[pos++]; };
  const expect = (t) => { if (!at(t)) throw new Error(`expected '${t}'`); return next(); };

  // consume trailing `[]` suffixes, wrapping the schema in arraySchema each time
  function arraySuffix(schema, type) {
    while (at("[")) { const save = pos; next(); if (at("]")) { next(); schema = arraySchema(schema); type = "json"; } else { pos = save; break; } }
    return { schema, type };
  }

  function value(path) {
    skip(); const t = peek();
    if (!t) throw new Error("unexpected end of template");
    if (t.type === "str") { next(); return { lit: t.value }; }
    if (t.type === "num") { next(); return { lit: t.value }; }
    if (t.type === "[") return arrayLiteral(path);
    if (t.type === "{") return objectNode(path);
    if (t.type === "ident") {
      next();
      if (t.value === "true") return { lit: true };
      if (t.value === "false") return { lit: false };
      if (t.value === "null") return { lit: null };
      const { schema, type } = arraySuffix(primSchema(t.value), coarse(t.value)); // a primitive TYPE hole
      const name = path.length ? path.join(".") : "value"; holes.push({ name, schema, type, optional: false });
      return { hole: name, schema };
    }
    throw new Error(`unexpected '${t.type}'`);
  }

  function arrayLiteral(path) {
    expect("[");
    const items = [];
    while (!at("]")) { items.push(value([...path, items.length])); skip(); if (at(",")) next(); skip(); }
    expect("]");
    return { arr: items };
  }

  function objectNode(path) {
    expect("{");
    const members = []; const startHoles = holes.length;
    while (!at("}")) {
      skip(); if (at("}")) break;
      const kt = next();
      const key = kt.type === "str" || kt.type === "ident" ? kt.value : kt.type === "num" ? String(kt.value) : (() => { throw new Error("expected a key"); })();
      let optional = false; if (at("?")) { next(); optional = true; }
      expect(":");
      const node = value([...path, key]);
      members.push({ key, optional, node });
      skip(); if (at(",")) next();
    }
    expect("}");
    // `{…}[]` → an ARRAY-OF-OBJECT TYPE: one inlet, not per-field holes
    if (at("[")) {
      const save = pos; next();
      if (at("]")) {
        next(); holes.length = startHoles; // drop the per-field holes the members added
        const shape = {}, opt = [];
        for (const m of members) { shape[m.key] = schemaOf(m.node); if (m.optional) opt.push(m.key); }
        const name = path.length ? path.join(".") : "value", schema = arraySchema(objectSchema(shape, opt));
        holes.push({ name, schema, type: "json", optional: false });
        return { hole: name, schema };
      }
      pos = save;
    }
    return { obj: members };
  }

  // schema of a parsed node (for nesting inside an object/array TYPE)
  function schemaOf(node) {
    if ("hole" in node) return node.schema;
    if (node.obj) { const shape = {}, opt = []; for (const m of node.obj) { shape[m.key] = schemaOf(m.node); if (m.optional) opt.push(m.key); } return objectSchema(shape, opt); }
    if (node.arr) return arraySchema(node.arr[0] ? schemaOf(node.arr[0]) : anySchema());
    return anySchema(); // a literal — anything
  }

  let tree;
  try { tree = value([]); skip(); if (peek()) throw new Error("trailing input after the template"); }
  catch (e) { return fail(e); }

  function buildNode(node, get) {
    if ("lit" in node) return node.lit;
    if ("hole" in node) return get(node.hole);
    if (node.obj) { const o = {}; for (const m of node.obj) { const v = buildNode(m.node, get); if (v !== undefined || !m.optional) o[m.key] = v; } return o; }
    if (node.arr) return node.arr.map((x) => buildNode(x, get));
    return undefined;
  }
  return { holes, build: (get) => buildNode(tree, get), error: null };
}

function fail(e) { return { holes: [], build: () => ({}), error: String((e && e.message) || e) }; }
