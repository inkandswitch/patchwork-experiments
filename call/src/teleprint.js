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
import { generate, popup } from "@chee/patchwork-llm";

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
  let summaryVisible = false;

  const container = document.createElement("div");
  container.className = "tp-root";
  container.style.cssText =
    "width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;";
  element.appendChild(container);

  const style = document.createElement("style");
  style.textContent = `
    /* Teleprint keeps its teletype character — a monospace transcript — but the
       chrome around it is softened into warm rounded cards. Every colour is
       driven from the theme: paper/ink for content, the --studio-chrome family
       for the summary chrome, --studio-primary for playful accents. Fallbacks
       reproduce the original look when the tool runs unthemed. */
    .tp-root {
      /* The transcript is the family's light "paper" surface (same sticker
         tokens as glomper / newspace / loom): warm-white paper, hot-pink #ff2284
         accent, mint #40dcba, lemon #fffdc7 highlight, hard ink outlines, chunky
         3px offset shadows + translate(2px,2px) press. system-ui for words, the
         teletype keeps its mono body. */
      --paper: var(--studio-fill, #fffaff);
      --ink: var(--studio-line, #1a1714);
      --ink-soft: var(--studio-line-offset-30, #6f675f);
      --chrome: var(--studio-chrome, #fff);
      --chrome-ink: var(--studio-chrome-line, #1a1714);
      --chrome-edge: var(--studio-chrome-line, #000);
      --accent: var(--studio-primary, #ff2284);
      --accent2: var(--studio-secondary, #40dcba);
      --accent-ink: #fff;
      --lemon: #fffdc7;
      --link: var(--studio-link, #5b8def);
      --bw: 1.5px;
      --radius: 10px;
      --radius-sm: 7px;
      --press: translate(2px, 2px);
      --font-ui: var(--studio-family-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
      --font-mono: var(--studio-family-code, ui-monospace, "Fantasque Sans Mono", monospace);
      --font-head: var(--studio-family-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
    }

    .tp-editor-wrap .cm-editor {
      height: 100%;
      background: var(--paper);
      color: var(--ink);
    }
    .tp-editor-wrap .cm-content {
      font-family: var(--font-mono);
      caret-color: var(--ink);
      padding: 12px 16px;
    }
    .tp-editor-wrap .cm-cursor {
      border-left-color: var(--ink);
    }
    .tp-editor-wrap .cm-scroller { overflow: auto; }
    .tp-speaker {
      color: var(--link);
      font-weight: 600;
    }
    .tp-editor-wrap {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .tp-summary-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: var(--studio-space-sm, 8px);
      padding: 8px 14px;
      background: var(--chrome);
      color: var(--chrome-ink);
      border: var(--bw) solid var(--chrome-edge);
      border-radius: var(--radius-sm);
      box-shadow: 2px 2px 0 0 var(--chrome-edge);
      font-family: var(--font-ui);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      flex-shrink: 0;
      cursor: pointer;
      user-select: none;
      transition: background var(--studio-transition, 0.15s ease);
    }
    .tp-summary-bar:hover {
      background: var(--studio-chrome-offset-10, #e6e3dd);
    }
    .tp-summary-bar:active,
    .tp-summary-bar.active {
      background: var(--ink);
      color: var(--paper);
      border-color: var(--ink);
    }
    .tp-summary-bar .tp-summary-arrow {
      font-size: 9px;
      transition: transform var(--studio-transition, 0.15s ease);
    }
    .tp-summary-bar.active .tp-summary-arrow {
      transform: rotate(180deg);
    }
    .tp-summary-bar .tp-status {
      margin-left: auto;
      font-size: 11px;
      font-weight: 400;
    }
    .tp-summary-panel {
      overflow: auto;
      padding: 6px 18px 18px;
      margin: 0 var(--studio-space-sm, 8px) var(--studio-space-sm, 8px);
      background: var(--paper);
      border: var(--bw) solid var(--chrome-edge);
      border-radius: var(--radius);
      font-family: var(--font-ui);
      font-size: 13px;
      line-height: 1.6;
      color: var(--ink);
      max-height: 50%;
      flex-shrink: 0;
    }
    .tp-summary-panel h1 {
      font-family: var(--font-head);
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 12px 0 10px 0;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--accent);
      color: var(--ink);
    }
    .tp-summary-panel h2 {
      font-family: var(--font-head);
      font-size: 13px;
      font-weight: 700;
      margin: 16px 0 6px 0;
      color: var(--ink);
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-underline-offset: 3px;
    }
    .tp-summary-panel h3 {
      font-family: var(--font-head);
      font-size: 13px;
      font-weight: 700;
      margin: 10px 0 4px 0;
      color: var(--ink);
    }
    .tp-summary-panel ul {
      margin: 4px 0;
      padding-left: 18px;
    }
    .tp-summary-panel li {
      margin: 2px 0;
    }
    .tp-summary-panel li::marker {
      content: "\\25C6  ";
      font-size: 8px;
      color: var(--accent);
    }
    .tp-summary-panel p {
      margin: 6px 0;
    }
    .tp-summary-panel code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--studio-fill-offset-20, #f0eee9);
      padding: 1px 5px;
      border-radius: var(--studio-radius-sm, 4px);
    }
    .tp-summary-panel strong {
      font-weight: 600;
    }
    .tp-summary-panel hr {
      border: none;
      border-top: 1px solid var(--chrome-edge);
      margin: 12px 0;
    }
    .tp-summary-panel .tp-summary-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    /* the family's sticker press-button */
    .tp-summary-panel .tp-generate-btn {
      padding: 7px 16px;
      border: var(--bw) solid #000;
      border-radius: var(--radius);
      background: var(--accent);
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      font-family: var(--font-ui);
      color: var(--accent-ink);
      box-shadow: 3px 3px 0 0 #000;
      transition: transform 0.06s, box-shadow 0.06s, filter 0.1s;
    }
    .tp-summary-panel .tp-generate-btn:hover {
      filter: brightness(1.04);
    }
    .tp-summary-panel .tp-generate-btn:active {
      transform: var(--press);
      box-shadow: 0 0 0 0 #000;
    }
    .tp-summary-panel .tp-generate-btn:disabled {
      transform: none;
      box-shadow: 3px 3px 0 0 #000;
      filter: none;
    }
    .tp-summary-panel .tp-generate-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .tp-summary-panel .tp-summary-empty {
      color: var(--ink-soft);
      font-style: italic;
    }
    .tp-summary-content {
      margin-top: 4px;
    }
    /* secondary sticker button — opens the @chee/patchwork-llm model picker */
    .tp-summary-panel .tp-model-btn {
      padding: 7px 14px;
      border: var(--bw) solid #000;
      border-radius: var(--radius);
      background: var(--paper);
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      font-family: var(--font-ui);
      color: var(--ink);
      box-shadow: 3px 3px 0 0 #000;
      transition: transform 0.06s, box-shadow 0.06s, filter 0.1s;
    }
    .tp-summary-panel .tp-model-btn:hover {
      filter: brightness(0.97);
    }
    .tp-summary-panel .tp-model-btn:active {
      transform: var(--press);
      box-shadow: 0 0 0 0 #000;
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
        "&": {
          height: "100%",
          fontSize: "var(--studio-font-size, 13px)",
          background: "var(--studio-fill, #fff)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--studio-family-code, ui-monospace, monospace)",
        },
        ".cm-content": { color: "var(--studio-line, #111)" },
        ".cm-gutters": {
          background: "var(--studio-fill-offset-20, #f0eee9)",
          borderRight: "1px solid var(--studio-fill-offset-40, #808080)",
          color: "var(--studio-line-offset-40, #444)",
        },
        ".cm-activeLineGutter": { background: "var(--studio-fill-offset-30, #a0a0a0)" },
        ".cm-activeLine": { background: "var(--studio-fill-offset-10, #e8e8e8)" },
        ".cm-cursor": { borderLeftColor: "var(--studio-line, #111)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
          background: "var(--studio-selection-fill, #ffb0cb) !important",
        },
        "&.cm-focused .cm-selectionMatch": { background: "var(--studio-fill-offset-20, #c0c0c0)" },
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

  // Model / provider selection is delegated to @chee/patchwork-llm's picker,
  // which writes to the shared account-doc config (one model + key across every
  // tool). No tool-local OpenRouter key/model UI.
  const modelBtn = document.createElement("button");
  modelBtn.className = "tp-model-btn";
  modelBtn.textContent = "Model…";
  modelBtn.title = "Choose the model used for summaries";
  modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const el = popup();
    document.body.appendChild(el);
    el.showPopover();
    el.result.finally(() => el.remove());
  });
  actionsRow.appendChild(modelBtn);

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

  function extractSpeakers(text) {
    const names = new Set();
    for (const match of text.matchAll(/^<([^>]+)>/gm)) {
      names.add(match[1]);
    }
    return [...names];
  }

  const SUMMARY_SYSTEM =
    "You are a meeting notes assistant. You receive call transcripts " +
    "where each line is formatted as `<Speaker Name> what they said`. " +
    "Produce clear, structured meeting notes in markdown.\n\n" +
    "Include these sections:\n" +
    "# Meeting Notes\n" +
    "- A **one-sentence summary** of what the meeting was about\n" +
    "- **Participants** list\n" +
    "- **Key Discussion Points** as bullet points\n" +
    "- **Decisions** (if any were made)\n" +
    "- **Action Items** (if any, with who is responsible)\n" +
    "- A brief **Per-Participant Summary** section with a short " +
    "paragraph for each speaker describing their main contributions\n\n" +
    "Be concise but thorough. Use markdown formatting with headers. " +
    "Do not include the raw transcript in your output.";

  function buildSummaryInput(transcript) {
    const MAX_INPUT_CHARS = 8000;
    let text = transcript;
    if (text.length > MAX_INPUT_CHARS) {
      text = text.slice(-MAX_INPUT_CHARS);
      const nl = text.indexOf("\n");
      if (nl !== -1) text = text.slice(nl + 1);
    }
    const speakers = extractSpeakers(text);
    const speakerList = speakers.length > 0 ? `\nParticipants: ${speakers.join(", ")}` : "";
    return (
      `Here is the meeting transcript:${speakerList}\n\n${text}\n\n` +
      "Please generate the meeting notes."
    );
  }

  let summaryAbort = null;

  generateBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const content = handle.doc()?.content;
    if (!content || content.trim().length === 0) {
      statusEl.textContent = "No transcript to summarize";
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
      return;
    }

    generateBtn.disabled = true;
    statusEl.textContent = "Summarizing…";
    summaryAbort = new AbortController();

    try {
      // Provider/model/key come from the shared account-doc config via
      // @chee/patchwork-llm (local transformers.js / OpenRouter / Ollama / …).
      const { text } = await generate(buildSummaryInput(content), {
        system: SUMMARY_SYSTEM,
        signal: summaryAbort.signal,
        onStatus: (m) => { statusEl.textContent = m; },
        onToken: (_delta, full) => {
          // Live-update the summary as tokens stream in.
          summaryContent.innerHTML = renderMarkdown(full);
        },
      });

      statusEl.textContent = "";
      generateBtn.disabled = false;
      generateBtn.textContent = "Regenerate";
      handle.change((doc) => {
        doc.summary = text;
      });
      renderSummaryContent();
    } catch (err) {
      console.error("[teleprint] Summary error:", err);
      statusEl.textContent = "Error: " + (err.message || err);
      generateBtn.disabled = false;
    } finally {
      summaryAbort = null;
    }
  });

  return () => {
    summaryAbort?.abort();
    handle.off("change", onDocChange);
    view.destroy();
    container.remove();
    style.remove();
  };
}
