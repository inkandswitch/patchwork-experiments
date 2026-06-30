// Presence + minimap chrome, extracted from tool.jsx. All prop-driven (peers,
// cam, bounds, serviceUrl, …) — none of this is part of the headless canvas core;
// it's UI that reads the canvas context. (Toward: chrome as plugins.)
import { For, Show } from "solid-js";

export function Face(props) {
  const img = () => (props.entry.avatarUrl ? props.serviceUrl(props.entry.avatarUrl) : null);
  return (
    <div class="ns-face" style={{ "--c": props.entry.color || "#888", ...(img() ? { "background-image": `url("${img()}")`, color: "transparent" } : {}) }} title={props.entry.name}>
      {(props.entry.name || "?")[0].toUpperCase()}
    </div>
  );
}

export function PresenceLayer(props) {
  const list = () => [...props.peers().values()];
  const sx = (wx) => wx * props.cam().z + props.cam().x;
  const sy = (wy) => wy * props.cam().z + props.cam().y;
  return (
    <div class="ns-presence">
      <Show when={props.showViews()}>
        <For each={list()}>
          {(p) => (
            <Show when={p.view}>
              <div class="ns-view-box" style={{ left: `${sx(p.view.x)}px`, top: `${sy(p.view.y)}px`, width: `${p.view.w * props.cam().z}px`, height: `${p.view.h * props.cam().z}px`, "border-color": p.color, background: `color-mix(in srgb, ${p.color}, transparent 93%)` }}>
                {/* click the name to FOLLOW this person (your camera tracks theirs) */}
                <button
                  class="ns-view-tag"
                  classList={{ following: props.following && props.following() === p.contactUrl }}
                  style={{ background: p.color }}
                  title={props.following && props.following() === p.contactUrl ? "Stop following" : `Follow ${p.name}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => props.onFollow && props.onFollow(p.contactUrl)}
                >
                  <Face entry={p} serviceUrl={props.serviceUrl} />
                  <span>{p.name}</span>
                </button>
                {/* outlet ports on the right of their box — wire from a peer's live
                    state (cursor / view) with the wire tool */}
                <Show when={props.wiring && props.wiring()}>
                  <div class="ns-peer-ports">
                    <For each={["cursor", "view", "selection", "tool"]}>
                      {(part) => (
                        <div class="ns-peer-port" data-sketchy-peer={p.contactUrl} data-sketchy-part={part} title={`${p.name}: ${part}`}>{part}</div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          )}
        </For>
      </Show>
      <For each={list()}>
        {(p) => (
          <Show when={p.cursor}>
            <div class="ns-cursor" style={{ left: `${sx(p.cursor.x)}px`, top: `${sy(p.cursor.y)}px`, color: p.color }}>
              <svg viewBox="0 0 16 16" width="18" height="18"><path d="M2 1l11 5.5-4.6 1.4L6.2 13z" fill="currentColor" stroke="#fff" stroke-width="1" stroke-linejoin="round" /></svg>
              <div class="ns-cursor-tag" style={{ background: p.color }}>
                <Face entry={p} serviceUrl={props.serviceUrl} />
                <span>{p.name}</span>
              </div>
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}

export function Minimap(props) {
  const SIZE = { w: 180, h: 130 };
  const scale = () => { const b = props.bounds(); return Math.min(SIZE.w / b.w, SIZE.h / b.h); };
  const fx = (wx) => (wx - props.bounds().x) * scale();
  const fy = (wy) => (wy - props.bounds().y) * scale();
  const list = () => [...props.peers().values()];
  function jumpAt(rect, clientX, clientY) {
    const b = props.bounds(), s = scale();
    props.onJump(b.x + (clientX - rect.left) / s, b.y + (clientY - rect.top) / s);
  }
  // click OR drag to move around — track the pointer while it's down
  function startJump(e) {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    jumpAt(rect, e.clientX, e.clientY);
    const move = (ev) => jumpAt(rect, ev.clientX, ev.clientY);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div class="ns-minimap" style={{ width: `${SIZE.w}px`, height: `${SIZE.h}px` }} onPointerDown={startJump}>
      <For each={props.rects()}>
        {(r) => <div class="ns-mm-rect" classList={{ box: r.box }} style={{ left: `${fx(r.x)}px`, top: `${fy(r.y)}px`, width: `${Math.max(1, r.w * scale())}px`, height: `${Math.max(1, r.h * scale())}px` }} />}
      </For>
      <Show when={props.view()}>
        <div class="ns-mm-view" style={{ left: `${fx(props.view().x)}px`, top: `${fy(props.view().y)}px`, width: `${props.view().w * scale()}px`, height: `${props.view().h * scale()}px` }} />
      </Show>
      <For each={list()}>
        {(p) => (
          <Show when={p.cursor}>
            <div class="ns-mm-face" style={{ left: `${fx(p.cursor.x)}px`, top: `${fy(p.cursor.y)}px` }}>
              <Face entry={p} serviceUrl={props.serviceUrl} />
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}
