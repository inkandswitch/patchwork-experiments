// A part's tab in the drawer (TOOLS.md §6): its panel, docked with api.dock
// while it's open. Chrome follows attention, never the doc: whoever owns the
// tab says when it opens (the inspector while something is selected; the
// outline, dimensions and parts when the viewer asks), and the tab's × is
// the viewer closing it (onClosed).
//
// mount(body) runs once, on the first open, and answers { update(scene,
// local), dispose() }; update runs while the tab is open (and once as it
// opens), dispose when the part stops.
//
// The drawer's tabs are the editor's (../stage/bodies.js): a tab opens only
// while the body is Edit, and shuts when the body stops being Edit (not
// the viewer closing it: onClosed isn't told). The parts that own tabs are
// general, so they move with the focus (Enter, Leave): a tab open as the
// focus moved opens again where it went (the view's `reopen`).

import { editing } from "../stage/bodies.js";

/**
 * @param {object} api
 * @param {{ id: string, title: string, mount: (body: HTMLElement) => ({ update?, dispose? } | null), onClosed?: () => void }} o
 *   `id` names the panel (its element's data-panel: "inspector", "objects")
 */
export function drawerTab(api, { id, title, mount, onClosed }) {
  const body = document.createElement("div");
  body.className = "drawer-tab";
  if (id) body.dataset.panel = id;
  let view = null;
  let close = null;

  /** Dock it (if it isn't); `show: false` puts it behind a pane already shown, a tab to pick. */
  function open({ show = true } = {}) {
    if (close || !editing(api.view.get())) return;
    if (!view) {
      try {
        view = mount(body) ?? null;
      } catch (err) {
        console.warn(`[scene] the ${title} tab failed to mount`, err);
      }
    }
    close = api.dock(body, {
      title,
      show,
      // the stage's own chrome: its keys are the stage's (the ladder's Escape, the outline's arrows)
      embed: false,
      onClose: () => {
        close = null;
        onClosed?.();
      },
    });
    try {
      view?.update?.(api.scene(), api.local.get(), api.view.get());
    } catch (err) {
      console.warn(`[scene] the ${title} tab failed to update`, err);
    }
  }

  function shut() {
    const c = close;
    close = null;
    c?.();
  }
  // the focus moved here with this tab open (stage/view.js `reopen`): it opens again, in the scene the focus is in now
  queueMicrotask(() => {
    const again = api.view.get().reopen;
    if (!api.signal?.aborted && !close && again?.tabs?.includes(title)) open({ show: again.shown === title || !again.shown });
  });
  // out of Edit, the tab goes
  api.view.watch?.(
    () => api.schedule(() => {
      if (close && !editing(api.view.get())) shut();
    }),
    (v) => v.body,
  );

  return {
    open,
    close: shut,
    /** is it docked now? */
    isOpen: () => !!close,
    /** the panel's element (for tests and probes) */
    body,
    update(scene, local, viewValue) {
      if (!close) return;
      try {
        view?.update?.(scene, local, viewValue);
      } catch (err) {
        console.warn(`[scene] the ${title} tab failed to update`, err);
      }
    },
    dispose() {
      shut();
      try {
        view?.dispose?.();
      } catch (err) {
        console.warn(`[scene] the ${title} tab failed to dispose`, err);
      }
      view = null;
    },
  };
}

/**
 * A toolbar toggle that opens and closes a tab: { id, name, show, state, run }.
 * `available()` false (nothing to show: no parts on offer) leaves it out.
 */
export function tabToggle(tab, { id, name, title, available = () => true }) {
  return {
    id,
    name,
    // the drawer's tabs are the editor's (../stage/bodies.js): only in Edit
    edit: true,
    show: ["toolbar"],
    state: (target) => (target == null && available() ? { checked: tab.isOpen(), title } : null),
    // (the toolbar says which way; a key or the menu toggles)
    run: (_target, value) => ((value === undefined ? !tab.isOpen() : !!value) ? tab.open() : tab.close()),
  };
}
