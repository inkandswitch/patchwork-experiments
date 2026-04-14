/**
 * Telephone — View layer for WebRTC video calls.
 *
 * All WebRTC state lives in CallSession (call-session.js). This module
 * creates/consumes a session and renders the video grid, lobby, and controls.
 * Navigating away removes DOM + event listeners but does NOT end the call —
 * the session persists for the titlebar indicator.
 */

import {
  createCallSession,
  getCallSession,
  CallSession,
  QUALITY_PRESETS,
  QUALITY_LEVELS,
} from "./call-session.js";

function createQualityMenu(currentLevel, onSelect) {
  const menu = document.createElement("div");
  menu.className = "call-quality-menu";
  for (const level of QUALITY_LEVELS) {
    const btn = document.createElement("button");
    btn.textContent = QUALITY_PRESETS[level].label;
    if (level === currentLevel) btn.className = "active";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(level);
    });
    menu.appendChild(btn);
  }
  return menu;
}

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .call-container {
      width: 100%;
      height: 100%;
      background: #111;
      font-family: system-ui, -apple-system, sans-serif;
      overflow: hidden;
    }

    .call-grid {
      width: 100%;
      height: 100%;
      display: grid;
      gap: 1px;
    }

    .call-grid[data-count="1"] {
      grid-template-columns: 1fr;
    }
    .call-grid[data-count="2"] {
      grid-template-columns: 1fr 1fr;
    }
    .call-grid[data-count="3"],
    .call-grid[data-count="4"] {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
    }
    .call-grid[data-count="5"],
    .call-grid[data-count="6"] {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: 1fr 1fr;
    }
    .call-grid[data-count="7"],
    .call-grid[data-count="8"],
    .call-grid[data-count="9"] {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: 1fr 1fr 1fr;
    }

    .call-participant {
      position: relative;
      background: #16213e;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
    }

    .call-participant video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .call-participant.local video {
      transform: scaleX(-1);
    }

    .call-participant-bar {
      position: absolute;
      bottom: 8px;
      left: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 4px 6px 4px 10px;
      border-radius: 8px;
      font-size: 13px;
    }

    .call-participant-bar span {
      pointer-events: none;
    }

    .call-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.15);
      color: white;
      transition: background 0.15s;
      padding: 0;
    }

    .call-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .call-btn.off {
      background: #dc2626;
    }

    .call-status-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      color: white;
      font-size: 13px;
      gap: 8px;
      z-index: 5;
      pointer-events: none;
    }

    .call-status-overlay[hidden] {
      display: none;
    }

    .call-status-overlay .call-status-text {
      opacity: 0.9;
    }

    .call-status-overlay .call-retry-btn {
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 4px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }

    .call-status-overlay .call-retry-btn:hover {
      background: rgba(255, 255, 255, 0.35);
    }

    .call-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .call-status-dot.connecting {
      background: #f59e0b;
      animation: pulse-dot 1.2s ease-in-out infinite;
    }
    .call-status-dot.connected { background: #22c55e; }
    .call-status-dot.reconnecting {
      background: #f59e0b;
      animation: pulse-dot 0.6s ease-in-out infinite;
    }
    .call-status-dot.failed { background: #ef4444; }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .call-local-status {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .call-local-status[hidden] {
      display: none;
    }

    .call-local-status .call-retry-btn {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 3px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
    }

    .call-local-status .call-retry-btn:hover {
      background: rgba(255, 255, 255, 0.35);
    }

    .call-btn .quality-label {
      font-size: 9px;
      font-weight: 700;
      pointer-events: none;
    }

    .call-quality-anchor {
      position: relative;
    }

    .call-quality-menu {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 30;
      min-width: 56px;
    }

    .call-quality-menu button {
      background: none;
      border: none;
      color: white;
      padding: 5px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      font-weight: 500;
      text-align: center;
      white-space: nowrap;
    }

    .call-quality-menu button:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .call-quality-menu button.active {
      background: rgba(255, 255, 255, 0.25);
    }

    .call-sending-quality {
      position: absolute;
      bottom: 8px;
      right: 8px;
      background: rgba(0, 0, 0, 0.6);
      color: rgba(255, 255, 255, 0.7);
      padding: 2px 6px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 600;
      font-family: system-ui, -apple-system, sans-serif;
      pointer-events: none;
      z-index: 4;
    }

    .call-lobby {
      position: absolute;
      inset: 0;
      z-index: 20;
      background: #111;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      font-family: system-ui, -apple-system, sans-serif;
      color: white;
    }

    .call-lobby-preview {
      width: 320px;
      max-width: 80%;
      aspect-ratio: 4 / 3;
      border-radius: 12px;
      overflow: hidden;
      background: #16213e;
      position: relative;
    }

    .call-lobby-preview video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }

    .call-lobby-controls {
      display: flex;
      gap: 10px;
    }

    .call-lobby-toggle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.15);
      color: white;
      transition: background 0.15s;
    }

    .call-lobby-toggle:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .call-lobby-toggle.off {
      background: #dc2626;
    }

    .lobby-quality-label {
      font-size: 11px;
      font-weight: 700;
      pointer-events: none;
    }

    .call-lobby-join {
      padding: 12px 36px;
      border-radius: 24px;
      border: none;
      background: #22c55e;
      color: white;
      font-size: 16px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }

    .call-lobby-join:hover {
      background: #16a34a;
    }

    .call-lobby-name {
      font-size: 14px;
      opacity: 0.7;
    }

    .call-lobby-error {
      font-size: 13px;
      color: #f87171;
      text-align: center;
      max-width: 280px;
    }

    .call-other-tab {
      position: absolute;
      inset: 0;
      z-index: 20;
      background: #111;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      color: white;
    }

    .call-other-tab-msg {
      font-size: 15px;
      opacity: 0.8;
    }

    .call-other-tab button {
      padding: 10px 28px;
      border-radius: 20px;
      border: none;
      background: #3b82f6;
      color: white;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }

    .call-other-tab button:hover {
      background: #2563eb;
    }

    .call-teleprint-panel {
      position: absolute;
      bottom: 60px;
      right: 12px;
      width: 380px;
      height: 420px;
      background: #1a1a2e;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      overflow: hidden;
      z-index: 25;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      resize: both;
    }

    .call-teleprint-panel patchwork-view {
      flex: 1;
      min-height: 0;
    }

  `;
  return style;
}

export default function TelephoneTool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  let viewDestroyed = false;

  // DOM
  const container = document.createElement("div");
  container.className = "call-container";
  container.style.position = "relative";
  element.appendChild(container);

  const grid = document.createElement("div");
  grid.className = "call-grid";
  container.appendChild(grid);

  // Local status banner
  const localStatus = document.createElement("div");
  localStatus.className = "call-local-status";
  localStatus.hidden = true;
  container.appendChild(localStatus);

  // Transcription loading indicator
  const loadingIndicator = document.createElement("div");
  loadingIndicator.style.cssText =
    "position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);" +
    "color:white;padding:4px 10px;border-radius:6px;font-size:12px;" +
    "font-family:system-ui,sans-serif;z-index:10;display:none;";
  container.appendChild(loadingIndicator);

  // ---- Local video box ----
  const localBox = document.createElement("div");
  localBox.className = "call-participant local";
  const localVideo = document.createElement("video");
  localVideo.autoplay = true;
  localVideo.muted = true;
  localVideo.playsInline = true;
  localBox.appendChild(localVideo);

  const localBar = document.createElement("div");
  localBar.className = "call-participant-bar";
  const localName = document.createElement("span");
  localName.textContent = "You";
  localBar.appendChild(localName);

  // ---- Screen share box ----
  const screenBox = document.createElement("div");
  screenBox.className = "call-participant";
  const screenVideo = document.createElement("video");
  screenVideo.autoplay = true;
  screenVideo.muted = true;
  screenVideo.playsInline = true;
  screenBox.appendChild(screenVideo);
  const screenBar = document.createElement("div");
  screenBar.className = "call-participant-bar";
  const screenLabel = document.createElement("span");
  screenLabel.textContent = "Your screen";
  screenBar.appendChild(screenLabel);
  screenBox.appendChild(screenBar);

  // ---- Peer DOM tracking ----
  // Map<remotePeerId, { el, video, overlay, dot, label, reqQualityLabel, requestedQuality, closeReqMenu }>
  const peerDom = new Map();

  // ---- Session reference ----
  let session = null;
  const listeners = [];

  function on(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push({ target, event, handler });
  }

  // ---- DOM helpers ----

  function showLocalStatus(message, retryFn) {
    localStatus.hidden = false;
    localStatus.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    localStatus.appendChild(text);
    if (retryFn) {
      const btn = document.createElement("button");
      btn.className = "call-retry-btn";
      btn.textContent = "Retry";
      btn.addEventListener("click", retryFn);
      localStatus.appendChild(btn);
    }
  }

  function hideLocalStatus() {
    localStatus.hidden = true;
    localStatus.innerHTML = "";
  }

  function createStatusOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "call-status-overlay";
    overlay.hidden = true;
    const textEl = document.createElement("span");
    textEl.className = "call-status-text";
    overlay.appendChild(textEl);
    return overlay;
  }

  function createStatusDot() {
    const dot = document.createElement("span");
    dot.className = "call-status-dot connecting";
    return dot;
  }

  function ensurePeerDom(remotePeerId, peer) {
    if (peerDom.has(remotePeerId)) return peerDom.get(remotePeerId);

    const box = document.createElement("div");
    box.className = "call-participant";
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = peer.stream;
    box.appendChild(video);

    const overlay = createStatusOverlay();
    box.appendChild(overlay);

    const bar = document.createElement("div");
    bar.className = "call-participant-bar";
    const dot = createStatusDot();
    bar.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = peer.name;
    bar.appendChild(label);

    // Per-peer quality request button
    let requestedQuality = "high";
    const reqQualityAnchor = document.createElement("div");
    reqQualityAnchor.className = "call-quality-anchor";
    const reqQualityBtn = document.createElement("button");
    reqQualityBtn.className = "call-btn";
    reqQualityBtn.title = "Request quality from this peer";
    const reqQualityLabel = document.createElement("span");
    reqQualityLabel.className = "quality-label";
    reqQualityLabel.textContent = QUALITY_PRESETS[requestedQuality].label;
    reqQualityBtn.appendChild(reqQualityLabel);
    reqQualityAnchor.appendChild(reqQualityBtn);

    let reqMenuOpen = false;
    let reqMenu = null;

    function closeReqMenu() {
      if (reqMenu) {
        reqMenu.remove();
        reqMenu = null;
      }
      reqMenuOpen = false;
    }

    reqQualityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (reqMenuOpen) {
        closeReqMenu();
        return;
      }
      reqMenu = createQualityMenu(requestedQuality, (level) => {
        requestedQuality = level;
        reqQualityLabel.textContent = QUALITY_PRESETS[level].label;
        closeReqMenu();
        session.requestPeerQuality(remotePeerId, level);
      });
      reqQualityAnchor.appendChild(reqMenu);
      reqMenuOpen = true;
    });

    on(document, "pointerdown", (e) => {
      if (reqMenuOpen && !reqQualityAnchor.contains(e.target)) {
        closeReqMenu();
      }
    });

    bar.appendChild(reqQualityAnchor);
    box.appendChild(bar);

    // Sending quality badge (bottom-right)
    const sendingBadge = document.createElement("span");
    sendingBadge.className = "call-sending-quality";
    sendingBadge.hidden = true;
    box.appendChild(sendingBadge);

    // Update state based on current connection state
    if (peer.connectionState === "connected") {
      dot.className = "call-status-dot connected";
      overlay.hidden = true;
    } else if (peer.connectionState === "failed") {
      dot.className = "call-status-dot failed";
    }

    // Show initial sending quality if known
    if (peer.sendingQuality) {
      sendingBadge.textContent = `Sending ${QUALITY_PRESETS[peer.sendingQuality]?.label || peer.sendingQuality}`;
      sendingBadge.hidden = false;
    }

    const entry = { el: box, video, overlay, dot, label, reqQualityLabel, requestedQuality, closeReqMenu, sendingBadge };
    peerDom.set(remotePeerId, entry);
    grid.appendChild(box);
    return entry;
  }

  function removePeerDom(remotePeerId) {
    const dom = peerDom.get(remotePeerId);
    if (!dom) return;
    dom.el.remove();
    peerDom.delete(remotePeerId);
  }

  function updateGrid() {
    if (!session) return;
    const count = 1 + session.peers.size + (session.screenStream ? 1 : 0);
    grid.setAttribute("data-count", String(Math.min(count, 9)));

    const all = [
      { name: session.myName, el: localBox },
      ...[...session.peers.entries()].map(([id, p]) => {
        const dom = ensurePeerDom(id, p);
        return { name: p.name, el: dom.el };
      }),
    ];
    all.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    for (const { el } of all) {
      grid.appendChild(el);
    }

    // Screen share box
    if (session.screenStream) {
      screenVideo.srcObject = session.screenStream;
      grid.appendChild(screenBox);
    } else {
      screenBox.remove();
      screenVideo.srcObject = null;
    }
  }

  // ---- Buttons (wired to session) ----

  const camBtn = document.createElement("button");
  camBtn.className = "call-btn";
  camBtn.textContent = "\u{1F4F7}";
  camBtn.addEventListener("click", () => {
    if (!session) return;
    session.toggleCamera();
  });

  const micBtn = document.createElement("button");
  micBtn.className = "call-btn";
  micBtn.textContent = "\u{1F3A4}";
  micBtn.addEventListener("click", () => {
    if (!session) return;
    session.toggleMic();
  });

  const screenBtn = document.createElement("button");
  screenBtn.className = "call-btn";
  screenBtn.textContent = "\u{1F5A5}";
  screenBtn.title = "Share screen";
  screenBtn.addEventListener("click", () => {
    if (!session) return;
    session.toggleScreenShare();
  });

  const renegotiateBtn = document.createElement("button");
  renegotiateBtn.className = "call-btn";
  renegotiateBtn.textContent = "\u{1F504}";
  renegotiateBtn.title = "Renegotiate connections";
  renegotiateBtn.addEventListener("click", () => {
    if (!session) return;
    session.renegotiateAll();
  });

  const hangUpBtn = document.createElement("button");
  hangUpBtn.className = "call-btn off";
  hangUpBtn.textContent = "\u{1F4DE}";
  hangUpBtn.title = "Hang up";
  hangUpBtn.style.background = "#dc2626";
  hangUpBtn.addEventListener("click", () => {
    if (!session) return;
    session.leave();
  });

  // Quality button
  const qualityAnchor = document.createElement("div");
  qualityAnchor.className = "call-quality-anchor";
  const qualityBtn = document.createElement("button");
  qualityBtn.className = "call-btn";
  qualityBtn.title = "Sending quality";
  const qualityLabel = document.createElement("span");
  qualityLabel.className = "quality-label";
  qualityLabel.textContent = QUALITY_PRESETS["high"].label;
  qualityBtn.appendChild(qualityLabel);
  qualityAnchor.appendChild(qualityBtn);

  let qualityMenuOpen = false;
  let qualityMenu = null;

  function closeQualityMenu() {
    if (qualityMenu) {
      qualityMenu.remove();
      qualityMenu = null;
    }
    qualityMenuOpen = false;
  }

  qualityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!session) return;
    if (qualityMenuOpen) {
      closeQualityMenu();
      return;
    }
    qualityMenu = createQualityMenu(session.sendQuality, async (level) => {
      closeQualityMenu();
      await session.setQuality(level);
    });
    qualityAnchor.appendChild(qualityMenu);
    qualityMenuOpen = true;
  });

  on(document, "pointerdown", (e) => {
    if (qualityMenuOpen && !qualityAnchor.contains(e.target)) {
      closeQualityMenu();
    }
  });

  // Teleprint (transcript) toggle button
  const teleprintBtn = document.createElement("button");
  teleprintBtn.className = "call-btn";
  teleprintBtn.textContent = "\u{1F4DD}";
  teleprintBtn.title = "Toggle transcript";

  let teleprintPanel = null;

  teleprintBtn.addEventListener("click", () => {
    if (teleprintPanel) {
      teleprintPanel.remove();
      teleprintPanel = null;
      teleprintBtn.className = "call-btn";
    } else {
      teleprintPanel = document.createElement("div");
      teleprintPanel.className = "call-teleprint-panel";
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", handle.url);
      view.setAttribute("tool-id", "teleprint");
      teleprintPanel.appendChild(view);
      container.appendChild(teleprintPanel);
      teleprintBtn.className = "call-btn off";
    }
  });

  localBar.appendChild(camBtn);
  localBar.appendChild(micBtn);
  localBar.appendChild(screenBtn);
  localBar.appendChild(teleprintBtn);
  localBar.appendChild(qualityAnchor);
  localBar.appendChild(renegotiateBtn);
  localBar.appendChild(hangUpBtn);
  localBox.appendChild(localBar);

  // ---- Session event handlers ----

  function syncFromSession() {
    if (!session) return;

    localName.textContent = session.myName;
    localVideo.srcObject = session.localStream;
    camBtn.className = `call-btn${session.cameraEnabled ? "" : " off"}`;
    micBtn.className = `call-btn${session.micEnabled ? "" : " off"}`;
    screenBtn.className = `call-btn${session.screenStream ? " off" : ""}`;
    qualityLabel.textContent = QUALITY_PRESETS[session.sendQuality].label;

    // Sync peers: add missing DOM, remove stale
    const sessionPeerIds = new Set(session.peers.keys());
    for (const [id] of peerDom) {
      if (!sessionPeerIds.has(id)) removePeerDom(id);
    }
    for (const [id, peer] of session.peers) {
      const dom = ensurePeerDom(id, peer);
      // Update stream reference
      dom.video.srcObject = peer.stream;
      dom.label.textContent = peer.name;
      // Update sending quality badge
      if (peer.sendingQuality) {
        dom.sendingBadge.textContent = `Sending ${QUALITY_PRESETS[peer.sendingQuality]?.label || peer.sendingQuality}`;
        dom.sendingBadge.hidden = false;
      } else {
        dom.sendingBadge.hidden = true;
      }
    }

    updateGrid();
  }

  function onPeersChanged() {
    syncFromSession();
  }

  function onMediaChanged() {
    syncFromSession();
  }

  function onStateChanged() {
    syncFromSession();
  }

  function onLocalStatus(e) {
    const { message, retryable } = e.detail;
    if (message) {
      showLocalStatus(message, retryable ? () => session.retryMedia() : null);
    } else {
      hideLocalStatus();
    }
  }

  function onPeerStatus(e) {
    const { peerId, message, state, retryable } = e.detail;
    const dom = peerDom.get(peerId);
    if (!dom) return;

    dom.dot.className = `call-status-dot ${state}`;

    if (message) {
      dom.overlay.hidden = false;
      dom.overlay.querySelector(".call-status-text").textContent = message;
      const oldBtn = dom.overlay.querySelector(".call-retry-btn");
      if (oldBtn) oldBtn.remove();
      if (retryable) {
        const btn = document.createElement("button");
        btn.className = "call-retry-btn";
        btn.textContent = "Reconnect";
        btn.addEventListener("click", () => session.manualReconnectPeer(peerId));
        dom.overlay.appendChild(btn);
      }
    } else {
      dom.overlay.hidden = true;
    }
  }

  function onTranscriptionStatus(e) {
    const { message } = e.detail;
    if (message) {
      loadingIndicator.style.display = "block";
      loadingIndicator.textContent = message;
    } else {
      loadingIndicator.style.display = "none";
    }
  }

  function onDestroyed() {
    // Session was destroyed (hang up). Clean up our view.
    for (const [id] of peerDom) removePeerDom(id);
    session = null;
    // Show lobby again
    showLobby();
  }

  function bindSession(s) {
    session = s;
    on(session, "peers-changed", onPeersChanged);
    on(session, "media-changed", onMediaChanged);
    on(session, "state-changed", onStateChanged);
    on(session, "local-status", onLocalStatus);
    on(session, "peer-status", onPeerStatus);
    on(session, "transcription-status", onTranscriptionStatus);
    on(session, "destroyed", onDestroyed);
  }

  // ---- Lobby ----

  let lobbyEl = null;
  let lobbyStream = null;

  function showLobby() {
    const lobby = document.createElement("div");
    lobby.className = "call-lobby";
    lobbyEl = lobby;

    const lobbyPreview = document.createElement("div");
    lobbyPreview.className = "call-lobby-preview";
    const lobbyVideo = document.createElement("video");
    lobbyVideo.autoplay = true;
    lobbyVideo.muted = true;
    lobbyVideo.playsInline = true;
    lobbyPreview.appendChild(lobbyVideo);
    lobby.appendChild(lobbyPreview);

    const lobbyNameEl = document.createElement("div");
    lobbyNameEl.className = "call-lobby-name";
    lobbyNameEl.textContent = "Loading\u2026";
    lobby.appendChild(lobbyNameEl);

    const lobbyControls = document.createElement("div");
    lobbyControls.className = "call-lobby-controls";

    let lobbyCameraOn = true;
    let lobbyMicOn = true;

    const lobbyCamBtn = document.createElement("button");
    lobbyCamBtn.className = "call-lobby-toggle";
    lobbyCamBtn.textContent = "\u{1F4F7}";
    lobbyCamBtn.title = "Toggle camera";
    lobbyCamBtn.addEventListener("click", () => {
      if (!lobbyStream) return;
      lobbyCameraOn = !lobbyCameraOn;
      for (const track of lobbyStream.getVideoTracks()) {
        track.enabled = lobbyCameraOn;
      }
      lobbyCamBtn.className = `call-lobby-toggle${lobbyCameraOn ? "" : " off"}`;
    });

    const lobbyMicBtn = document.createElement("button");
    lobbyMicBtn.className = "call-lobby-toggle";
    lobbyMicBtn.textContent = "\u{1F3A4}";
    lobbyMicBtn.title = "Toggle microphone";
    lobbyMicBtn.addEventListener("click", () => {
      if (!lobbyStream) return;
      lobbyMicOn = !lobbyMicOn;
      for (const track of lobbyStream.getAudioTracks()) {
        track.enabled = lobbyMicOn;
      }
      lobbyMicBtn.className = `call-lobby-toggle${lobbyMicOn ? "" : " off"}`;
    });

    let lobbyQuality = "high";
    const lobbyQualityAnchor = document.createElement("div");
    lobbyQualityAnchor.className = "call-quality-anchor";
    const lobbyQualityBtn = document.createElement("button");
    lobbyQualityBtn.className = "call-lobby-toggle";
    lobbyQualityBtn.title = "Sending quality";
    const lobbyQualityLabel = document.createElement("span");
    lobbyQualityLabel.className = "lobby-quality-label";
    lobbyQualityLabel.textContent = QUALITY_PRESETS["high"].label;
    lobbyQualityBtn.appendChild(lobbyQualityLabel);
    lobbyQualityAnchor.appendChild(lobbyQualityBtn);

    let lobbyQualityMenuOpen = false;
    let lobbyQualityMenu = null;

    function closeLobbyQualityMenu() {
      if (lobbyQualityMenu) {
        lobbyQualityMenu.remove();
        lobbyQualityMenu = null;
      }
      lobbyQualityMenuOpen = false;
    }

    lobbyQualityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (lobbyQualityMenuOpen) {
        closeLobbyQualityMenu();
        return;
      }
      lobbyQualityMenu = createQualityMenu(lobbyQuality, (level) => {
        closeLobbyQualityMenu();
        lobbyQuality = level;
        lobbyQualityLabel.textContent = QUALITY_PRESETS[level].label;
      });
      lobbyQualityAnchor.appendChild(lobbyQualityMenu);
      lobbyQualityMenuOpen = true;
    });

    on(document, "pointerdown", (e) => {
      if (lobbyQualityMenuOpen && !lobbyQualityAnchor.contains(e.target)) {
        closeLobbyQualityMenu();
      }
    });

    lobbyControls.appendChild(lobbyCamBtn);
    lobbyControls.appendChild(lobbyMicBtn);
    lobbyControls.appendChild(lobbyQualityAnchor);
    lobby.appendChild(lobbyControls);

    const lobbyError = document.createElement("div");
    lobbyError.className = "call-lobby-error";
    lobbyError.hidden = true;
    lobby.appendChild(lobbyError);

    const joinBtn = document.createElement("button");
    joinBtn.className = "call-lobby-join";
    joinBtn.textContent = "Join Call";
    joinBtn.addEventListener("click", async () => {
      // Stop lobby preview stream — the session will acquire its own
      if (lobbyStream) {
        for (const track of lobbyStream.getTracks()) track.stop();
        lobbyStream = null;
      }
      lobby.remove();
      lobbyEl = null;

      const s = createCallSession(handle, element.repo || repo);
      // Transfer lobby toggle state to session before joining
      s.cameraEnabled = lobbyCameraOn;
      s.micEnabled = lobbyMicOn;
      s.sendQuality = lobbyQuality;
      bindSession(s);
      await s.joinCall();
      enterCallView();
    });
    lobby.appendChild(joinBtn);

    container.appendChild(lobby);

    // Setup lobby preview
    (async () => {
      // Resolve name for display
      try {
        const contactHandle = await repo.find(
          window.accountDocHandle.doc().contactUrl
        );
        const name = contactHandle.doc().name;
        if (name) lobbyNameEl.textContent = `Joining as ${name}`;
      } catch { }

      // Preview media
      try {
        lobbyStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        try {
          lobbyStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          try {
            lobbyStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          } catch { }
        }
      }
      if (lobbyStream) {
        lobbyVideo.srcObject = lobbyStream;
      } else {
        lobbyError.hidden = false;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const hasCam = devices.some((d) => d.kind === "videoinput");
          const hasMic = devices.some((d) => d.kind === "audioinput");
          if (!hasCam && !hasMic) lobbyError.textContent = "No camera or microphone found";
          else if (!hasCam) lobbyError.textContent = "No camera found";
          else if (!hasMic) lobbyError.textContent = "No microphone found";
          else lobbyError.textContent = "Camera/mic may be in use by another app";
        } catch {
          lobbyError.textContent = "Could not access media devices";
        }
      }
    })();
  }

  function enterCallView() {
    if (!session) return;
    localVideo.srcObject = session.localStream;
    localName.textContent = session.myName;
    grid.appendChild(localBox);
    syncFromSession();
  }

  // ---- Initialize ----

  async function init() {
    // Check for existing session for this call
    const existing = getCallSession();
    if (existing && existing.callUrl === handle.url && !existing.destroyed) {
      if (existing.joined) {
        // Already in call — skip lobby, render grid immediately
        bindSession(existing);
        enterCallView();
        return;
      }
    }

    // Check cross-tab
    const inOtherTab = await CallSession.isActiveInAnotherTab(handle.url);
    if (inOtherTab) {
      showOtherTabMessage();
      return;
    }

    showLobby();
  }

  function showOtherTabMessage() {
    const otherTab = document.createElement("div");
    otherTab.className = "call-other-tab";

    const msg = document.createElement("div");
    msg.className = "call-other-tab-msg";
    msg.textContent = "You're in this call in another tab";
    otherTab.appendChild(msg);

    const takeOverBtn = document.createElement("button");
    takeOverBtn.textContent = "Take over";
    takeOverBtn.addEventListener("click", () => {
      otherTab.remove();
      showLobby();
    });
    otherTab.appendChild(takeOverBtn);

    container.appendChild(otherTab);
  }

  init();

  // ---- Cleanup ----
  return () => {
    viewDestroyed = true;

    // Remove all event listeners
    for (const { target, event, handler } of listeners) {
      target.removeEventListener(event, handler);
    }
    listeners.length = 0;

    // Stop lobby preview stream if still active
    if (lobbyStream) {
      for (const track of lobbyStream.getTracks()) track.stop();
      lobbyStream = null;
    }

    // Remove teleprint panel
    if (teleprintPanel) {
      teleprintPanel.remove();
      teleprintPanel = null;
    }

    // Remove DOM
    for (const [id] of peerDom) removePeerDom(id);
    peerDom.clear();

    container.remove();
    style.remove();

    // Do NOT call session.leave() — session persists for the titlebar
  };
}
