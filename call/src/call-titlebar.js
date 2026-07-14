/**
 * Call Titlebar — compact call indicator for the Patchwork titlebar.
 *
 * Shows a green dot, participant count, and tiny circular video thumbnails
 * when a CallSession is active. Clicking opens a popover (portaled to body)
 * with "Go to call" / "Go back" and "Hang up" options.
 *
 * Listens for `patchwork-call-session-changed` on window so it picks up
 * sessions that start after the titlebar has already mounted.
 */

import { getCallSession } from "./call-session.js";

function injectStyles() {
  if (document.getElementById("call-titlebar-styles")) return;
  const style = document.createElement("style");
  style.id = "call-titlebar-styles";
  style.textContent = `
    .call-titlebar {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      padding: 2px 10px;
      border-radius: var(--studio-radius-round, 9999px);
      font-family: var(--studio-family-sans, "Jost*", "Jost", system-ui, -apple-system, sans-serif);
      font-size: 12px;
      color: var(--studio-chrome-line, white);
      background: color-mix(in srgb, var(--studio-primary, #ff2284), transparent 86%);
      border: 1px solid color-mix(in srgb, var(--studio-primary, #ff2284), transparent 70%);
      transition: background var(--studio-transition, 0.15s ease);
      user-select: none;
      height: 28px;
      box-sizing: border-box;
    }

    .call-titlebar:hover {
      background: color-mix(in srgb, var(--studio-primary, #ff2284), transparent 76%);
    }

    .call-titlebar-dot {
      width: 6px;
      height: 6px;
      border-radius: var(--studio-radius-round, 9999px);
      background: var(--studio-primary, #ff2284);
      flex-shrink: 0;
    }

    .call-titlebar-count {
      font-weight: 700;
      font-size: 12px;
      font-family: var(--studio-family-code, monaco, "Lifesender Mono", ui-monospace, monospace);
      color: var(--studio-primary, #ff2284);
    }

    .call-titlebar-thumbs {
      display: flex;
      gap: 2px;
      align-items: center;
    }

    .call-titlebar-thumb {
      width: 20px;
      height: 20px;
      border-radius: var(--studio-radius-round, 9999px);
      object-fit: cover;
      border: 1px solid color-mix(in srgb, var(--studio-chrome-line, #fff), transparent 80%);
      background: var(--studio-chrome-offset-20, #16213e);
    }

    .call-titlebar-thumb.local {
      transform: scaleX(-1);
    }

    .call-titlebar-overflow {
      width: 20px;
      height: 20px;
      border-radius: var(--studio-radius-round, 9999px);
      background: color-mix(in srgb, var(--studio-chrome-line, #fff), transparent 85%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: var(--studio-chrome-line, white);
      flex-shrink: 0;
    }

    .call-titlebar-popover {
      position: fixed;
      background: var(--studio-chrome, #1e1e2e);
      border: 1px solid color-mix(in srgb, var(--studio-chrome-line, #fff), transparent 88%);
      border-radius: var(--studio-radius-lg, 12px);
      padding: 5px;
      min-width: 180px;
      box-shadow: var(--studio-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.4));
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-family: var(--studio-family-sans, "Jost*", "Jost", system-ui, -apple-system, sans-serif);
    }

    .call-titlebar-popover button {
      background: none;
      border: none;
      color: var(--studio-chrome-line, white);
      padding: 8px 12px;
      border-radius: var(--studio-radius-md, 8px);
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background var(--studio-transition-fast, 0.1s ease);
    }

    .call-titlebar-popover button:hover {
      background: color-mix(in srgb, var(--studio-chrome-line, #fff), transparent 90%);
    }

    .call-titlebar-popover button.hangup {
      color: var(--studio-danger, #f87171);
    }

    .call-titlebar-popover button.hangup:hover {
      background: color-mix(in srgb, var(--studio-danger, #ef4444), transparent 85%);
    }
  `;
  document.head.appendChild(style);
}

const MAX_THUMBS = 4;

