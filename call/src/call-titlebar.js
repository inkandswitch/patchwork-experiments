/**
 * Call Titlebar — compact call indicator for the Patchwork titlebar.
 *
 * Shows a green dot, participant count, and tiny circular video thumbnails
 * when a CallSession is active. Clicking opens a popover with "Return to call"
 * and "Hang up" options.
 */

import { getCallSession } from "./call-session.js";

function createStyles() {
  const style = document.createElement("style");
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
      position: relative;
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
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: #1e1e2e;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 4px;
      min-width: 160px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 2px;
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
  return style;
}

const MAX_THUMBS = 4;

export default function CallTitlebarTool(handle, element) {
  const session = getCallSession();
  if (!session || !session.joined || session.destroyed) {
    // Nothing to show
    return () => {};
  }

  const style = createStyles();
  element.appendChild(style);

  const root = document.createElement("div");
  root.className = "call-titlebar";
  element.appendChild(root);

  const dot = document.createElement("span");
  dot.className = "call-titlebar-dot";
  root.appendChild(dot);

  const count = document.createElement("span");
  count.className = "call-titlebar-count";
  root.appendChild(count);

  const thumbs = document.createElement("div");
  thumbs.className = "call-titlebar-thumbs";
  root.appendChild(thumbs);

  let popover = null;
  const listeners = [];

  function on(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push({ target, event, handler });
  }

  function render() {
    if (!session || session.destroyed) {
      root.style.display = "none";
      return;
    }

    const participantCount = 1 + session.peers.size;
    count.textContent = String(participantCount);

    // Rebuild thumbnails
    thumbs.innerHTML = "";

    // Local thumbnail
    if (session.localStream) {
      const vid = document.createElement("video");
      vid.className = "call-titlebar-thumb local";
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = session.localStream;
      thumbs.appendChild(vid);
    }

    // Remote thumbnails
    let shown = 0;
    for (const [, peer] of session.peers) {
      if (shown >= MAX_THUMBS - 1) break; // -1 for local
      const vid = document.createElement("video");
      vid.className = "call-titlebar-thumb";
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = peer.stream;
      thumbs.appendChild(vid);
      shown++;
    }

    // Overflow indicator
    const remaining = session.peers.size - shown;
    if (remaining > 0) {
      const overflow = document.createElement("span");
      overflow.className = "call-titlebar-overflow";
      overflow.textContent = `+${remaining}`;
      thumbs.appendChild(overflow);
    }

    root.style.display = "";
  }

  function openPopover() {
    if (popover) {
      closePopover();
      return;
    }

    popover = document.createElement("div");
    popover.className = "call-titlebar-popover";

    const returnBtn = document.createElement("button");
    returnBtn.innerHTML = "\u{1F4DE} Return to call";
    returnBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover();
      element.dispatchEvent(
        new CustomEvent("patchwork:open-document", {
          detail: { url: session.callUrl },
          bubbles: true,
          composed: true,
        })
      );
    });

    const hangUpBtn = document.createElement("button");
    hangUpBtn.className = "hangup";
    hangUpBtn.innerHTML = "\u{260E}\u{FE0F} Hang up";
    hangUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover();
      session.leave();
    });

    popover.appendChild(returnBtn);
    popover.appendChild(hangUpBtn);
    root.appendChild(popover);
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
    if (popover && !root.contains(e.target)) {
      closePopover();
    }
  });

  // Session events
  on(session, "peers-changed", render);
  on(session, "media-changed", render);
  on(session, "state-changed", render);
  on(session, "destroyed", () => {
    root.style.display = "none";
    closePopover();
  });

  render();

  // Cleanup
  return () => {
    for (const { target, event, handler } of listeners) {
      target.removeEventListener(event, handler);
    }
    listeners.length = 0;
    closePopover();
    root.remove();
    style.remove();
  };
}
