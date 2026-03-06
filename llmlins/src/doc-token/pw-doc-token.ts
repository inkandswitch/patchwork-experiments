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
//
// Events (all native, bubble normally):
//   click        — user clicked the token
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

  get repo(): Repo | undefined {
    return this._repo;
  }

  set repo(r: Repo | undefined) {
    this._repo = r;
    this._resolveTitle();
  }

  connectedCallback() {
    injectStyles();
    this.draggable = true;
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

  private _teardown() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private _resolveTitle() {
    this._teardown();

    const docUrl = this.getAttribute("doc-url");

    if (!docUrl || !this._repo) {
      if (this.textContent === "Loading…" || this.textContent === "") {
        this.textContent = "Untitled Doc";
      }
      return;
    }

    this.textContent = "Loading…";

    const capturedUrl = docUrl;

    const applyTitle = (title: string) => {
      if (this.getAttribute("doc-url") === capturedUrl) {
        this.textContent = title;
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