export default function CallTitlebarTool(handle, element) {
  injectStyles();

  let session = getCallSession();
  let destroyed = false;
  const listeners = [];

  function on(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push({ target, event, handler });
  }

  // ---- Root element ----
  const root = document.createElement("div");
  root.className = "call-titlebar";
  element.appendChild(root);

  const dot = document.createElement("span");
  dot.className = "call-titlebar-dot";
  root.appendChild(dot);

  const count = document.createElement("span");
  count.className = "call-titlebar-count";
  root.appendChild(count);

  const thumbsContainer = document.createElement("div");
  thumbsContainer.className = "call-titlebar-thumbs";
  root.appendChild(thumbsContainer);

  // ---- Popover (portaled to body) ----
  let popover = null;

  function openPopover() {
    if (popover) {
      closePopover();
      return;
    }
    if (!session || session.destroyed) return;

    popover = document.createElement("div");
    popover.className = "call-titlebar-popover";

    // Position relative to the root button
    const rect = root.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.right = `${window.innerWidth - rect.right}px`;

    // "Go to call" — navigate to the context where the call was joined
    // (e.g. a spatial folder embedding the call), parsed from the URL at
    // join time so we return to the exact same view.
    const ctx = session.callContext;
    if (ctx) {
      const goToCallBtn = document.createElement("button");
      goToCallBtn.textContent = "\u{1F4DE} Go to call";
      goToCallBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePopover();
        element.dispatchEvent(
          new CustomEvent("patchwork:open-document", {
            detail: { url: ctx.url, toolId: ctx.toolId },
            bubbles: true,
            composed: true,
          })
        );
      });
      popover.appendChild(goToCallBtn);
    }

    // Copy automerge URL
    const copyAmBtn = document.createElement("button");
    copyAmBtn.textContent = "\u{1F4CB} Copy automerge URL";
    copyAmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(session.callUrl).then(() => {
        copyAmBtn.textContent = "\u{2705} Copied!";
        setTimeout(() => { copyAmBtn.textContent = "\u{1F4CB} Copy automerge URL"; }, 1500);
      });
    });
    popover.appendChild(copyAmBtn);

    // Copy tiny patchwork URL
    const copyTinyBtn = document.createElement("button");
    copyTinyBtn.textContent = "\u{1F517} Copy tiny URL";
    copyTinyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const docId = session.callUrl.replace(/^automerge:/, "");
      const doc = session.handle.doc();
      const title = doc?.title || "Call";
      const params = new URLSearchParams();
      params.set("doc", docId);
      params.set("title", title);
      params.set("tool", "telephone");
      params.set("type", "call");
      const tinyUrl = `https://tiny.patchwork.inkandswitch.com/#${params.toString()}`;
      navigator.clipboard.writeText(tinyUrl).then(() => {
        copyTinyBtn.textContent = "\u{2705} Copied!";
        setTimeout(() => { copyTinyBtn.textContent = "\u{1F517} Copy tiny URL"; }, 1500);
      });
    });
    popover.appendChild(copyTinyBtn);

    const hangUpBtn = document.createElement("button");
    hangUpBtn.className = "hangup";
    hangUpBtn.textContent = "\u{260E}\u{FE0F} Hang up";
    hangUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover();
      session.leave();
    });
    popover.appendChild(hangUpBtn);

    document.body.appendChild(popover);
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  root.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopover();
  });

  on(document, "pointerdown", (e) => {
    if (popover && !popover.contains(e.target) && !root.contains(e.target)) {
      closePopover();
    }
  });

  // ---- Render ----

  function render() {
    if (!session || !session.joined || session.destroyed) {
      root.style.display = "none";
      closePopover();
      return;
    }

    root.style.display = "";

    const participantCount = 1 + session.peers.size;
    count.textContent = String(participantCount);

    // Rebuild thumbnails
    thumbsContainer.innerHTML = "";

    // Local thumbnail
    if (session.localStream) {
      const vid = document.createElement("video");
      vid.className = "call-titlebar-thumb local";
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = session.localStream;
      thumbsContainer.appendChild(vid);
    }

    // Remote thumbnails
    let shown = 0;
    for (const [, peer] of session.peers) {
      if (shown >= MAX_THUMBS - 1) break;
      const vid = document.createElement("video");
      vid.className = "call-titlebar-thumb";
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = peer.stream;
      thumbsContainer.appendChild(vid);
      shown++;
    }

    // Overflow indicator
    const remaining = session.peers.size - shown;
    if (remaining > 0) {
      const overflow = document.createElement("span");
      overflow.className = "call-titlebar-overflow";
      overflow.textContent = `+${remaining}`;
      thumbsContainer.appendChild(overflow);
    }
  }

  // ---- Session binding ----

  function unbindSession() {
    // Session event listeners are tracked in `listeners` and cleaned up globally
  }

  function bindSession(s) {
    session = s;
    if (!s) return;
    on(s, "peers-changed", render);
    on(s, "media-changed", render);
    on(s, "state-changed", render);
    on(s, "destroyed", () => {
      session = null;
      render();
    });
  }

  // Listen for session creation/change (covers the case where session
  // starts after this titlebar tool has already mounted)
  on(window, "patchwork-call-session-changed", () => {
    if (destroyed) return;
    const newSession = getCallSession();
    if (newSession !== session) {
      session = null; // clear so we re-bind
      if (newSession && !newSession.destroyed) {
        bindSession(newSession);
      }
      render();
    } else {
      render();
    }
  });

  // Initial bind
  if (session && session.joined && !session.destroyed) {
    bindSession(session);
  }
  render();

  // ---- Cleanup ----
  return () => {
    destroyed = true;
    for (const { target, event, handler } of listeners) {
      target.removeEventListener(event, handler);
    }
    listeners.length = 0;
    closePopover();
    root.remove();
  };
}
