import type { LLMlinDoc, LlmlinRunDoc, AutomergeUrl, DocHandle, Disposer, OutputBlock } from "./types.js";
import type { Repo } from "@automerge/automerge-repo";
import { updateText } from "@automerge/automerge";
import { runLLMlin, createWatcher, buildSystemPromptPreview } from "./engine/index.js";
import { marked } from "marked";

type ToolElement = HTMLElement & { repo: Repo };
import llmlinCss from "./css/llmlin.css?inline";
import colorsCss from "../shared/colors.css?inline";
import { PwDocToken } from "../doc-token/pw-doc-token.js";

// ============================================================================
// Constants
// ============================================================================

const MODELS = [
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { id: "minimax/minimax-m2.5", label: "MiniMax M2.5" },
];

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

declare const __SKILLS_FOLDER_URL__: string;

// ============================================================================
// Datatype
// ============================================================================

export const LLMlinDatatype = {
  init(doc: LLMlinDoc) {
    doc.readDocUrls = __SKILLS_FOLDER_URL__ ? [__SKILLS_FOLDER_URL__ as AutomergeUrl] : [];
    doc.writeDocUrls = [];
    doc.prompt = "";
    doc.model = DEFAULT_MODEL;
    doc.apiUrl = "https://openrouter.ai/api/v1";
    doc.watchedDocUrls = [];
    doc.watchDebounceMs = 2000;
    doc.watchMaxIntervalMs = 0;
    doc.runUrls = [];
    doc.running = false;
  },

  getTitle(_doc: LLMlinDoc): string {
    return "LLMlin";
  },

  markCopy(_doc: LLMlinDoc) {},
};

export const LlmlinRunDatatype = {
  init(doc: LlmlinRunDoc) {
    doc.prompt = "";
    doc.output = [];
    doc.startedAt = Date.now();
  },

  getTitle(_doc: LlmlinRunDoc): string {
    return "LLMlin Run";
  },

  markCopy(_doc: LlmlinRunDoc) {},
};

// ============================================================================
// Helpers
// ============================================================================

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = colorsCss + llmlinCss;
  document.head.appendChild(style);
}

// ============================================================================
// SVG constants
// ============================================================================

const SVG_NS = "http://www.w3.org/2000/svg";

const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
  fill="currentColor">
  <polygon points="5,3 19,12 5,21"/>
</svg>`;

// Cartoon eye — always open, always watching.
// ViewBox extended upward to include the floating eyebrow.
// Eye oval center = (0,0). Eyebrow arcs at y ≈ -19 to -24.
// Pupil cx/cy animated by JS toward hovered tokens.
const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="ll-eye-svg"
  viewBox="-22 -28 44 46" width="52" height="55">
  <!-- Eyebrow — floating arc above the eye -->
  <path d="M -11 -19 Q 1 -25 11 -19"
    stroke="#2a2420" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <!-- Outer oval (white of eye) -->
  <ellipse cx="0" cy="0" rx="20" ry="14"
    fill="#fffef8" stroke="#2a2420" stroke-width="2.5"/>
  <!-- Iris + pupil (one large dark circle) -->
  <circle class="ll-eye-iris" cx="0" cy="0" r="9"/>
  <!-- Pupil darker core -->
  <circle class="ll-eye-pupil" cx="0" cy="0" r="6"/>
  <!-- Specular highlight -->
  <circle class="ll-eye-highlight" cx="-3" cy="-3" r="2.2"/>
</svg>`;

const STOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
  fill="currentColor">
  <rect x="4" y="4" width="16" height="16" rx="2"/>
