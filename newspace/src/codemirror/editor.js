// codemirrorEditor — a CodeMirror node driven by an opstream<string>.
//
// It reads the opstream's COMPLEMENT to decide how to present itself, exactly the
// case the complement exists for: a lowercaser upstream wouldn't care about any of
// this, but the editor does —
//   • complement.mimeType / name / extension → pick the language
//   • complement.save (a FUNCTION)           → offer a save affordance; its very
//     presence is the affordance (no boolean flag), so we feature-detect it
//   • complement.automerge / handle          → backed collaboratively, no extra work
//     here because the opstream already maps remote edits to ops (cursor-stable)
//
// CodeMirror itself never sees the complement or automerge — it only speaks ops.
import { Codemirror } from "./codemirror.js";
import { opstreamPlugin } from "./opstream-plugin.js";
import { languageFor } from "./languages.js";

export function codemirrorEditor(opstream, { parent } = {}) {
  const c = opstream.complement || {};

  const cm = new Codemirror({
    parent,
    content: typeof opstream.value === "string" ? opstream.value : "",
    language: [], // loaded on demand below (each language pack is its own chunk)
    // read-only is the ABSENCE of `apply` (e.g. a stream pinned at heads)
    readOnly: typeof opstream.apply !== "function",
    extensions: [opstreamPlugin(opstream)],
  });
  // the language pack loads ASYNC (dynamic import) so it doesn't bloat the editor
  // chunk — the editor mounts immediately, syntax highlighting snaps in a tick later
  Promise.resolve(languageFor(c)).then((lang) => { if (lang) cm.setLanguage(lang); }).catch(() => {});

  return {
    view: cm.view,
    element: cm.element,
    complement: c,
    // capability surfaced only when the complement actually provides it
    save: typeof c.save === "function" ? c.save : undefined,
    setLanguage: (lang) => cm.setLanguage(lang),
    destroy: () => cm.destroy(),
  };
}
