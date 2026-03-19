import { findRef } from './ref.js';

/** Decode attribute values set with encodeURIComponent (safe no-op if not encoded). */
function decodeAttr(raw) {
  const t = raw.trim();
  if (!t) return t;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

const ATTR_TOOL = 'tool-url';
const ATTR_REF = 'ref-url';

/** @type {any} */
let refViewRepo;

/**
 * Registers the &lt;ref-view&gt; custom element. Keeps a repo reference for resolving ref-url.
 * @param {any} [repo] defaults to `globalThis.repo`
 */
export function registerRefView(repo = globalThis.repo) {
  refViewRepo = repo;
  if (customElements.get('ref-view')) return;
  customElements.define('ref-view', RefViewElement);
}

class RefViewElement extends HTMLElement {
  /** @type {(() => void) | null} */
  #cleanup = null;
  /** @type {AbortController | null} */
  #mountAbort = null;

  static get observedAttributes() {
    return [ATTR_TOOL, ATTR_REF];
  }

  get toolUrl() {
    return this.getAttribute(ATTR_TOOL) ?? '';
  }

  /** @param {string | null | undefined} value */
  set toolUrl(value) {
    const v = value == null ? '' : String(value);
    const cur = this.getAttribute(ATTR_TOOL) ?? '';
    if (v === cur) return;
    if (v === '') this.removeAttribute(ATTR_TOOL);
    else this.setAttribute(ATTR_TOOL, v);
  }

  get refUrl() {
    return this.getAttribute(ATTR_REF) ?? '';
  }

  /** @param {string | null | undefined} value */
  set refUrl(value) {
    const v = value == null ? '' : String(value);
    const cur = this.getAttribute(ATTR_REF) ?? '';
    if (v === cur) return;
    if (v === '') this.removeAttribute(ATTR_REF);
    else this.setAttribute(ATTR_REF, v);
  }

  connectedCallback() {
    this.#scheduleMount();
  }

  disconnectedCallback() {
    this.#mountAbort?.abort();
    this.#mountAbort = null;
    this.#teardown();
  }

  attributeChangedCallback(_name, oldVal, newVal) {
    if (oldVal === newVal || !this.isConnected) return;
    this.#scheduleMount();
  }

  #scheduleMount() {
    this.#mountAbort?.abort();
    const ac = new AbortController();
    this.#mountAbort = ac;
    const { signal } = ac;
    queueMicrotask(() => {
      if (!this.isConnected || signal.aborted) return;
      void this.#mount(signal);
    });
  }

  #teardown() {
    if (this.#cleanup) {
      try {
        this.#cleanup();
      } catch (_err) {
        // ignore cleanup errors
      }
      this.#cleanup = null;
    }
  }

  /** @param {AbortSignal} signal */
  #stale(signal) {
    return signal.aborted || !this.isConnected;
  }

  /** @param {AbortSignal} signal */
  async #mount(signal) {
    this.#teardown();
    const toolUrl = decodeAttr(this.toolUrl);
    const refUrl = decodeAttr(this.refUrl);
    if (!toolUrl || !refUrl) {
      this.replaceChildren();
      return;
    }

    const repo = refViewRepo ?? globalThis.repo;
    if (!repo || typeof repo.find !== 'function') {
      this.replaceChildren();
      const msg = document.createTextNode(
        'ref-view: no repo (set window.repo or call registerRefView(repo))',
      );
      this.appendChild(msg);
      return;
    }

    this.replaceChildren();

    try {
      const ref = await findRef(repo, refUrl);
      if (this.#stale(signal)) return;

      const mod = await import(/* @vite-ignore */ toolUrl);
      if (this.#stale(signal)) return;

      const fn = mod.default;
      if (typeof fn !== 'function') {
        throw new TypeError('module default export must be a function (ref, element) => cleanup?');
      }

      const dispose = fn(ref, this);
      if (this.#stale(signal)) {
        if (typeof dispose === 'function') dispose();
        return;
      }

      this.#cleanup = typeof dispose === 'function' ? dispose : null;
    } catch (err) {
      if (signal.aborted) return;
      if (!this.isConnected) return;
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent =
        err instanceof Error ? `ref-view: ${err.message}` : `ref-view: ${String(err)}`;
      this.appendChild(pre);
    }
  }
}
