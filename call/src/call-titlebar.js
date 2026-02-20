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
      padding: 2px 8px;
      border-radius: 6px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: white;
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
      transition: background 0.15s;
      user-select: none;
      height: 28px;
      box-sizing: border-box;
    }

    .call-titlebar:hover {
      background: rgba(34, 197, 94, 0.25);
    }

    .call-titlebar-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }

    .call-titlebar-count {
      font-weight: 600;
      font-size: 12px;
      color: #22c55e;
    }

    .call-titlebar-thumbs {
      display: flex;
      gap: 2px;
      align-items: center;
    }

    .call-titlebar-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: #16213e;
    }

    .call-titlebar-thumb.local {
      transform: scaleX(-1);
    }

    .call-titlebar-overflow {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: white;
      flex-shrink: 0;
    }

    .call-titlebar-popover {
      position: fixed;
      background: #1e1e2e;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 4px;
      min-width: 180px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .call-titlebar-popover button {
      background: none;
      border: none;
      color: white;
      padding: 8px 12px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background 0.1s;
    }

    .call-titlebar-popover button:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .call-titlebar-popover button.hangup {
      color: #f87171;
    }

    .call-titlebar-popover button.hangup:hover {
      background: rgba(239, 68, 68, 0.15);
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

    // Determine if we're currently viewing the call doc
    const viewingCall = handle.url === session.callUrl;

    if (viewingCall) {
      // We're on the call doc — offer "Go back" if we have a return URL
      if (session.returnUrl) {
        const goBackBtn = document.createElement("button");
        goBackBtn.textContent = "\u{2190} Go back";
        goBackBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closePopover();
          const url = session.returnUrl;
          const toolId = session.returnToolId;
          element.dispatchEvent(
            new CustomEvent("patchwork:open-document", {
              detail: { url, toolId },
              bubbles: true,
              composed: true,
            })
          );
        });
        popover.appendChild(goBackBtn);
      }
    } else {
      // We're on a different doc — offer "Go to call"
      const goToCallBtn = document.createElement("button");
      goToCallBtn.textContent = "\u{1F4DE} Go to call";
      goToCallBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePopover();
        // Store current location so we can come back
        session.returnUrl = handle.url;
        // Try to get toolId from the element
        session.returnToolId = element.hive?.currentToolId || null;
        element.dispatchEvent(
          new CustomEvent("patchwork:open-document", {
            detail: { url: session.callUrl },
            bubbles: true,
            composed: true,
          })
        );
      });
      popover.appendChild(goToCallBtn);
    }

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
