import { stringSchema, anySchema, numberSchema, fileSchema, imageSchema } from "../opstreams.js";
import { rleEncode, rleDecode } from "../rle.js";

function recase(view, src, cased) {
  if (typeof view !== "string") return undefined;
  const orig = typeof src === "string" ? src : "";
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const oc = orig[i];
    out += oc && oc[cased]() === view[i] ? oc : view[i];
  }
  return out;
}

export const mediaLensPlugins = [
  {
    type: "sketchy:lens", id: "image-to-dataurl", name: "image \u2192 data URL", icon: "Link",
    inlet: { name: "in", type: "image", schema: imageSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (img) => {
      if (typeof img === "string") return img;
      if (typeof document === "undefined" || typeof ImageData === "undefined" || !(img instanceof ImageData)) return "";
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      c.getContext("2d").putImageData(img, 0, 0);
      try { return c.toDataURL("image/png"); } catch { return ""; }
    },
  },
];

export const wireLensPlugins = [
  {
    type: "sketchy:lens",
    id: "number-to-string",
    name: "number \u2192 string",
    icon: "Type",
    inlet: { name: "in", type: "number", schema: numberSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (v) => (v == null ? "" : String(v)),
    unproject: (str) => { const n = Number(str); return Number.isFinite(n) ? n : undefined; },
  },
  {
    type: "sketchy:lens",
    id: "json-parse",
    name: "JSON parse",
    icon: "Braces",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (s) => { if (typeof s !== "string") return s ?? null; try { return JSON.parse(s); } catch { return null; } },
    unproject: (v) => { try { return JSON.stringify(v, null, 2); } catch { return undefined; } },
  },
  {
    type: "sketchy:lens",
    id: "file-to-text",
    name: "File \u2192 text",
    icon: "FileText",
    inlet: { name: "in", type: "file", schema: fileSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (f) => (f && typeof f.text === "string" ? f.text : ""),
  },
  {
    type: "sketchy:lens",
    id: "file-to-json",
    name: "File -> JSON",
    icon: "Braces",
    inlet: { name: "in", type: "file", schema: fileSchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (f) => { if (!f || typeof f.text !== "string") return null; try { return JSON.parse(f.text); } catch { return null; } },
  },
  {
    type: "sketchy:lens", id: "string-to-number", name: "string \u2192 number", icon: "Hash",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "number", schema: numberSchema() },
    project: (s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; },
    unproject: (n) => String(n),
  },
  {
    type: "sketchy:lens", id: "json-stringify", name: "JSON stringify", icon: "Braces",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } },
    unproject: (s) => { try { return JSON.parse(s); } catch { return undefined; } },
  },
  {
    type: "sketchy:lens", id: "uppercase", name: "UPPERCASE", icon: "CaseUpper",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (s) => (typeof s === "string" ? s.toUpperCase() : ""),
    unproject: (view, src) => recase(view, src, "toUpperCase"),
  },
  {
    type: "sketchy:lens", id: "lowercase", name: "lowercase", icon: "CaseLower",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (s) => (typeof s === "string" ? s.toLowerCase() : ""),
    unproject: (view, src) => recase(view, src, "toLowerCase"),
  },
  {
    type: "sketchy:lens", id: "length", name: "length", icon: "Ruler",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "number", schema: numberSchema() },
    project: (v) => (v == null ? 0 : typeof v === "string" || Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 0),
  },
  {
    type: "sketchy:lens", id: "keys", name: "keys", icon: "KeyRound",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (v) => (v && typeof v === "object" ? Object.keys(v) : []),
  },
  {
    type: "sketchy:lens", id: "rle", name: "RLE encode", icon: "Minimize2",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: rleEncode, unproject: rleDecode,
  },
  {
    type: "sketchy:lens", id: "unrle", name: "RLE decode", icon: "Maximize2",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: rleDecode, unproject: rleEncode,
  },
];
