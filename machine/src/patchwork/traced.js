// The machines this tab is playing, by session url: { history, host, by },
// so that the history view can show what a player's own peer went through
// (its predictions, its rollbacks) rather than only a watcher's. A lookup in
// one tab, late-bound both ways: either view may open first, or alone.
// Keyed on the global so that two copies of this module share it.
const KEY = Symbol.for("machine.traced");
export const traced = (globalThis[KEY] ??= new Map());
