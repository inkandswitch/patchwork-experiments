/**
 * The `parametric` datatype. One document is one picture drawn by a referenced
 * source file from stored parameter values. The shape is specified in
 * DATATYPE.md; this file is the datatype contract (init, getTitle, setTitle,
 * markCopy) plus the small pure helpers the tool shares with it.
 *
 * @typedef {Object} ParametricDoc
 * @property {string}  [title]
 * @property {number}  schemaVersion
 * @property {{url: string, path: string, heads?: string[]}} source
 * @property {number}  [sourceVersion]   absent until the tool copies the template
 * @property {string}  [titleTemplate]
 * @property {Object}  output
 * @property {Array}   params
 * @property {Object}  values
 * @property {Array}   presets
 */

/** The pushwork directory that holds the reference sources (parametric/sources/). */
export const SOURCES_URL = "automerge:3SMAP2oETW1tbwddHTkf6f9JpxTs";
export const DEFAULT_SOURCE = { url: SOURCES_URL, path: "harmonograph.js" };

/**
 * A placeholder template. The tool replaces it with the source's exports the
 * first time it loads the document (sourceVersion is absent until then), so a
 * document created from the menu is drawable the moment its source arrives.
 */
const PLACEHOLDER_OUTPUT = {
  surfaces: ["canvas2d"], unit: "px", width: null, height: null,
  dpi: 96, background: "#fafafa", animated: false,
};

/** Fill "{key}" placeholders from values; an option's label wins over its value. */
export function fillTitle(template, params, values) {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const p = params?.find(q => q.key === key);
    const v = values?.[key] ?? p?.default;
    const opt = p?.options?.find(([value]) => value === v);
    return opt ? opt[1] : v == null ? "" : String(v);
  });
}

export const ParametricDatatype = {
  init(doc) {
    doc.schemaVersion = 1;
    doc.source = { ...DEFAULT_SOURCE };
    doc.output = { ...PLACEHOLDER_OUTPUT, surfaces: [...PLACEHOLDER_OUTPUT.surfaces] };
    doc.params = [];
    doc.values = {};
    doc.presets = [];
  },

  getTitle(doc) {
    return doc.title || fillTitle(doc.titleTemplate, doc.params, doc.values) || "Parametric";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

export default ParametricDatatype;