</svg>`;

const GEAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
    a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
    A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06
    A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
    A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06
    A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
    a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06
    A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
    a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;


// ============================================================================
// Output rendering helpers
// ============================================================================

function renderOutputBlocks(container: HTMLElement, blocks: OutputBlock[]) {
  container.innerHTML = "";
  for (const block of blocks) {
    if (block.type === "text") {
      const el = document.createElement("div");
      el.className = "ll-output-text";
      el.innerHTML = marked.parse(block.content) as string;
      container.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.className = "ll-output-script";

      if (block.description) {
        const desc = document.createElement("div");
        desc.className = "ll-output-script-desc";
        desc.textContent = block.description;
        el.appendChild(desc);
      }

      const code = document.createElement("pre");
      code.className = "ll-output-code";
      code.textContent = block.code;
      el.appendChild(code);

      if (block.output !== undefined || block.error !== undefined) {
        const result = document.createElement("div");
        result.className = block.error ? "ll-output-error" : "ll-output-result";
        result.textContent = block.error ? `Error: ${block.error}` : block.output || "(done)";
        el.appendChild(result);
      }

      container.appendChild(el);
    }
  }
}

// ============================================================================
// Token pill helpers
// ============================================================================

function makeTokenPill(docUrl: AutomergeUrl, bucket: "read" | "write", repo: Repo | undefined, watched: boolean, onToggleWatch: (url: AutomergeUrl) => void, onDragStart: (e: DragEvent, url: AutomergeUrl, bucket: "read" | "write") => void, onHoverIn: (pill: HTMLElement) => void, onHoverOut: () => void, onClose?: (url: AutomergeUrl, bucket: "read" | "write") => void): HTMLElement {
  const token = document.createElement("pw-doc-token") as PwDocToken;
  token.setAttribute("doc-url", docUrl);
  if (watched) token.setAttribute("watched", "");
  token.repo = repo;

  if (onClose) {
    token.onClose = () => onClose(docUrl, bucket);
  }

  // The component sets text/x-patchwork-urls; add the llmlin-specific bucket here
  token.addEventListener("dragstart", (e) => {
    onDragStart(e as DragEvent, docUrl, bucket);
    (e as DragEvent).dataTransfer?.setData("text/x-llmlin-source", bucket);
  });
  token.addEventListener("click", () => onToggleWatch(docUrl));
  token.addEventListener("mouseenter", () => onHoverIn(token));
  token.addEventListener("mouseleave", onHoverOut);

  return token;
}

function renderTokens(container: HTMLElement, urls: AutomergeUrl[], bucket: "read" | "write", watchedSet: Set<AutomergeUrl>, onToggleWatch: (url: AutomergeUrl) => void, onDragStart: (e: DragEvent, url: AutomergeUrl, bucket: "read" | "write") => void, onHoverIn: (pill: HTMLElement) => void, onHoverOut: () => void, repo: Repo | undefined, onClose?: (url: AutomergeUrl, bucket: "read" | "write") => void) {
  container.innerHTML = "";
  for (const url of urls) {
    container.appendChild(makeTokenPill(url, bucket, repo, watchedSet.has(url), onToggleWatch, onDragStart, onHoverIn, onHoverOut, onClose));
  }
}

// ============================================================================
// Overlay geometry helpers
// ============================================================================

/**
 * Returns the eye's center and half-source-width in root-local coordinates.
 * The ray emits from the eye center, and the source width is half the eye width.
 */
function getEyeSource(root: HTMLElement, eyeBtn: HTMLElement) {
  const rootRect = root.getBoundingClientRect();
  const eyeRect = eyeBtn.getBoundingClientRect();
  return {
    srcCX: (eyeRect.left + eyeRect.right) / 2 - rootRect.left,
    srcY: (eyeRect.top + eyeRect.bottom) / 2 - rootRect.top,
    halfSrc: eyeRect.width / 4, // total source width = half the eye width
    rootRect,
  };
}

/**
 * Draws permanent light-beam trapezoids for all watched tokens.
 * Emits from the eye center, always visible.
 */
function redrawOverlay(svg: SVGSVGElement, root: HTMLElement, eyeBtn: HTMLElement, watchedUrls: AutomergeUrl[]) {
  svg.querySelectorAll(".ll-trap").forEach((el) => el.remove());
  if (watchedUrls.length === 0) return;

  const { srcCX, srcY, halfSrc, rootRect } = getEyeSource(root, eyeBtn);

  for (const url of watchedUrls) {
    const pill = root.querySelector<HTMLElement>(`pw-doc-token[doc-url="${url}"]`);
    if (!pill) continue;

    const pillRect = pill.getBoundingClientRect();
    const tgtMidY = (pillRect.top + pillRect.bottom) / 2 - rootRect.top;
    const tgtX1 = pillRect.left - rootRect.left;
    const tgtX2 = pillRect.right - rootRect.left;

    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", `${srcCX - halfSrc},${srcY} ${tgtX1},${tgtMidY} ${tgtX2},${tgtMidY} ${srcCX + halfSrc},${srcY}`);
    poly.setAttribute("class", "ll-trap");
    svg.appendChild(poly);
  }
}

// ============================================================================
// Tool
// ============================================================================

export function LLMlinTool(handle: DocHandle<LLMlinDoc>, element: ToolElement): Disposer {
  injectStyles();

  const repo = element.repo;

  // ---- Build DOM ----

  // Wrapper — fills the full shape area, reserves padding-top for the eye
  const wrapper = document.createElement("div");
  wrapper.className = "ll-wrapper";

  const root = document.createElement("div");
  root.className = "ll-root";

  // Eye — absolutely positioned at top-center of wrapper, visible above the box
  const eyeBtn = document.createElement("div");
  eyeBtn.className = "ll-eye-btn";
  eyeBtn.innerHTML = EYE_SVG;

  // Header — drop zones; label rendered BELOW the token row
  const header = document.createElement("div");
  header.className = "ll-header";

  const readZone = document.createElement("div");
  readZone.className = "ll-zone";
  readZone.dataset.bucket = "read";

  const readTokens = document.createElement("div");
  readTokens.className = "ll-tokens";

  const readLabel = document.createElement("div");
  readLabel.className = "ll-zone-label";
  readLabel.textContent = "Read";

  readZone.appendChild(readTokens);
  readZone.appendChild(readLabel);

  const writeZone = document.createElement("div");
  writeZone.className = "ll-zone";
  writeZone.dataset.bucket = "write";

  const writeTokens = document.createElement("div");
  writeTokens.className = "ll-tokens";

  const writeLabel = document.createElement("div");
  writeLabel.className = "ll-zone-label";
  writeLabel.textContent = "Write";

  writeZone.appendChild(writeTokens);
  writeZone.appendChild(writeLabel);

  header.appendChild(readZone);
  header.appendChild(writeZone);

  // Body
  const body = document.createElement("div");
  body.className = "ll-body";

  const textarea = document.createElement("textarea");
  textarea.className = "ll-prompt";
  textarea.placeholder = "Write your prompt here…";
  body.appendChild(textarea);

  const promptDisplay = document.createElement("div");
  promptDisplay.className = "ll-prompt-display";
  promptDisplay.style.display = "none";
  body.appendChild(promptDisplay);

  // Output panel
  const outputPanel = document.createElement("div");
  outputPanel.className = "ll-output";

  // Footer
  const footer = document.createElement("div");
  footer.className = "ll-footer";

  const gearBtn = document.createElement("button");
  gearBtn.className = "ll-gear";
  gearBtn.innerHTML = GEAR_SVG;
  gearBtn.setAttribute("title", "Settings");

  const playBtn = document.createElement("button");
  playBtn.className = "ll-play";
  playBtn.innerHTML = PLAY_SVG;
  playBtn.setAttribute("title", "Run");

  footer.appendChild(gearBtn);
  footer.appendChild(playBtn);

  // Settings panel — slides up from above the footer when gear is clicked
  const settingsPanel = document.createElement("div");
  settingsPanel.className = "ll-settings";

  const settingsInner = document.createElement("div");
  settingsInner.className = "ll-settings-inner";

  function makeSettingGroup(label: string, ...controls: HTMLElement[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "ll-setting-group";
    const lbl = document.createElement("span");
    lbl.className = "ll-setting-label";
    lbl.textContent = label;
    group.appendChild(lbl);
    for (const c of controls) group.appendChild(c);
    return group;
  }

  function makeNumberInput(min: string, step: string, title: string, placeholder = ""): HTMLInputElement {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "ll-setting-input";
    inp.min = min;
    inp.step = step;
    inp.title = title;
    if (placeholder) inp.placeholder = placeholder;
    return inp;
  }

  function makeSuffix(text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = "ll-setting-suffix";
    s.textContent = text;
    return s;
  }

  const waitInput = makeNumberInput("0.1", "0.5", "Idle time after last edit before auto-run");
  const everyInput = makeNumberInput("1", "1", "Max interval between runs when edits keep coming", "off");

  const modelSelect = document.createElement("select");
  modelSelect.className = "ll-setting-model";
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }

  settingsInner.appendChild(makeSettingGroup("Wait", waitInput, makeSuffix("s")));
  settingsInner.appendChild(document.createElement("div")).className = "ll-setting-sep";
  settingsInner.appendChild(makeSettingGroup("Every", everyInput, makeSuffix("s")));
  settingsInner.appendChild(document.createElement("div")).className = "ll-setting-sep";
  settingsInner.appendChild(makeSettingGroup("Model", modelSelect));

  settingsPanel.appendChild(settingsInner);

  // SVG overlay — behind the eye, full-root coverage
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.setAttribute("class", "ll-overlay");
  overlay.setAttribute("width", "100%");
  overlay.setAttribute("height", "100%");

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(outputPanel);
  root.appendChild(settingsPanel);
  root.appendChild(footer);
  root.appendChild(overlay);

  wrapper.appendChild(eyeBtn);
  wrapper.appendChild(root);
  element.appendChild(wrapper);

  // ---- State ----

  let returnAnim: number | null = null;
  let abortController: AbortController | null = null;
  let userScrolled = false;
  let programmaticScroll = false;
  let currentRunHandle: DocHandle<LlmlinRunDoc> | null = null;

  outputPanel.addEventListener("scroll", () => {
    if (!programmaticScroll) userScrolled = true;
  });

  // ---- Pupil return-to-center animation ----

  function animateToCenter() {
    const iris = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-iris");
    const pupil = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-pupil");
    const highlight = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-highlight");
    if (!iris || !pupil) {
      returnAnim = null;
      return;
    }

    const cx = parseFloat(iris.getAttribute("cx") ?? "0");
    const cy = parseFloat(iris.getAttribute("cy") ?? "0");

    const newCx = cx * (1 - 0.12);
    const newCy = cy * (1 - 0.12);

    iris.setAttribute("cx", String(newCx));
    iris.setAttribute("cy", String(newCy));
    pupil.setAttribute("cx", String(newCx));
    pupil.setAttribute("cy", String(newCy));
    highlight?.setAttribute("cx", String(newCx - 3));
    highlight?.setAttribute("cy", String(newCy - 3));

    if (Math.abs(newCx) > 0.1 || Math.abs(newCy) > 0.1) {
      returnAnim = requestAnimationFrame(animateToCenter);
    } else {
      iris.setAttribute("cx", "0");
      iris.setAttribute("cy", "0");
      pupil.setAttribute("cx", "0");
      pupil.setAttribute("cy", "0");
      highlight?.setAttribute("cx", "-3");
      highlight?.setAttribute("cy", "-3");
      returnAnim = null;
    }
  }

  function startReturnAnim() {
    if (returnAnim !== null) cancelAnimationFrame(returnAnim);
    returnAnim = requestAnimationFrame(animateToCenter);
  }

  // ---- Pupil focus ----

  function focusPupilOn(pageX: number, pageY: number) {
    if (returnAnim !== null) {
      cancelAnimationFrame(returnAnim);
      returnAnim = null;
    }

    const iris = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-iris");
    const pupil = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-pupil");
    const highlight = eyeBtn.querySelector<SVGCircleElement>(".ll-eye-highlight");
    if (!iris || !pupil) return;

    const eyeRect = eyeBtn.getBoundingClientRect();
    const eyeCx = eyeRect.left + eyeRect.width / 2;
    const eyeCy = eyeRect.top + eyeRect.height / 2;

    const dx = pageX - eyeCx;
    const dy = pageY - eyeCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const svgUnitsPerPx = 44 / eyeRect.width;
    const MAX_TRAVEL = 5;
    const normX = dx / dist;
    const normY = dy / dist;
    const travel = Math.min(dist * svgUnitsPerPx, MAX_TRAVEL);

    const cx = normX * travel;
    const cy = normY * travel;

    iris.setAttribute("cx", String(cx));
    iris.setAttribute("cy", String(cy));
    pupil.setAttribute("cx", String(cx));
    pupil.setAttribute("cy", String(cy));
    highlight?.setAttribute("cx", String(cx - 3));
    highlight?.setAttribute("cy", String(cy - 3));
  }

  // ---- Hover ray ----

  function showRayTo(pill: HTMLElement) {
    let ray = overlay.querySelector<SVGPolygonElement>(".ll-ray");
    if (!ray) {
      ray = document.createElementNS(SVG_NS, "polygon");
      ray.setAttribute("class", "ll-ray");
      // Insert before traps so it's rendered below them (or keep above — let CSS handle opacity)
      overlay.insertBefore(ray, overlay.firstChild);
    }

    const { srcCX, srcY, halfSrc, rootRect } = getEyeSource(root, eyeBtn);
    const pillRect = pill.getBoundingClientRect();
    const tgtX1 = pillRect.left - rootRect.left;
    const tgtX2 = pillRect.right - rootRect.left;
    const tgtMidY = (pillRect.top + pillRect.bottom) / 2 - rootRect.top;

    ray.setAttribute("points", `${srcCX - halfSrc},${srcY} ${tgtX1},${tgtMidY} ${tgtX2},${tgtMidY} ${srcCX + halfSrc},${srcY}`);
  }

  function clearRay() {
    const ray = overlay.querySelector(".ll-ray");
    if (ray) ray.remove();
  }

  // ---- Token hover callbacks ----

  const onHoverIn = (pill: HTMLElement) => {
    const pillRect = pill.getBoundingClientRect();
    const cx = (pillRect.left + pillRect.right) / 2;
    const cy = (pillRect.top + pillRect.bottom) / 2;
    focusPupilOn(cx, cy);
    showRayTo(pill);
  };

  const onHoverOut = () => {
    clearRay();
    startReturnAnim();
  };

  // ---- Render function ----

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    const watchedSet = new Set(doc.watchedDocUrls);

    const onToggleWatch = (url: AutomergeUrl) => {
      handle.change((d) => {
        const idx = d.watchedDocUrls.indexOf(url);
        if (idx === -1) {
          d.watchedDocUrls.push(url);
        } else {
          d.watchedDocUrls.splice(idx, 1);
        }
      });
    };

    const onDragStart = (e: DragEvent, url: AutomergeUrl, bucket: "read" | "write") => {
      e.dataTransfer?.setData("text/x-patchwork-urls", JSON.stringify([url]));
      e.dataTransfer?.setData("text/x-llmlin-source", bucket);
    };

    const onClose = (url: AutomergeUrl, bucket: "read" | "write") => {
      handle.change((d) => {
        const arr = bucket === "read" ? d.readDocUrls : d.writeDocUrls;
        const idx = arr.indexOf(url);
        if (idx !== -1) arr.splice(idx, 1);
      });
    };

    renderTokens(readTokens, doc.readDocUrls, "read", watchedSet, onToggleWatch, onDragStart, onHoverIn, onHoverOut, repo, onClose);
    renderTokens(writeTokens, doc.writeDocUrls, "write", watchedSet, onToggleWatch, onDragStart, onHoverIn, onHoverOut, repo, onClose);

    if (doc.running) {
      textarea.style.display = "none";
      promptDisplay.style.display = "";
      promptDisplay.textContent = doc.prompt ?? "";
    } else {
      textarea.style.display = "";
      promptDisplay.style.display = "none";
      if (document.activeElement !== textarea) {
        textarea.value = doc.prompt ?? "";
      }
    }

    modelSelect.value = doc.model ?? DEFAULT_MODEL;

    if (document.activeElement !== waitInput) {
      waitInput.value = ((doc.watchDebounceMs ?? 2000) / 1000).toString();
    }
    if (document.activeElement !== everyInput) {
      const maxMs = doc.watchMaxIntervalMs ?? 0;
      everyInput.value = maxMs > 0 ? (maxMs / 1000).toString() : "";
    }

    // Toggle play/stop button and squint state
    if (doc.running) {
      playBtn.innerHTML = STOP_SVG;
      playBtn.setAttribute("title", "Stop");
      playBtn.classList.add("ll-play-running");
    } else {
      playBtn.innerHTML = PLAY_SVG;
      playBtn.setAttribute("title", "Run");
      playBtn.classList.remove("ll-play-running");
    }
    root.classList.toggle("ll-running", !!doc.running);

    // Render output from the current run doc
    renderOutputBlocks(outputPanel, currentRunHandle?.doc()?.output ?? []);

    // Auto-scroll to bottom while running (streaming)
    if (doc.running && !userScrolled) {
      programmaticScroll = true;
      outputPanel.scrollTop = outputPanel.scrollHeight;
      requestAnimationFrame(() => {
        programmaticScroll = false;
      });
    }

    // Always redraw the static watched-token beams
    requestAnimationFrame(() => {
      redrawOverlay(overlay, root, eyeBtn, doc.watchedDocUrls);
    });
  }

  // ---- Drop handlers ----

  function setupDropZone(zone: HTMLElement, bucket: "read" | "write") {
    zone.addEventListener("dragover", (e) => {
      e.stopPropagation();
      if (e.dataTransfer?.types.includes("text/x-patchwork-urls")) {
        e.preventDefault();
        zone.classList.add("ll-drag-over");
      }
    });

    zone.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      zone.classList.remove("ll-drag-over");
    });

    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove("ll-drag-over");

      const raw = e.dataTransfer?.getData("text/x-patchwork-urls");
      if (!raw) return;

      let urls: AutomergeUrl[];
      try {
        urls = JSON.parse(raw) as AutomergeUrl[];
      } catch {
        return;
      }

      const sourceBucket = e.dataTransfer?.getData("text/x-llmlin-source") as "read" | "write" | "";

      handle.change((doc) => {
        const target = bucket === "read" ? doc.readDocUrls : doc.writeDocUrls;
        const source = bucket === "read" ? doc.writeDocUrls : doc.readDocUrls;

        for (const url of urls) {
          if (!target.includes(url)) {
            target.push(url);
          }

          if (sourceBucket && sourceBucket !== bucket) {
            const idx = source.indexOf(url);
            if (idx !== -1) source.splice(idx, 1);
          }
        }
      });
    });
  }

  setupDropZone(readZone, "read");
  setupDropZone(writeZone, "write");

  // ---- Input handlers ----

  textarea.addEventListener("input", () => {
    handle.change((doc) => {
      updateText(doc, ["prompt"], textarea.value);
    });
  });

  textarea.addEventListener("dblclick", async () => {
    const doc = handle.doc();
    if (!doc) return;
    const prompt = await buildSystemPromptPreview(repo, doc);
    console.log("[llmlin] system prompt:\n", prompt);
  });

  modelSelect.addEventListener("change", () => {
    handle.change((doc) => { doc.model = modelSelect.value; });
  });

  waitInput.addEventListener("change", () => {
    const secs = parseFloat(waitInput.value);
    if (!isFinite(secs) || secs < 0.1) return;
    handle.change((doc) => { doc.watchDebounceMs = Math.round(secs * 1000); });
  });

  everyInput.addEventListener("change", () => {
    const secs = parseFloat(everyInput.value);
    handle.change((doc) => {
      doc.watchMaxIntervalMs = isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : 0;
    });
  });

  gearBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("ll-settings-open");
    gearBtn.classList.toggle("ll-gear-active");
  });

  // ---- Run / Stop ----

  async function startRun() {
    const doc = handle.doc();
    if (!doc || doc.running) return;

    userScrolled = false;
    abortController = new AbortController();
    watcher.snapshotBeforeRun();

    // Create a fresh run document
    const runHandle = repo.create<LlmlinRunDoc>();
    runHandle.change((d) => {
      LlmlinRunDatatype.init(d);
      d.prompt = doc.prompt;
    });
    const runUrl = runHandle.url;

    currentRunHandle = runHandle;

    handle.change((d) => {
      if (!d.runUrls) d.runUrls = [];
      d.runUrls.push(runUrl);
      d.running = true;
    });

    try {
      await runLLMlin(repo, handle.doc()!, abortController.signal, {
        onOutput: (blocks) => {
          runHandle.change((d) => {
            d.output = blocks as any;
          });
          render();
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        runHandle.change((d) => {
          if (!d.output) d.output = [];
          d.output.push({ type: "text", content: `\n[Error: ${err.message ?? String(err)}]` });
        });
      }
    } finally {
      runHandle.change((d) => {
        d.completedAt = Date.now();
      });
      abortController = null;
      handle.change((d) => {
        d.running = false;
      });
      await watcher.recordOwnWrites();
    }
  }

  function stopRun() {
    abortController?.abort();
  }

  playBtn.addEventListener("click", () => {
    const doc = handle.doc();
    if (doc?.running) {
      stopRun();
    } else {
      startRun();
    }
  });

  // ---- Watch mode ----

  const watcher = createWatcher(
    repo, handle,
    () => startRun(),
    () => handle.doc()?.watchDebounceMs ?? 2000,
    () => handle.doc()?.watchMaxIntervalMs ?? 0,
  );

  // ---- Subscribe to doc changes ----

  const onChange = () => render();
  handle.on("change", onChange);

  render();

  // ---- Cleanup ----

  return () => {
    handle.off("change", onChange);
    if (returnAnim !== null) cancelAnimationFrame(returnAnim);
    watcher.dispose();
    abortController?.abort();
    wrapper.remove();
  };
}

// ============================================================================
// Plugin exports
// ============================================================================

export const llmlinPlugins = [
  {
    type: "patchwork:datatype" as const,
    id: "llmlin",
    name: "LLMlin",
    icon: "Cpu",
    unlisted: true,
    async load() {
      return LLMlinDatatype;
    },
  },
  {
    type: "patchwork:datatype" as const,
    id: "llmlin-run",
    name: "LLMlin Run",
    unlisted: true,
    async load() {
      return LlmlinRunDatatype;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "llmlin",
    name: "LLMlin",
    icon: "Cpu",
    supportedDatatypes: ["llmlin"],
    async load() {
      return LLMlinTool;
    },
  },
];
