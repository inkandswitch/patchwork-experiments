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
  let chatProfileHandle = null;

  // Try to load chat profile for reusing OpenRouter settings
  const repo = element.repo;
  async function loadChatProfile() {
    try {
      const adh = window.accountDocHandle;
      if (!adh) return;
      const ad = adh.doc();
      if (ad?.chatProfileUrl) {
        chatProfileHandle = await repo.find(ad.chatProfileUrl);
      }
    } catch (err) {
      console.warn("[teleprint] Could not load chat profile:", err);
    }
  }
  const chatProfileReady = loadChatProfile();

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
    .tp-settings-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      font-family: "Chicago", "ChicagoFLF", Geneva, system-ui, sans-serif;
      font-size: 11px;
      color: #000;
    }
    .tp-settings-row label {
      white-space: nowrap;
    }
    .tp-settings-row input,
    .tp-settings-row select {
      font-family: Geneva, system-ui, sans-serif;
      font-size: 11px;
      border: 2px inset #c0c0c0;
      background: #fff;
      color: #000;
      padding: 1px 4px;
    }
    .tp-settings-row input[type="password"] {
      flex: 1;
      min-width: 0;
    }
    .tp-settings-row select {
      flex: 1;
      min-width: 0;
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

  // ---- OpenRouter settings row ----
  const settingsRow = document.createElement("div");
  settingsRow.className = "tp-settings-row";

  const keyLabel = document.createElement("label");
  keyLabel.textContent = "Key:";
  settingsRow.appendChild(keyLabel);

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.placeholder = "sk-or-v1-…";
  settingsRow.appendChild(keyInput);

  const modelLabel = document.createElement("label");
  modelLabel.textContent = "Model:";
  settingsRow.appendChild(modelLabel);

  const modelSelect = document.createElement("select");
  settingsRow.appendChild(modelSelect);

  summaryPanel.appendChild(settingsRow);

  const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
  const MODEL_DISPLAY_NAMES = {
    "google/gemini-2.5-flash-preview": "Gemini 2.5 Flash",
  };

  function getOpenRouterKey() {
    return keyInput.value.trim() || chatProfileHandle?.doc()?.openrouterApiKey || "";
  }

  function getOpenRouterModel() {
    return modelSelect.value || chatProfileHandle?.doc()?.openrouterModel || DEFAULT_MODEL;
  }

  function populateModelSelect(currentModel) {
    modelSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = currentModel;
    opt.textContent = MODEL_DISPLAY_NAMES[currentModel] || currentModel;
    opt.selected = true;
    modelSelect.appendChild(opt);
  }

  function fetchModels(apiKey) {
    if (!apiKey) return;
    const lo = document.createElement("option");
    lo.disabled = true;
    lo.textContent = "Loading…";
    modelSelect.innerHTML = "";
    modelSelect.appendChild(lo);
    const currentModel = getOpenRouterModel();
    fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Authorization": "Bearer " + apiKey },
    }).then(r => r.json()).then(data => {
      modelSelect.innerHTML = "";
      const models = (data.data || []).sort((a, b) => (a.id || "").localeCompare(b.id || ""));
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = MODEL_DISPLAY_NAMES[m.id] || m.name || m.id;
        if (m.id === currentModel) opt.selected = true;
        modelSelect.appendChild(opt);
      }
    }).catch(() => {
      populateModelSelect(currentModel);
    });
  }

  // Initialize settings from chat profile when it loads
  chatProfileReady.then(() => {
    const profile = chatProfileHandle?.doc();
    if (profile?.openrouterApiKey && !keyInput.value) {
      keyInput.value = profile.openrouterApiKey;
    }
    const model = profile?.openrouterModel || DEFAULT_MODEL;
    populateModelSelect(model);
    if (profile?.openrouterApiKey) {
      fetchModels(profile.openrouterApiKey);
    }
  });

  keyInput.addEventListener("change", () => {
    const k = keyInput.value.trim();
    if (k) fetchModels(k);
  });

  // Save key/model back to chat profile on change
  function saveSettingsToProfile() {
    if (!chatProfileHandle) return;
    const key = keyInput.value.trim();
    const model = modelSelect.value;
    chatProfileHandle.change((d) => {
      if (key) d.openrouterApiKey = key;
      if (model) d.openrouterModel = model;
      if (key) d.llmProvider = "openrouter";
    });
  }
  keyInput.addEventListener("change", saveSettingsToProfile);
  modelSelect.addEventListener("change", saveSettingsToProfile);

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

  function buildSummaryPrompt(transcript) {
    const MAX_INPUT_CHARS = 8000;
    let text = transcript;
    if (text.length > MAX_INPUT_CHARS) {
      text = text.slice(-MAX_INPUT_CHARS);
      const nl = text.indexOf("\n");
      if (nl !== -1) text = text.slice(nl + 1);
    }
    const speakers = extractSpeakers(text);
    const speakerList = speakers.length > 0 ? `\nParticipants: ${speakers.join(", ")}` : "";
    return [
      {
        role: "system",
        content:
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
          "Do not include the raw transcript in your output.",
      },
      {
        role: "user",
        content:
          `Here is the meeting transcript:${speakerList}\n\n${text}\n\n` +
          "Please generate the meeting notes.",
      },
    ];
  }

  async function generateViaOpenRouter(content) {
    const apiKey = getOpenRouterKey();
    const model = getOpenRouterModel();
    const messages = buildSummaryPrompt(content);

    statusEl.textContent = "Summarizing via " + (MODEL_DISPLAY_NAMES[model] || model) + "…";
    generateBtn.disabled = true;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("OpenRouter: " + err);
    }

    let full = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            // Live-update the summary as tokens stream in
            summaryContent.innerHTML = renderMarkdown(full);
          }
        } catch {}
      }
    }
    return full;
  }

  function generateViaWorker(content) {
    return new Promise((resolve, reject) => {
      if (!summaryWorker) {
        const workerUrl = new URL("./summary-worker.js", import.meta.url);
        summaryWorker = new Worker(workerUrl, { type: "module" });

        summaryWorker.onerror = (err) => {
          console.error("[teleprint] Summary worker error:", err);
          summaryWorker.terminate();
          summaryWorker = null;
          reject(err);
        };
      }

      summaryWorker.onmessage = (ev) => {
        const { type, message, summary } = ev.data;
        if (type === "status") {
          statusEl.textContent = message;
        } else if (type === "ready") {
          // model loaded, generation will follow
        } else if (type === "result") {
          resolve(summary);
        }
      };

      statusEl.textContent = "Summarizing…";
      generateBtn.disabled = true;
      summaryWorker.postMessage({ type: "summarize", text: content });
    });
  }

  generateBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const content = handle.doc()?.content;
    if (!content || content.trim().length === 0) {
      statusEl.textContent = "No transcript to summarize";
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
      return;
    }

    generateBtn.disabled = true;

    try {
      let summary;
      if (getOpenRouterKey()) {
        summary = await generateViaOpenRouter(content);
      } else {
        summary = await generateViaWorker(content);
      }

      statusEl.textContent = "";
      generateBtn.disabled = false;
      generateBtn.textContent = "Regenerate";
      handle.change((doc) => {
        doc.summary = summary;
      });
      renderSummaryContent();
    } catch (err) {
      console.error("[teleprint] Summary error:", err);
      statusEl.textContent = "Error: " + (err.message || err);
      generateBtn.disabled = false;
    }
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
