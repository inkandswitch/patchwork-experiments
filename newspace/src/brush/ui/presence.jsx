// Presence chrome (cursors, faces, shared views), extracted from tool.jsx. None of
// this is part of the headless canvas core — it's UI that READS THE CONTEXT: peers +
// camera + the active tool come from the canvas context Sources (host.context), and
// the host adds only the genuine commands/queries (serviceUrl, follow, showViews).
// The minimap is a bare tool now (minimap-node.js).
import { For, Show } from "solid-js";
import { opstreamToSignal } from "../../opstreams.js";

export function Face(props) {
  const img = () => (props.entry.avatarUrl ? props.serviceUrl(props.entry.avatarUrl) : null);
  return (
    <div class="ns-face" style={{ "--c": props.entry.color || "#888", ...(img() ? { "background-image": `url("${img()}")`, color: "transparent" } : {}) }} title={props.entry.name}>
      {(props.entry.name || "?")[0].toUpperCase()}
    </div>
  );
}

export function PresenceLayer(outer) {
  const host = outer.host || outer; // the chrome host: `context` + the command surface
  // chrome reads the CONTEXT — the same Sources the canvas runs on, as Solid accessors
  const cam = opstreamToSignal(host.context.camera);
  const peers = opstreamToSignal(host.context.peers); // already an array of peer entries
  const tool = opstreamToSignal(host.context.tool);
  const wiring = () => tool() === "wire";
  const list = () => peers() || [];
  const sx = (wx) => wx * cam().z + cam().x;
  const sy = (wy) => wy * cam().z + cam().y;
  return (
    <div class="ns-presence">
      <Show when={host.showViews()}>
        <For each={list()}>
          {(p) => (
            <Show when={p.view}>
              <div class="ns-view-box" style={{ left: `${sx(p.view.x)}px`, top: `${sy(p.view.y)}px`, width: `${p.view.w * cam().z}px`, height: `${p.view.h * cam().z}px`, "border-color": p.color, background: `color-mix(in srgb, ${p.color}, transparent 93%)` }}>
                {/* click the name to FOLLOW this person (your camera tracks theirs) */}
                <button
                  class="ns-view-tag"
                  classList={{ following: host.following && host.following() === p.contactUrl }}
                  style={{ background: p.color }}
                  title={host.following && host.following() === p.contactUrl ? "Stop following" : `Follow ${p.name}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => host.follow && host.follow(p.contactUrl)}
                >
                  <Face entry={p} serviceUrl={host.serviceUrl} />
                  <span>{p.name}</span>
                </button>
                {/* outlet ports on the right of their box — wire from a peer's live
                    state (cursor / view) with the wire tool */}
                <Show when={wiring()}>
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
                <Face entry={p} serviceUrl={host.serviceUrl} />
                <span>{p.name}</span>
              </div>
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}
