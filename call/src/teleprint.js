/**
 * Teleprint — CodeMirror editor for call transcription documents.
 *
 * Provides a text editor view of doc.content with automerge sync,
 * speaker name highlighting, and auto-scroll-to-bottom behavior.
 */

import { minimalSetup } from "codemirror";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  MatchDecorator,
} from "@codemirror/view";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";

// Highlight <speaker> names at the start of lines
const nameDeco = Decoration.mark({ class: "tp-speaker" });
const nameDecorator = new MatchDecorator({
  regexp: /^<[^>]+>/gm,
  decoration: () => nameDeco,
});

const nameHighlighter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = nameDecorator.createDeco(view);
    }
    update(update) {
      this.decorations = nameDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations }
);

export default function TeleprintTool(handle, element) {
  const container = document.createElement("div");
  container.style.cssText =
    "width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;";
  element.appendChild(container);

  const style = document.createElement("style");
  style.textContent = `
    .cm-editor { height: 100%; }
    .cm-scroller { overflow: auto; }
    .tp-speaker {
      color: #b0b0b0;
      font-weight: normal;
    }
  `;
  element.appendChild(style);

  const doc = handle.doc();
  const content = doc?.content || "";

  // Track whether user is pinned to bottom
  let pinnedToBottom = true;

  const view = new EditorView({
    doc: content,
    parent: container,
    extensions: [
      minimalSetup,
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { height: "100%", fontSize: "16px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "Geneva, sans-serif" },
        ".cm-content": { color: "#000" },
      }),
      nameHighlighter,
      automergeSyncPlugin({ handle, path: ["content"] }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (pinnedToBottom) {
          requestAnimationFrame(() => {
            const scroller = view.scrollDOM;
            scroller.scrollTop = scroller.scrollHeight;
          });
        }
      }),
    ],
  });

  // Detect when user scrolls away from bottom
  view.scrollDOM.addEventListener("scroll", () => {
    const scroller = view.scrollDOM;
    const distFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinnedToBottom = distFromBottom < 30;
  });

  // Scroll to bottom initially
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  });

  return () => {
    view.destroy();
    container.remove();
    style.remove();
  };
}
