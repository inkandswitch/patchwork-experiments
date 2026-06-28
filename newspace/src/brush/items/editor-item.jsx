// A canvas item that hosts a `sketchy:editor` (e.g. codemirror), wired to live
// opstreams. The item stores `{ editorId, inlets: { name: {url, path, heads?} } }`;
// here we resolve the editor descriptor, rebuild each inlet opstream from its
// wiring via `ctx.api.find`, and mount it. Grabbable by its title bar; the body
// is interactive (its own pointer events + keyboard, like an embedded tool).
import { createEffect, onCleanup } from "solid-js";
import { listEditors, mountEditor } from "../../editors.js";

export function EditorItem(props) {
  const it = props.it, ctx = props.ctx;
  let host;
  let cleanup = null;
  let token = 0;

  async function mount() {
    const mine = ++token; // guard against overlapping async mounts
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    if (!host) return;
    host.replaceChildren();

    const descriptor = listEditors().find((e) => e.id === it().editorId);
    if (!descriptor) { host.textContent = `editor "${it().editorId}" not found`; return; }

    const api = ctx.api;
    const inlets = {};
    for (const [name, wire] of Object.entries(it().inlets || {})) {
      if (!wire) continue;
      // a context-wired inlet's opstream IS the canvas context Source
      if (wire.context) {
        const s = ctx.context && ctx.context[wire.context];
        if (s) inlets[name] = s;
        continue;
      }
      // a peer-wired inlet: a live Source of that peer's state part
      if (wire.peer) {
        if (ctx.peerStream) inlets[name] = ctx.peerStream(wire.peer, wire.part);
        continue;
      }
      if (!wire.url || !api) continue;
      const frag = wire.path && wire.path.length ? "#" + wire.path.join("/") : "";
      try {
        inlets[name] = await api.find(wire.url + frag, { heads: wire.heads });
      } catch (e) {
        console.warn("[sketchy] editor inlet failed:", name, e);
      }
    }
    if (mine !== token) return; // a newer mount superseded this one
    const c = await mountEditor(descriptor, { element: host, inlets });
    if (mine !== token) { try { c(); } catch {} return; }
    cleanup = c;
  }

  // (re)mount when the editor id or its wiring changes
  createEffect(() => { it().editorId; JSON.stringify(it().inlets || {}); mount(); });
  onCleanup(() => { token++; if (cleanup) { try { cleanup(); } catch {} } });

  return (
    <div class="ns-doc ns-editor" data-item-id={it().id} classList={{ sel: ctx.isSelected(it().id) }} style={props.baseStyle()} onPointerDown={props.down}>
      <div class="ns-doc-title"><span class="ns-doc-name">{it().editorId}</span></div>
      <div class="ns-editor-body ns-doc-body" ref={host} onPointerDown={(e) => e.stopPropagation()} />
    </div>
  );
}
