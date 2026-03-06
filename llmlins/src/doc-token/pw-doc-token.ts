import type { Repo } from "@automerge/automerge-repo";
import { resolveDocTitle } from "../shared/resolve-doc-title.js";
import colorsCss from "../shared/colors.css?inline";
import pwDocTokenCss from "./css/pw-doc-token.css?inline";

// ============================================================================
// Style injection (once per document)
// ============================================================================

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = colorsCss + pwDocTokenCss;
  document.head.appendChild(style);
}

// ============================================================================
// <pw-doc-token> web component
//
// Attributes:
//   doc-url  — Automerge URL of the document to represent
//   watched  — boolean; present = watched, absent = normal
//
// Properties:
//   repo     — set this to an Automerge Repo instance so the component can
//              resolve the document title. Can be set after insertion.
//   onClose  — optional callback; when set, a × button is rendered inside
//              the pill. Clicking it calls onClose() without triggering click.
//
// Events (all native, bubble normally):
//   click        — user clicked the token (not fired when × is clicked)
//   mouseenter   — pointer entered
//   mouseleave   — pointer left
//   dragstart    — native drag start; component pre-fills
//                  dataTransfer "text/x-patchwork-urls" = JSON.stringify([docUrl])
//                  callers can add further MIME types in their own listener
// ============================================================================

export class PwDocToken extends HTMLElement {
  static observedAttributes = ["doc-url", "watched"];

  private _repo: Repo | undefined;
  private _unsubscribe: (() => void) | null = null;
  private _labelEl: HTMLSpanElement | null = null;
  private _closeBtn: HTMLButtonElement | null = null;
  private _onClose: (() => void) | undefined;

  get repo(): Repo | undefined {
    return this._repo;
  }

  set repo(r: Repo | undefined) {
    this._repo = r;
    this._resolveTitle();
  }

  get onClose(): (() => void) | undefined {
    return this._onClose;
  }

  set onClose(fn: (() => void) | undefined) {
    this._onClose = fn;
    if (fn && !this._closeBtn) {
      const btn = document.createElement("button");
      btn.className = "pw-doc-token-close";
      btn.textContent = "×";
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._onClose?.(); });
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("dragstart", (e) => e.stopPropagation());
      this.appendChild(btn);
      this._closeBtn = btn;
    } else if (!fn && this._closeBtn) {
      this._closeBtn.remove();
      this._closeBtn = null;
    }
  }

  connectedCallback() {
    injectStyles();
    this.draggable = true;
    this._ensureLabelEl();
    this.addEventListener("dragstart", this._onDragStart);
    this._resolveTitle();
  }

  disconnectedCallback() {
    this.removeEventListener("dragstart", this._onDragStart);
    this._teardown();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (oldVal === newVal) return;
    if (name === "doc-url") {
      this._resolveTitle();
    }
    // 'watched' attribute changes are purely visual — CSS handles it via [watched]
  }

  // -------------------------------------------------------------------------
  // Title resolution
  // -------------------------------------------------------------------------

  private _ensureLabelEl(): HTMLSpanElement {
    if (!this._labelEl) {
      this._labelEl = document.createElement("span");
      this._labelEl.className = "pw-doc-token-label";
      // Insert before close button if present, otherwise just append
      if (this._closeBtn) {
        this.insertBefore(this._labelEl, this._closeBtn);
      } else {
        this.appendChild(this._labelEl);
      }
    }
    return this._labelEl;
  }

  private _teardown() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private _resolveTitle() {
    this._teardown();

    const label = this._ensureLabelEl();
    const docUrl = this.getAttribute("doc-url");

    if (!docUrl || !this._repo) {
      if (label.textContent === "Loading…" || label.textContent === "") {
        label.textContent = "Untitled Doc";
      }
      return;
    }

    label.textContent = "Loading…";

    const capturedUrl = docUrl;

    const applyTitle = (title: string) => {
      if (this.getAttribute("doc-url") === capturedUrl) {
        label.textContent = title;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._repo
      .find<Record<string, unknown>>(capturedUrl as any)
      .then((handle) => {
        if (this.getAttribute("doc-url") !== capturedUrl) return;

        resolveDocTitle(handle)
          .then(applyTitle)
          .catch(() => applyTitle("Untitled Doc"));

        const onChange = () => {
          resolveDocTitle(handle)
            .then(applyTitle)
            .catch(() => applyTitle("Untitled Doc"));
        };
        handle.on("change", onChange);
        this._unsubscribe = () => handle.off("change", onChange);
      })
      .catch(() => applyTitle("Untitled Doc"));
  }

  // -------------------------------------------------------------------------
  // Drag — pre-fill patchwork MIME type; callers may add more in their own listener
  // -------------------------------------------------------------------------

  private _onDragStart = (e: DragEvent) => {
    const docUrl = this.getAttribute("doc-url");
    if (docUrl) {
      e.dataTransfer?.setData("text/x-patchwork-urls", JSON.stringify([docUrl]));
    }
  };
}

// Register once — guard against double-registration from HMR / multiple bundles
if (!customElements.get("pw-doc-token")) {
  customElements.define("pw-doc-token", PwDocToken);
}
