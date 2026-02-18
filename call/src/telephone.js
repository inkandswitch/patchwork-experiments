/**
 * Telephone — WebRTC video call with local Whisper transcription.
 *
 * Each participant's voice is transcribed locally using WebGPU-accelerated
 * Whisper and written into doc.content as `<name> text\n` lines.
 *
 * Uses the "perfect negotiation" pattern for glare-free WebRTC signaling,
 * with automatic ICE restart, exponential backoff reconnection, graceful
 * media device fallback, and user-visible connection status.
 */

import { next as Automerge } from "@automerge/automerge";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:sync3.automerge.org:3478",
      username: "user",
      credential: "password",
    },
  ],
};

// How long to wait in "disconnected" before treating it as gone
const DISCONNECT_TIMEOUT_MS = 8000;
// Reconnection backoff
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
// Heartbeat
const HEARTBEAT_MS = 5000;
// How long since last heartbeat before we consider a peer gone
const PEER_TIMEOUT_MS = 20000;

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
  `;
  return style;
}

export default function TelephoneTool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  const peerId = crypto.randomUUID();
  let localStream = null;
  let cameraEnabled = true;
  let micEnabled = true;
  let destroyed = false;
  let summaryWorker = null;

  // Map of remotePeerId -> peer object
  const peers = new Map();

  // DOM
  const container = document.createElement("div");
  container.className = "call-container";
  container.style.position = "relative";
  element.appendChild(container);

  const grid = document.createElement("div");
  grid.className = "call-grid";
  container.appendChild(grid);

  // ---- Local status banner (media errors, retry) ----
  const localStatus = document.createElement("div");
  localStatus.className = "call-local-status";
  localStatus.hidden = true;
  container.appendChild(localStatus);

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

  const camBtn = document.createElement("button");
  camBtn.className = "call-btn";
  camBtn.textContent = "\u{1F4F7}";
  camBtn.addEventListener("click", () => {
    if (!localStream) return;
    cameraEnabled = !cameraEnabled;
    for (const track of localStream.getVideoTracks()) {
      track.enabled = cameraEnabled;
    }
    camBtn.className = `call-btn${cameraEnabled ? "" : " off"}`;
  });

  const micBtn = document.createElement("button");
  micBtn.className = "call-btn";
  micBtn.textContent = "\u{1F3A4}";
  micBtn.addEventListener("click", () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    for (const track of localStream.getAudioTracks()) {
      track.enabled = micEnabled;
    }
    micBtn.className = `call-btn${micEnabled ? "" : " off"}`;
  });

  const renegotiateBtn = document.createElement("button");
  renegotiateBtn.className = "call-btn";
  renegotiateBtn.textContent = "\u{1F504}";
  renegotiateBtn.title = "Renegotiate connections";
  renegotiateBtn.addEventListener("click", () => {
    console.log("[call] Renegotiating with all peers");
    for (const [id, peer] of peers) {
      try {
        peer.pc.restartIce();
        console.log(`[call] ICE restart triggered for ${id}`);
      } catch (err) {
        console.warn(`[call] ICE restart failed for ${id}:`, err);
      }
    }
    broadcast({ type: "join", from: peerId, name: myName });
  });

  const summarizeBtn = document.createElement("button");
  summarizeBtn.className = "call-btn";
  summarizeBtn.textContent = "\u{1F4DD}";
  summarizeBtn.title = "Summarize transcript";
  summarizeBtn.addEventListener("click", () => {
    const content = handle.doc()?.content;
    if (!content || content.trim().length === 0) {
      loadingIndicator.style.display = "block";
      loadingIndicator.textContent = "No transcript to summarize";
      setTimeout(() => {
        loadingIndicator.style.display = "none";
      }, 2000);
      return;
    }

    if (!summaryWorker) {
      const workerUrl = new URL("./summary-worker.js", import.meta.url);
      summaryWorker = new Worker(workerUrl, { type: "module" });

      summaryWorker.onmessage = (e) => {
        const { type, message, summary } = e.data;
        if (type === "status") {
          loadingIndicator.style.display = "block";
          loadingIndicator.textContent = message;
        } else if (type === "ready") {
          loadingIndicator.style.display = "none";
        } else if (type === "result") {
          loadingIndicator.style.display = "none";
          handle.change((doc) => {
            const text = `\n--- Summary ---\n${summary}\n`;
            Automerge.splice(doc, ["content"], doc.content.length, 0, text);
          });
        }
      };
    }

    loadingIndicator.style.display = "block";
    loadingIndicator.textContent = "Summarizing…";
    summaryWorker.postMessage({ type: "summarize", text: content });
  });

  localBar.appendChild(camBtn);
  localBar.appendChild(micBtn);
  localBar.appendChild(renegotiateBtn);
  localBar.appendChild(summarizeBtn);
  localBox.appendChild(localBar);

  // ---- Grid layout ----
  function updateGrid() {
    const count = 1 + peers.size;
    grid.setAttribute("data-count", String(Math.min(count, 9)));

    const all = [
      { name: myName, el: localBox },
      ...[...peers.values()].map((p) => ({ name: p.name, el: p.el })),
    ];
    all.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    for (const { el } of all) {
      grid.appendChild(el);
    }
  }

  // ---- Media acquisition with graceful fallback ----
  async function acquireMedia() {
    // Try video + audio
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      hideLocalStatus();
      return stream;
    } catch (err) {
      console.warn("[call] Could not get video+audio:", err.name, err.message);
    }

    // Try audio only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });
      showLocalStatus("Camera unavailable — audio only", retryMedia);
      return stream;
    } catch (err) {
      console.warn("[call] Could not get audio:", err.name, err.message);
    }

    // Try video only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      showLocalStatus("Microphone unavailable — video only", retryMedia);
      return stream;
    } catch (err) {
      console.warn("[call] Could not get video:", err.name, err.message);
    }

    // Nothing available
    const reason = await describeMediaError();
    showLocalStatus(reason, retryMedia);
    return null;
  }

  async function describeMediaError() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCam = devices.some((d) => d.kind === "videoinput");
      const hasMic = devices.some((d) => d.kind === "audioinput");
      if (!hasCam && !hasMic) return "No camera or microphone found";
      if (!hasCam) return "No camera found";
      if (!hasMic) return "No microphone found";
      return "Camera/mic may be in use by another app";
    } catch {
      return "Could not access media devices";
    }
  }

  async function retryMedia() {
    const stream = await acquireMedia();
    if (!stream) return;

    // Stop old tracks
    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
    }
    localStream = stream;
    localVideo.srcObject = localStream;

    // Replace tracks on all existing peer connections
    replaceTracksOnAllPeers();

    // Restart transcription with new audio
    stopTranscription();
    startTranscription();
  }

  function replaceTracksOnAllPeers() {
    if (!localStream) return;
    for (const [, peer] of peers) {
      const senders = peer.pc.getSenders();
      for (const track of localStream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch((err) => {
            console.warn("[call] replaceTrack failed:", err);
          });
        } else {
          try {
            peer.pc.addTrack(track, localStream);
          } catch (err) {
            console.warn("[call] addTrack failed:", err);
          }
        }
      }
    }
  }

  // ---- Status overlay for remote peers ----
  function createStatusOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "call-status-overlay";
    overlay.hidden = true;
    const textEl = document.createElement("span");
    textEl.className = "call-status-text";
    overlay.appendChild(textEl);
    return overlay;
  }

  function showPeerStatus(peer, message, retryFn) {
    peer.overlay.hidden = false;
    const textEl = peer.overlay.querySelector(".call-status-text");
    textEl.textContent = message;
    // Remove old retry button if present
    const oldBtn = peer.overlay.querySelector(".call-retry-btn");
    if (oldBtn) oldBtn.remove();
    if (retryFn) {
      const btn = document.createElement("button");
      btn.className = "call-retry-btn";
      btn.textContent = "Reconnect";
      btn.addEventListener("click", retryFn);
      peer.overlay.appendChild(btn);
    }
  }

  function hidePeerStatus(peer) {
    peer.overlay.hidden = true;
  }

  function createStatusDot() {
    const dot = document.createElement("span");
    dot.className = "call-status-dot connecting";
    return dot;
  }

  function updatePeerDot(peer, state) {
    peer.dot.className = `call-status-dot ${state}`;
  }

  // ---- Create peer connection ----
  // "Perfect negotiation" roles: the peer with the higher ID is "impolite"
  function isPolite(remotePeerId) {
    return peerId < remotePeerId;
  }

  function createPeerConnection(remotePeerId) {
    if (peers.has(remotePeerId)) return peers.get(remotePeerId);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const polite = isPolite(remotePeerId);

    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    // Build DOM for remote participant
    const box = document.createElement("div");
    box.className = "call-participant";
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    box.appendChild(video);

    const overlay = createStatusOverlay();
    box.appendChild(overlay);

    const bar = document.createElement("div");
    bar.className = "call-participant-bar";
    const dot = createStatusDot();
    bar.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = remotePeerId.slice(0, 8);
    bar.appendChild(label);
    box.appendChild(bar);

    const remoteStream = new MediaStream();
    video.srcObject = remoteStream;

    pc.ontrack = (event) => {
      // Avoid duplicate tracks
      if (!remoteStream.getTrackById(event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        broadcast({
          type: "ice-candidate",
          from: peerId,
          to: remotePeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // ---- Perfect negotiation: onnegotiationneeded ----
    let makingOffer = false;
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        broadcast({
          type: "offer",
          from: peerId,
          to: remotePeerId,
          sdp: pc.localDescription.toJSON(),
        });
      } catch (err) {
        console.warn("[call] negotiationneeded error:", err);
      } finally {
        makingOffer = false;
      }
    };

    // ---- Connection state: visual feedback + disconnect timeout ----
    let disconnectTimer = null;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }

      switch (state) {
        case "connecting":
        case "new":
          updatePeerDot(peer, "connecting");
          showPeerStatus(peer, "Connecting\u2026");
          break;
        case "connected":
          updatePeerDot(peer, "connected");
          hidePeerStatus(peer);
          peer.reconnectAttempts = 0;
          break;
        case "disconnected":
          updatePeerDot(peer, "reconnecting");
          showPeerStatus(peer, "Connection interrupted\u2026");
          // Give it time — transient disconnects are normal
          disconnectTimer = setTimeout(() => {
            if (pc.connectionState === "disconnected") {
              attemptReconnect(remotePeerId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          break;
        case "failed":
          updatePeerDot(peer, "failed");
          attemptReconnect(remotePeerId);
          break;
        case "closed":
          removePeer(remotePeerId);
          break;
      }
    };

    // ---- ICE connection: restart on failure ----
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        console.warn(`[call] ICE failed for ${remotePeerId}, restarting`);
        try {
          pc.restartIce();
        } catch (err) {
          console.warn("[call] ICE restart failed:", err);
        }
      }
    };

    const peer = {
      pc,
      polite,
      makingOffer: () => makingOffer,
      stream: remoteStream,
      el: box,
      video,
      name: remotePeerId.slice(0, 8),
      label,
      dot,
      overlay,
      pendingCandidates: [],
      reconnectAttempts: 0,
      lastHeartbeat: Date.now(),
    };
    peers.set(remotePeerId, peer);

    showPeerStatus(peer, "Connecting\u2026");
    grid.appendChild(box);
    updateGrid();

    return peer;
  }

  // ---- Reconnection with exponential backoff ----
  function attemptReconnect(remotePeerId) {
    const peer = peers.get(remotePeerId);
    if (!peer || destroyed) return;

    peer.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, peer.reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );

    if (peer.reconnectAttempts <= 5) {
      updatePeerDot(peer, "reconnecting");
      showPeerStatus(
        peer,
        `Reconnecting (attempt ${peer.reconnectAttempts})\u2026`
      );
      console.warn(
        `[call] Reconnecting to ${remotePeerId} in ${delay}ms (attempt ${peer.reconnectAttempts})`
      );

      setTimeout(() => {
        if (destroyed || !peers.has(remotePeerId)) return;
        reconnectPeer(remotePeerId);
      }, delay);
    } else {
      updatePeerDot(peer, "failed");
      showPeerStatus(peer, "Connection lost", () => {
        peer.reconnectAttempts = 0;
        reconnectPeer(remotePeerId);
      });
    }
  }

  function reconnectPeer(remotePeerId) {
    const oldPeer = peers.get(remotePeerId);
    if (!oldPeer) return;

    // Preserve UI state
    const name = oldPeer.name;
    const reconnectAttempts = oldPeer.reconnectAttempts;

    // Tear down old PC, but keep the DOM element
    try { oldPeer.pc.close(); } catch {}

    // Create fresh PC and reuse the existing DOM
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const polite = isPolite(remotePeerId);

    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    const remoteStream = new MediaStream();
    oldPeer.video.srcObject = remoteStream;

    pc.ontrack = (event) => {
      if (!remoteStream.getTrackById(event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        broadcast({
          type: "ice-candidate",
          from: peerId,
          to: remotePeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    let makingOffer = false;
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        broadcast({
          type: "offer",
          from: peerId,
          to: remotePeerId,
          sdp: pc.localDescription.toJSON(),
        });
      } catch (err) {
        console.warn("[call] negotiationneeded error:", err);
      } finally {
        makingOffer = false;
      }
    };

    let disconnectTimer = null;
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      switch (state) {
        case "connecting":
        case "new":
          updatePeerDot(oldPeer, "connecting");
          showPeerStatus(oldPeer, "Connecting\u2026");
          break;
        case "connected":
          updatePeerDot(oldPeer, "connected");
          hidePeerStatus(oldPeer);
          oldPeer.reconnectAttempts = 0;
          break;
        case "disconnected":
          updatePeerDot(oldPeer, "reconnecting");
          showPeerStatus(oldPeer, "Connection interrupted\u2026");
          disconnectTimer = setTimeout(() => {
            if (pc.connectionState === "disconnected") {
              attemptReconnect(remotePeerId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          break;
        case "failed":
          updatePeerDot(oldPeer, "failed");
          attemptReconnect(remotePeerId);
          break;
        case "closed":
          removePeer(remotePeerId);
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch {}
      }
    };

    // Update the peer entry in-place
    oldPeer.pc = pc;
    oldPeer.polite = polite;
    oldPeer.makingOffer = () => makingOffer;
    oldPeer.stream = remoteStream;
    oldPeer.pendingCandidates = [];
    oldPeer.reconnectAttempts = reconnectAttempts;

    // Send a join to trigger the remote side to send an offer
    broadcast({ type: "join", from: peerId, name: myName });
  }

  function removePeer(remotePeerId) {
    const peer = peers.get(remotePeerId);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    peer.el.remove();
    peers.delete(remotePeerId);
    updateGrid();
  }

  // ---- Signaling over broadcast ----
  function broadcast(msg) {
    handle.broadcast(msg);
  }

  async function flushCandidates(peer) {
    if (peer.pendingCandidates.length === 0) return;
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("[call] Error flushing ICE candidate:", err);
      }
    }
  }

  // ---- Perfect negotiation signal handler ----
  async function handleSignal(msg) {
    if (msg.from === peerId) return;
    if (msg.to && msg.to !== peerId) return;

    switch (msg.type) {
      case "join": {
        const existing = peers.get(msg.from);
        if (existing) {
          existing.lastHeartbeat = Date.now();
          if (msg.name) {
            existing.name = msg.name;
            existing.label.textContent = msg.name;
            updateGrid();
          }
          // If we have a stable connection already, just send our name back
          if (
            existing.pc.connectionState === "connected" ||
            existing.pc.signalingState !== "stable"
          ) {
            broadcast({ type: "name", from: peerId, name: myName });
            break;
          }
        }
        const peer = createPeerConnection(msg.from);
        peer.lastHeartbeat = Date.now();
        if (msg.name) {
          peer.name = msg.name;
          peer.label.textContent = msg.name;
          updateGrid();
        }
        // The onnegotiationneeded handler will fire from addTrack and send the offer
        // But if we have no local stream, we need to create an offer manually
        if (!localStream) {
          try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            broadcast({
              type: "offer",
              from: peerId,
              to: msg.from,
              sdp: peer.pc.localDescription.toJSON(),
            });
          } catch (err) {
            console.warn("[call] Error creating offer:", err);
          }
        }
        broadcast({ type: "name", from: peerId, name: myName });
        break;
      }

      case "offer": {
        const peer = createPeerConnection(msg.from);
        try {
          const offerCollision =
            peer.makingOffer() || peer.pc.signalingState !== "stable";

          if (offerCollision) {
            if (!peer.polite) {
              // Impolite peer ignores incoming offer during collision
              break;
            }
            // Polite peer rolls back and accepts
          }

          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(msg.sdp)
          );
          await flushCandidates(peer);
          await peer.pc.setLocalDescription();
          broadcast({
            type: "answer",
            from: peerId,
            to: msg.from,
            sdp: peer.pc.localDescription.toJSON(),
          });
        } catch (err) {
          console.warn("[call] Error handling offer:", err);
        }
        break;
      }

      case "answer": {
        const peer = peers.get(msg.from);
        if (!peer) break;
        try {
          if (peer.pc.signalingState !== "have-local-offer") {
            // Stale answer — ignore
            break;
          }
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(msg.sdp)
          );
          await flushCandidates(peer);
        } catch (err) {
          console.warn("[call] Error handling answer:", err);
        }
        break;
      }

      case "ice-candidate": {
        const peer = peers.get(msg.from);
        if (!peer) break;
        try {
          if (!peer.pc.remoteDescription) {
            peer.pendingCandidates.push(msg.candidate);
          } else {
            await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
        } catch (err) {
          // Non-fatal — candidates can arrive for old sessions
          if (!err.message?.includes("location information")) {
            console.warn("[call] Error adding ICE candidate:", err);
          }
        }
        break;
      }

      case "name": {
        const peer = peers.get(msg.from);
        if (peer && msg.name) {
          peer.name = msg.name;
          peer.label.textContent = msg.name;
          updateGrid();
        }
        break;
      }

      case "leave": {
        removePeer(msg.from);
        break;
      }
    }
  }

  function onEphemeral(payload) {
    const msg = payload.message;
    if (msg && msg.type) {
      handleSignal(msg);
    }
  }
  handle.on("ephemeral-message", onEphemeral);

  // ---- Peer liveness: remove peers that stop sending heartbeats ----
  const livenessInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, peer] of peers) {
      if (now - peer.lastHeartbeat > PEER_TIMEOUT_MS) {
        console.warn(`[call] Peer ${id} timed out (no heartbeat)`);
        removePeer(id);
      }
    }
  }, PEER_TIMEOUT_MS / 2);

  // ============================================================================
  // Transcription
  // ============================================================================

  let whisperWorker = null;
  let audioContext = null;
  let scriptProcessor = null;
  let audioBuffer = [];
  let audioBufferLength = 0;
  let sendInterval = null;
  let myName = "unknown";
  const SEND_INTERVAL_MS = 5000;
  const WHISPER_SAMPLE_RATE = 16000;

  const loadingIndicator = document.createElement("div");
  loadingIndicator.style.cssText =
    "position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);" +
    "color:white;padding:4px 10px;border-radius:6px;font-size:12px;" +
    "font-family:system-ui,sans-serif;z-index:10;display:none;";
  container.appendChild(loadingIndicator);

  async function resolveMyName() {
    try {
      const contactHandle = await repo.find(
        window.accountDocHandle.doc().contactUrl
      );
      const name = contactHandle.doc().name;
      if (name) {
        myName = name;
        localName.textContent = myName;
      }
    } catch (err) {
      console.warn("[call] Could not resolve name:", err);
    }
  }

  function resample(inputSamples, inputRate, outputRate) {
    if (inputRate === outputRate) return inputSamples;
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(inputSamples.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const low = Math.floor(srcIndex);
      const high = Math.min(low + 1, inputSamples.length - 1);
      const frac = srcIndex - low;
      output[i] = inputSamples[low] * (1 - frac) + inputSamples[high] * frac;
    }
    return output;
  }

  function sendAudioToWorker() {
    if (!whisperWorker || audioBufferLength === 0) return;

    const fullBuffer = new Float32Array(audioBufferLength);
    let offset = 0;
    for (const chunk of audioBuffer) {
      fullBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    audioBuffer = [];
    audioBufferLength = 0;

    const resampled = resample(
      fullBuffer,
      audioContext.sampleRate,
      WHISPER_SAMPLE_RATE
    );

    whisperWorker.postMessage(
      { type: "transcribe", audio: resampled },
      [resampled.buffer]
    );
  }

  function stopTranscription() {
    if (sendInterval) {
      clearInterval(sendInterval);
      sendInterval = null;
    }
    if (whisperWorker) {
      whisperWorker.terminate();
      whisperWorker = null;
    }
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    audioBuffer = [];
    audioBufferLength = 0;
  }

  function startTranscription() {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    const workerUrl = new URL("./worker.js", import.meta.url);
    whisperWorker = new Worker(workerUrl, { type: "module" });

    whisperWorker.onmessage = (e) => {
      const { type, text, message } = e.data;

      if (type === "status") {
        loadingIndicator.style.display = "block";
        loadingIndicator.textContent = message;
      } else if (type === "ready") {
        loadingIndicator.style.display = "none";
      } else if (type === "result") {
        handle.change((doc) => {
          const line = `<${myName}> ${text}\n`;
          Automerge.splice(doc, ["content"], doc.content.length, 0, line);
        });
      }
    };

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([audioTrack])
    );
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (e) => {
      if (!micEnabled) return;
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      audioBuffer.push(copy);
      audioBufferLength += copy.length;
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    sendInterval = setInterval(sendAudioToWorker, SEND_INTERVAL_MS);
  }

  // ---- Listen for device changes (e.g. camera unplugged/plugged) ----
  function onDeviceChange() {
    if (destroyed) return;
    if (!localStream) {
      // We had no media before — maybe a device just appeared
      retryMedia();
      return;
    }
    // Check if our tracks are still live
    const dead = localStream.getTracks().some((t) => t.readyState === "ended");
    if (dead) {
      console.warn("[call] Media track ended, retrying");
      retryMedia();
    }
  }
  navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

  // ---- Start ----
  async function start() {
    localStream = await acquireMedia();
    if (localStream) {
      localVideo.srcObject = localStream;

      // Watch for tracks ending (device pulled, permission revoked)
      for (const track of localStream.getTracks()) {
        track.addEventListener("ended", () => {
          console.warn(`[call] Track ${track.kind} ended`);
          showLocalStatus(
            `${track.kind === "video" ? "Camera" : "Microphone"} disconnected`,
            retryMedia
          );
        });
      }
    }

    grid.appendChild(localBox);
    updateGrid();

    await resolveMyName();
    startTranscription();

    broadcast({ type: "join", from: peerId, name: myName });

    heartbeatInterval = setInterval(() => {
      if (!destroyed) {
        broadcast({ type: "join", from: peerId, name: myName });
      }
    }, HEARTBEAT_MS);
  }

  let heartbeatInterval = null;
  start();

  // ---- Cleanup ----
  return () => {
    destroyed = true;

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    clearInterval(livenessInterval);

    broadcast({ type: "leave", from: peerId });

    handle.off("ephemeral-message", onEphemeral);
    navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);

    stopTranscription();

    if (summaryWorker) {
      summaryWorker.terminate();
      summaryWorker = null;
    }

    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }

    for (const [, peer] of peers) {
      try { peer.pc.close(); } catch {}
    }
    peers.clear();

    container.remove();
    style.remove();
  };
}
