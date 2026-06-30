// A TRAY tool (tags:["tray"]) that shows the canvas's WebRTC SHARE SESSION live — who's
// connected, the data-channel state, and what's being shared/received. This is the
// visibility that was missing ("no info in the console"): the mesh, made legible.
import { sessionRegistry, sessionEvents } from "./share-session.js";

const CSS = `
.ns-share-tray { font: 11px ui-monospace, monospace; padding: 7px 9px; color: var(--ns-ink, #222); line-height: 1.5; min-width: 200px; max-width: 300px; }
.ns-share-tray h4 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; }
.ns-share-tray .peer { display: flex; gap: 6px; align-items: center; }
.ns-share-tray .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: #bbb; }
.ns-share-tray .dot.connected { background: #40dcba; }
.ns-share-tray .dot.connecting, .ns-share-tray .dot.checking, .ns-share-tray .dot.new { background: #f0b000; }
.ns-share-tray .dot.failed, .ns-share-tray .dot.disconnected, .ns-share-tray .dot.closed { background: #e5484d; }
.ns-share-tray .muted { opacity: 0.55; }
.ns-share-tray .tag { background: color-mix(in srgb, #ff2284 14%, transparent); border-radius: 4px; padding: 0 4px; }
.ns-share-tray .empty { opacity: 0.5; }
`;

function ShareTrayTool(handle, element) {
  const style = document.createElement("style"); style.textContent = CSS;
  const root = document.createElement("div"); root.className = "ns-share-tray";
  element.append(style, root);

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const render = () => {
    const sessions = [...sessionRegistry];
    if (!sessions.length) { root.innerHTML = `<div class="empty">no open canvas session</div>`; return; }
    let html = "";
    for (const s of sessions) {
      const st = s.state();
      html += `<h4>canvas mesh · me ${esc((st.myUrl || "").slice(-6))}</h4>`;
      if (!st.peers.length) html += `<div class="empty">no peers yet…</div>`;
      for (const p of st.peers) {
        const recv = p.receiving.length ? ` <span class="tag">recv ${p.receiving.length}</span>` : "";
        html += `<div class="peer"><span class="dot ${esc(p.connection)}"></span>${esc(p.short)} <span class="muted">${esc(p.connection)}${p.channel ? " · dc:" + esc(p.channel) : ""}</span>${recv}</div>`;
      }
      const sh = st.sharing.length, lv = st.listening.values.length, lstr = st.listening.streams.length;
      html += `<div class="muted" style="margin-top:4px">sharing ${sh} · listening ${lv} val / ${lstr} stream</div>`;
    }
    root.innerHTML = html;
  };

  const onChange = () => render();
  sessionEvents.addEventListener("change", onChange);
  const tick = setInterval(render, 1500); // poll too — some PC state changes don't bump
  render();
  return () => { sessionEvents.removeEventListener("change", onChange); clearInterval(tick); root.remove(); style.remove(); };
}

export const plugin = {
  type: "patchwork:tool",
  id: "sketchy:share-tray",
  name: "Canvas session",
  icon: "Radio",
  tags: ["tray"],
  supportedDatatypes: ["*"],
  async load() { return ShareTrayTool; },
};
