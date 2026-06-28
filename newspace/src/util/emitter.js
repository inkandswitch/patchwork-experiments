// A tiny event emitter — ported from littlebook
// (lb/littlebook/system/packages/utility/emitter.ts), using a plain Set instead
// of lb's LbSet. `on` returns an unsubscribe; `emit` iterates a snapshot so a
// listener may unsubscribe during dispatch.
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(listener);
      return () => this.off(event, listener);
    },
    off(event, listener) {
      const set = listeners.get(event);
      if (set) set.delete(listener);
    },
    emit(event, ...payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const listener of [...set]) listener.apply(this, payload);
    },
  };
}
