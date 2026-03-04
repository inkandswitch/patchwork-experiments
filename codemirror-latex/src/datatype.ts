import type { DocHandle } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { updateText } from "@automerge/automerge";

export type LatexDoc = {
  content: string;
};

const TITLE_REGEX = /\\title\{([^}]*)\}/;

export const LatexDatatype: DatatypeImplementation<LatexDoc> = {
  init(handle: DocHandle<LatexDoc>) {
    handle.change((doc) => {
      doc.content =
        "\\documentclass{article}\n\\begin{document}\n\n\\end{document}";
    });
  },
  getTitle(doc: LatexDoc) {
    const match = doc.content.match(TITLE_REGEX);
    if (match) return match[1].trim();
    const first = doc.content.trim().split("\n")[0];
    if (first) return first.slice(0, 60) + (first.length > 60 ? "…" : "");
    return "Untitled";
  },
  setTitle(doc: LatexDoc, title: string) {
    if (doc.content.match(TITLE_REGEX)) {
      updateText(
        doc,
        ["content"],
        doc.content.replace(TITLE_REGEX, `\\title{${title}}`)
      );
    } else {
      updateText(doc, ["content"], `\\title{${title}}\n` + doc.content);
    }
  },
};
