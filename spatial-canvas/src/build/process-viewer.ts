/**
 * ProcessViewer — plain-DOM tool that renders a ProcessDoc.
 *
 * Mirrors the behaviour of llm-canvas ProcessView but without React, so it
 * works inside spatial-canvas which has no React dependency.
 *
 * Registered with tool id "process" so that the BuildPanel's
 * <patchwork-view tool-id="process"> resolves to this renderer.
 */

import type { DocHandle } from "@automerge/automerge-repo";
import type { Disposer } from "../canvas/types.js";

// Mirrored from llm-canvas/src/process/types.ts
type OutputBlock =
  | { type: "text"; content: string }
  | { type: "script"; code: string; description?: string; output?: string; error?: string };

type ProcessDoc = {
  prompt: string;
  output: OutputBlock[];
};

// =============================================================================
// Script block element
// =============================================================================

function createScriptBlockEl(block: Extract<OutputBlock, { type: "script" }>): HTMLElement {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;

  let collapsed = hasCompleted;

  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:4px 0;";

  // ---- Header toggle ----
  const header = document.createElement("button");
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:4px",
    "background:none",
    "border:none",
    "cursor:pointer",
    "padding:2px 0",
    "font:11px/1 system-ui,sans-serif",
    "color:#888",
  ].join(";");
  header.onpointerdown = (e) => e.stopPropagation();

  const arrow = document.createElement("span");
  arrow.style.cssText = "font-size:9px;transition:transform 0.15s;display:inline-block;";
  arrow.textContent = "▶";

  const labelSpan = document.createElement("span");
  labelSpan.textContent = block.description || "Code";

  const statusSpan = document.createElement("span");
  statusSpan.style.cssText = "font-size:9px;";
  if (!hasCompleted) {
    statusSpan.textContent = "⋯";
    statusSpan.style.color = "#aaa";
  } else if (hasError) {
    statusSpan.textContent = "✗";
    statusSpan.style.color = "#c33";
  } else {
    statusSpan.textContent = "✓";
    statusSpan.style.color = "#4caf50";
  }

  header.appendChild(arrow);
  header.appendChild(labelSpan);
  header.appendChild(statusSpan);
  wrap.appendChild(header);

  // ---- Body ----
  const body = document.createElement("div");
  body.style.cssText = [
    "margin-left:14px",
    "border-left:1px solid #eee",
    "padding-left:8px",
    "margin-top:2px",
  ].join(";");

  const codePre = document.createElement("pre");
  codePre.style.cssText = [
    "font:10px/1.4 monospace",
    "color:#666",
    "white-space:pre-wrap",
    "max-height:200px",
    "overflow:auto",
    "margin:0",
  ].join(";");
  codePre.textContent = block.code;
  body.appendChild(codePre);

  if (block.output || block.error) {
    const resultDiv = document.createElement("div");
    resultDiv.style.cssText = [
      "font:10px/1.4 monospace",
      "margin-top:4px",
      "padding-top:4px",
      "border-top:1px solid #f0f0f0",
      "max-height:200px",
      "overflow:auto",
    ].join(";");
    if (block.output) {
      const outPre = document.createElement("pre");
      outPre.style.cssText = "margin:0;color:#888;white-space:pre-wrap;";
      outPre.textContent = block.output;
      resultDiv.appendChild(outPre);
    }
    if (block.error) {
      const errPre = document.createElement("pre");
      errPre.style.cssText = "margin:0;color:#c33;white-space:pre-wrap;";
      errPre.textContent = block.error;
      resultDiv.appendChild(errPre);
    }
    body.appendChild(resultDiv);
  } else if (hasCompleted) {
    const none = document.createElement("div");
    none.style.cssText =
      "font:10px/1 system-ui,sans-serif;color:#ccc;font-style:italic;margin-top:2px;";
    none.textContent = "No output";
    body.appendChild(none);
  }

  function setCollapsed(c: boolean) {
    collapsed = c;
    arrow.style.transform = c ? "none" : "rotate(90deg)";
    body.style.display = c ? "none" : "block";
  }

  setCollapsed(collapsed);

  header.addEventListener("click", () => setCollapsed(!collapsed));
  wrap.appendChild(body);
  return wrap;
}

// =============================================================================
// Main renderer
// =============================================================================

export default function ProcessViewer(
  handle: DocHandle<ProcessDoc>,
  element: HTMLElement,
): Disposer {
  element.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:4px",
    "padding:6px 0",
    "font-family:system-ui,sans-serif",
    "font-size:12px",
  ].join(";");

  let lastBlockCount = 0;

  // Prompt box
  const promptBox = document.createElement("div");
  promptBox.style.cssText = [
    "padding:6px 8px",
    "background:#f0f0f0",
    "border-radius:6px",
    "font-size:11px",
    "color:#555",
    "white-space:pre-wrap",
    "word-break:break-word",
    "display:none",
  ].join(";");
  element.appendChild(promptBox);

  // Thinking indicator
  const thinking = document.createElement("div");
  thinking.style.cssText = "font-size:11px;color:#aaa;padding:4px 0;display:none;";
  thinking.textContent = "Thinking…";
  element.appendChild(thinking);

  // Output container — blocks appended here
  const outputContainer = document.createElement("div");
  outputContainer.style.cssText = "display:flex;flex-direction:column;gap:2px;padding-left:4px;";
  element.appendChild(outputContainer);

  function render({ doc }: { doc: ProcessDoc }) {
    // Prompt
    if (doc.prompt) {
      promptBox.style.display = "block";
      promptBox.textContent = doc.prompt;
    }

    const blocks = doc.output ?? [];

    // Thinking indicator: show only when no output yet
    thinking.style.display = blocks.length === 0 ? "block" : "none";

    // Append only newly added blocks (avoid full re-render on every keypress)
    if (blocks.length > lastBlockCount) {
      for (let i = lastBlockCount; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === "text") {
          const el = document.createElement("div");
          el.style.cssText =
            "font-size:12px;color:#444;line-height:1.5;white-space:pre-wrap;word-break:break-word;";
          el.textContent = block.content;
          el.dataset.blockIdx = String(i);
          outputContainer.appendChild(el);
        } else if (block.type === "script") {
          const el = createScriptBlockEl(block);
          el.dataset.blockIdx = String(i);
          outputContainer.appendChild(el);
        }
      }
      lastBlockCount = blocks.length;
    }

    // Update existing blocks in-place (streaming text / script completion)
    for (const child of outputContainer.children) {
      const idx = parseInt((child as HTMLElement).dataset.blockIdx ?? "-1", 10);
      if (idx < 0 || idx >= blocks.length) continue;
      const block = blocks[idx];

      if (block.type === "text") {
        if (child.textContent !== block.content) child.textContent = block.content;
      } else if (block.type === "script") {
        // Update code
        const codePre = child.querySelector("pre");
        if (codePre && codePre.textContent !== block.code) codePre.textContent = block.code;

        // If script just completed, rebuild the block to show status + output
        const hasCompleted = block.output !== undefined;
        const statusSpan = child.querySelectorAll("span")[2] as HTMLElement | undefined;
        if (statusSpan) {
          if (!hasCompleted) {
            statusSpan.textContent = "⋯";
            statusSpan.style.color = "#aaa";
          } else if (block.error) {
            statusSpan.textContent = "✗";
            statusSpan.style.color = "#c33";
          } else {
            statusSpan.textContent = "✓";
            statusSpan.style.color = "#4caf50";
          }
        }
      }
    }

    outputContainer.scrollTop = outputContainer.scrollHeight;
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    element.innerHTML = "";
  };
}
