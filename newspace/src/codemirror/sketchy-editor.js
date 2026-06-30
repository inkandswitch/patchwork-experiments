// The CodeMirror `sketchy:editor` mount function. The descriptor (inlets/outlets/
// metadata) is declared in src/index.jsx so it's readable without importing the
// codemirror stack; this is the heavy part, loaded lazily.
//
// mount contract: ({ element, inlets, outlets }) => cleanup
//   inlets.content  — opstream<string>  (required) drives the editor
//   inlets.language — opstream (optional) overrides the mime-derived language
//   outlets.text    — set to the content stream so downstream nodes can connect
import { codemirrorEditor } from "./editor.js";
import { languageFor } from "./languages.js";
import { Opstream } from "../opstreams.js";

export function mountCodemirror({ element, inlets, outlets, setOutlet }) {
  // content is OPTIONAL: wired ⇒ edit/view that stream; unwired ⇒ codemirror is a
  // SOURCE — its own editable text buffer, authored here and exposed on `text`.
  const content = inlets.content || new Opstream("");
  const ed = codemirrorEditor(content, { parent: element });

  // re-expose the editor's content stream on its text outlet (late-safe via setOutlet)
  if (setOutlet) setOutlet("text", content);
  else if (outlets) outlets.text = content;

  // optional language inlet overrides the mime-derived language. The inlet carries a
  // STRING spec ("javascript", "py", "text/css", ".rs"…), which we resolve to a real
  // CodeMirror LanguageSupport via languageFor (cm.setLanguage wants the extension, not
  // a name — passing the bare string did nothing, which is why this "didn't work").
  let offLang;
  if (inlets.language) {
    const applyLang = async () => {
      const v = inlets.language.value;
      const s = typeof v === "string" ? v : (v && (v.mimeType || v.name || v.extension)) || "";
      if (!s) return;
      try { const lang = await languageFor({ mimeType: s, name: s, extension: s.replace(/^\./, "") }); if (lang) ed.setLanguage(lang); } catch {}
    };
    applyLang();
    offLang = inlets.language.connect ? inlets.language.connect(applyLang) : undefined;
  }

  // Cmd/Ctrl+S saves when the stream carries a save() capability (a wired File
  // text, or any savable complement that passed through the lens chain).
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      const save = content.complement && content.complement.save;
      if (typeof save === "function") { e.preventDefault(); Promise.resolve(save()).catch(() => {}); }
    }
  };
  element.addEventListener("keydown", onKey);

  return () => {
    element.removeEventListener("keydown", onKey);
    if (offLang) offLang();
    ed.destroy();
  };
}
