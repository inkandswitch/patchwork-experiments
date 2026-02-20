/**
 * Teleprint — CodeMirror editor for call transcription documents.
 *
 * Provides a text editor view of doc.content with automerge sync,
 * speaker name highlighting, auto-scroll-to-bottom, and a collapsible
 * summary panel at the bottom that renders meeting notes as formatted markdown.
 *
 * Styled after classic Macintosh System 7.5.
 */

import { next as Automerge } from "@automerge/automerge";
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

/**
 * Minimal markdown-to-HTML renderer.
 */
function renderMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = headingMatch[1].length;
      html += `<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`;
      continue;
    }

    const bulletMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    if (bulletMatch) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMarkdown(bulletMatch[1])}</li>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }

    if (line.trim() === "") continue;

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      html += "<hr>";
      continue;
    }

    html += `<p>${inlineMarkdown(line)}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function inlineMarkdown(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export default function TeleprintTool(handle, element) {
  let summaryWorker = null;
  let summaryVisible = false;

  const container = document.createElement("div");
  container.style.cssText =
    "width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;";
  element.appendChild(container);

  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: "Chicago";
      src: url("https://cdn.jsdelivr.net/gh/LigatureInc/ChicagoFLF@master/ChicagoFLF.ttf");
    }

    .cm-editor { height: 100%; }
    .cm-scroller { overflow: auto; }
    .tp-speaker {
      color: #666;
      font-weight: bold;
    }
    .tp-editor-wrap {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      border-bottom: 1px solid #000;
    }
    .tp-summary-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      background: #c0c0c0;
      border-top: 2px solid #fff;
      border-bottom: 2px solid #808080;
      font-family: "Chicago", "ChicagoFLF", Geneva, system-ui, sans-serif;
      font-size: 12px;
      flex-shrink: 0;
      cursor: pointer;
      user-select: none;
      color: #000;
    }
    .tp-summary-bar:hover {
      background: #d0d0d0;
    }
    .tp-summary-bar:active {
      background: #000;
      color: #fff;
      border-top-color: #000;
      border-bottom-color: #000;
    }
    .tp-summary-bar.active {
      background: #000;
      color: #fff;
      border-top-color: #000;
      border-bottom-color: #000;
    }
    .tp-summary-bar .tp-summary-arrow {
      font-size: 9px;
    }
    .tp-summary-bar.active .tp-summary-arrow {
      transform: rotate(180deg);
    }
    .tp-summary-bar .tp-status {
      margin-left: auto;
      font-size: 11px;
    }
    .tp-summary-panel {
      overflow: auto;
      padding: 10px 16px 14px;
      background: #fff;
      border-top: 1px solid #808080;
      font-family: Geneva, "Chicago", system-ui, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #000;
      max-height: 50%;
      flex-shrink: 0;
    }
    .tp-summary-panel h1 {
      font-family: "Chicago", "ChicagoFLF", Geneva, system-ui, sans-serif;
      font-size: 14px;
      font-weight: bold;
      margin: 0 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 2px solid #000;
      color: #000;
    }
    .tp-summary-panel h2 {
      font-family: "Chicago", "ChicagoFLF", Geneva, system-ui, sans-serif;
      font-size: 12px;
      font-weight: bold;
      margin: 12px 0 4px 0;
      color: #000;
      text-decoration: underline;
    }
    .tp-summary-panel h3 {
      font-size: 12px;
      font-weight: bold;
      margin: 8px 0 4px 0;
      color: #000;
    }
    .tp-summary-panel ul {
      margin: 2px 0;
      padding-left: 16px;
    }
    .tp-summary-panel li {
      margin: 1px 0;
    }
    .tp-summary-panel li::marker {
      content: "\\25C6  ";
      font-size: 8px;
    }
    .tp-summary-panel p {
      margin: 4px 0;
    }
    .tp-summary-panel code {
      font-family: Monaco, "Courier New", monospace;
      font-size: 11px;
    }
    .tp-summary-panel strong {
      font-weight: bold;
    }
    .tp-summary-panel hr {
      border: none;
      border-top: 1px solid #808080;
      margin: 10px 0;
    }
    .tp-summary-panel .tp-summary-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .tp-summary-panel .tp-generate-btn {
      padding: 2px 12px;
      border: 2px outset #c0c0c0;
      border-radius: 4px;
      background: #c0c0c0;
      cursor: pointer;
      font-size: 12px;
      font-family: "Chicago", "ChicagoFLF", Geneva, system-ui, sans-serif;
      color: #000;
    }
    .tp-summary-panel .tp-generate-btn:hover {
      background: #d0d0d0;
    }
    .tp-summary-panel .tp-generate-btn:active {
      border-style: inset;
      background: #b0b0b0;
    }
    .tp-summary-panel .tp-generate-btn:disabled {
      color: #808080;
      cursor: default;
    }
    .tp-summary-panel .tp-summary-empty {
      color: #808080;
      font-style: italic;
    }
    .tp-summary-content {
      margin-top: 4px;
    }
  `;
  element.appendChild(style);

  // ---- Editor ----
  const editorWrap = document.createElement("div");
  editorWrap.className = "tp-editor-wrap";
  container.appendChild(editorWrap);

  const doc = handle.doc();
  const content = doc?.content || "";

  let pinnedToBottom = true;

  const view = new EditorView({
    doc: content,
    parent: editorWrap,
    extensions: [
      minimalSetup,
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { height: "100%", fontSize: "12px", background: "#fff" },
        ".cm-scroller": { overflow: "auto", fontFamily: "Geneva, 'Chicago', system-ui, sans-serif" },
        ".cm-content": { color: "#000" },
        ".cm-gutters": { background: "#c0c0c0", borderRight: "1px solid #808080", color: "#000" },
        ".cm-activeLineGutter": { background: "#a0a0a0" },
        ".cm-activeLine": { background: "#e8e8e8" },
        ".cm-cursor": { borderLeftColor: "#000" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { background: "#ffb0cb !important" },
        "&.cm-focused .cm-selectionMatch": { background: "#c0c0c0" },
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

  view.scrollDOM.addEventListener("scroll", () => {
    const scroller = view.scrollDOM;
    const distFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinnedToBottom = distFromBottom < 30;
  });

  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  });

  // ---- Summary bar (toggle at bottom) ----
  const summaryBar = document.createElement("div");
  summaryBar.className = "tp-summary-bar";

  const arrow = document.createElement("span");
  arrow.className = "tp-summary-arrow";
  arrow.textContent = "\u25B2";
  summaryBar.appendChild(arrow);

  const barLabel = document.createElement("span");
  barLabel.textContent = "Summary";
  summaryBar.appendChild(barLabel);

  const statusEl = document.createElement("span");
  statusEl.className = "tp-status";
  summaryBar.appendChild(statusEl);

  container.appendChild(summaryBar);

  // ---- Summary panel (below the bar) ----
  const summaryPanel = document.createElement("div");
  summaryPanel.className = "tp-summary-panel";
  summaryPanel.style.display = "none";
  container.appendChild(summaryPanel);

  const actionsRow = document.createElement("div");
  actionsRow.className = "tp-summary-actions";

  const generateBtn = document.createElement("button");
  generateBtn.className = "tp-generate-btn";
  generateBtn.textContent = doc?.summary ? "Regenerate" : "Generate";
  generateBtn.title = "Generate meeting notes from transcript";
  actionsRow.appendChild(generateBtn);

  summaryPanel.appendChild(actionsRow);

  const summaryContent = document.createElement("div");
  summaryContent.className = "tp-summary-content";
  summaryPanel.appendChild(summaryContent);

  function renderSummaryContent() {
    const doc = handle.doc();
    const summary = doc?.summary;
    if (summary && summary.trim()) {
      summaryContent.innerHTML = renderMarkdown(summary);
    } else {
      summaryContent.innerHTML =
        '<span class="tp-summary-empty">No summary yet. Click \u201CGenerate\u201D to create meeting notes.</span>';
    }
  }

  function toggleSummary() {
    summaryVisible = !summaryVisible;
    summaryPanel.style.display = summaryVisible ? "block" : "none";
    summaryBar.classList.toggle("active", summaryVisible);
    if (summaryVisible) {
      renderSummaryContent();
    }
  }

  summaryBar.addEventListener("click", toggleSummary);

  function onDocChange() {
    if (summaryVisible) {
      renderSummaryContent();
    }
  }
  handle.on("change", onDocChange);

  // ---- Generate action ----
  generateBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const content = handle.doc()?.content;
    if (!content || content.trim().length === 0) {
      statusEl.textContent = "No transcript to summarize";
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
      return;
    }

    if (!summaryWorker) {
      const workerUrl = new URL("./summary-worker.js", import.meta.url);
      summaryWorker = new Worker(workerUrl, { type: "module" });

      summaryWorker.onmessage = (ev) => {
        const { type, message, summary } = ev.data;
        if (type === "status") {
          statusEl.textContent = message;
          generateBtn.disabled = true;
        } else if (type === "ready") {
          statusEl.textContent = "";
          generateBtn.disabled = false;
        } else if (type === "result") {
          statusEl.textContent = "";
          generateBtn.disabled = false;
          generateBtn.textContent = "Regenerate";
          handle.change((doc) => {
            doc.summary = summary;
          });
          renderSummaryContent();
        }
      };

      summaryWorker.onerror = (err) => {
        console.error("[teleprint] Summary worker error:", err);
        statusEl.textContent = "Summary worker crashed";
        generateBtn.disabled = false;
        // Kill the broken worker so a fresh one is created next time
        summaryWorker.terminate();
        summaryWorker = null;
      };
    }

    statusEl.textContent = "Summarizing\u2026";
    generateBtn.disabled = true;
    summaryWorker.postMessage({ type: "summarize", text: content });
  });

  return () => {
    if (summaryWorker) {
      summaryWorker.terminate();
      summaryWorker = null;
    }
    handle.off("change", onDocChange);
    view.destroy();
    container.remove();
    style.remove();
  };
}
