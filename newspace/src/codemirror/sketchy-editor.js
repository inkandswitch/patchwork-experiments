// The CodeMirror `sketchy:editor` mount function. The descriptor (inlets/outlets/
// metadata) is declared in src/index.jsx so it's readable without importing the
// codemirror stack; this is the heavy part, loaded lazily.
//
// mount contract: ({ element, inlets, outlets }) => cleanup
//   inlets.content  — opstream<string>  (required) drives the editor
//   inlets.language — opstream (optional) overrides the mime-derived language
//   outlets.text    — set to the content stream so downstream nodes can connect
import { codemirrorEditor } from "./editor.js";

export function mountCodemirror({ element, inlets, outlets }) {
  const content = inlets.content;
  const ed = codemirrorEditor(content, { parent: element });

  // re-expose the editor's content stream on its text outlet
  if (outlets) outlets.text = content;

  // optional language inlet overrides the language derived from the complement
  let offLang;
  if (inlets.language) {
    const applyLang = () => ed.setLanguage(inlets.language.value);
    applyLang();
    offLang = inlets.language.connect ? inlets.language.connect(applyLang) : undefined;
  }

  return () => {
    if (offLang) offLang();
    ed.destroy();
  };
}
