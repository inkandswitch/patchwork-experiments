import { createViewLayers, type ViewLayersController } from "./view-layers.js";
import { dragHandleDecorator } from "./dnd.js";
import { injectStyles } from "./styles.js";

/**
 * Singleton wiring shared by every entry point (the boot-time side effect, the
 * floating badge, and the toolbar tool). Holds the one {@link ViewLayersController}
 * plus the "pinned" flag and a tiny subscription bus so all surfaces stay in
 * sync.
 *
 * Reveal logic:
 *  - Hold Shift+Alt → temporary reveal (release to hide).
 *  - Pin (badge / toolbar click) → reveal stays until unpinned; key release
 *    no longer hides it.
 */
class UniversalDnd {
  #controller: ViewLayersController;
  #pinned = false;
  #subscribers = new Set<() => void>();

  constructor() {
    this.#controller = createViewLayers([dragHandleDecorator], {
      selector: "patchwork-view",
      onActiveChange: () => this.#emit(),
    });
  }

  get active(): boolean {
    return this.#controller.active;
  }

  get pinned(): boolean {
    return this.#pinned;
  }

  reveal(): void {
    this.#controller.activate();
  }

  hide(): void {
    if (this.#pinned) return;
    this.#controller.deactivate();
  }

  setPinned(pinned: boolean): void {
    if (this.#pinned === pinned) return;
    this.#pinned = pinned;
    if (pinned) this.#controller.activate();
    else this.#controller.deactivate();
    this.#emit();
  }

  togglePinned(): void {
    this.setPinned(!this.#pinned);
  }

  onChange(cb: () => void): () => void {
    this.#subscribers.add(cb);
    return () => this.#subscribers.delete(cb);
  }

  #emit(): void {
    for (const cb of this.#subscribers) {
      try {
        cb();
      } catch (err) {
        console.error("[universal-dnd] subscriber failed", err);
      }
    }
  }
}

let singleton: UniversalDnd | null = null;
export function getUniversalDnd(): UniversalDnd {
  if (!singleton) singleton = new UniversalDnd();
  return singleton;
}

const REVEAL_KEYS = (e: KeyboardEvent | { shiftKey: boolean; altKey: boolean }) =>
  e.shiftKey && e.altKey;

let keyboardInstalled = false;

/** Install the global Shift+Alt reveal listeners. Idempotent. */
export function installKeyboard(): void {
  if (keyboardInstalled || typeof window === "undefined") return;
  keyboardInstalled = true;
  injectStyles();
  const app = getUniversalDnd();

  const onKey = (e: KeyboardEvent) => {
    if (REVEAL_KEYS(e)) app.reveal();
    else app.hide();
  };
  // Capture phase so we see the combo even when a tool stops propagation.
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  // Losing focus (e.g. Alt+Tab) never delivers the keyup — hide proactively.
  window.addEventListener("blur", () => app.hide());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) app.hide();
  });
}
