// A part's tab in the drawer (NATIVE.md, "Native services"): its panel, docked with "drawer"
// while it's open. Chrome follows attention, never the doc: whoever owns the
// tab says when it opens (the inspector on a selection, staying open after;
// dimensions and parts when the viewer asks), and the tab's × is
// the viewer closing it (onClosed).
//
// mount(body) runs once, on the first open, and answers { opened(),
// update(scene, local), dispose() }, each optional: opened runs each time the
// tab docks, just before the update it gets as it opens; update runs while
// the tab is open; dispose as the tab goes.
//
// A tab is the editor's chrome: its owner makes it while the Edit hand is
// held and disposes it as the hand goes (whileHolding, ../stage/public.js),
// which shuts it without telling onClosed (not the viewer closing it). The
// parts that own tabs are view plugins, which don't move with the focus: a
// tab open stays open across Enter and Leave, showing the focus doc
// wherever it is now.

/**
 * @param {object} api  a view plugin's
 * @param {{ id: string, title: string, mount: (body: HTMLElement) => ({ opened?, update?, dispose? } | null), onClosed?: () => void }} o
 *   `id` names the panel (its element's data-panel: "inspector", "parts")
 */
export function drawerTab(api, { id, title, mount, onClosed }) {
  const body = document.createElement("div");
  body.className = "drawer-tab";
  if (id) body.dataset.panel = id;
  let view = null;
  let close = null;

  /** Dock it (if it isn't); `show: false` puts it behind a pane already shown, a tab to pick. */
  function open({ show = true } = {}) {
    if (close) return;
    if (!view) {
      try {
        view = mount(body) ?? null;
      } catch (err) {
        console.warn(`[scene] the ${title} tab failed to mount`, err);
      }
    }
    close = api.use("drawer")?.dock(body, {
      title,
      show,
      // the stage's own chrome: its keys are the stage's (the ladder's Escape, the tree's arrows)
      embed: false,
      onClose: () => {
        close = null;
        onClosed?.();
      },
    }) ?? null;
    try {
      view?.opened?.();
      const f = api.focus();
      if (f) view?.update?.(f.scene(), f.local.get(), f.view.get());
    } catch (err) {
      console.warn(`[scene] the ${title} tab failed to update`, err);
    }
  }

  function shut() {
    const c = close;
    close = null;
    c?.();
  }
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
 * `tab()` is the tab while it is made (null: no tab, the toggle not there);
 * `available()` false (nothing to show: no parts on offer) leaves it out.
 */
export function tabToggle(tab, { id, name, title, icon, available = () => true }) {
  return {
    id,
    name,
    // the drawer's rail shows the "panels" group (../native/drawer.js), not the bar
    group: "panels",
    ...(icon ? { icon } : {}),
    // the drawer's tabs are the editor's: only while editing
    hand: "edit",
    show: ["toolbar"],
    state: (target) => (target == null && tab() && available() ? { checked: tab().isOpen(), title } : null),
    // (the toolbar says which way; a key or the menu toggles)
    run: (_target, value) => {
      const t = tab();
      if (t) (value === undefined ? !t.isOpen() : !!value) ? t.open() : t.close();
    },
  };
}
