/**
 * Call - Video call tool for Patchwork
 *
 * Uses WebRTC for peer-to-peer video/audio, with signaling over
 * handle.broadcast (ephemeral messages).
 *
 * @typedef {Object} CallDoc
 * @property {string} content - Text content (unused for now)
 * @property {string} title - Document title
 */

// ============================================================================
// Datatype
// ============================================================================

export const CallDatatype = {
  init(doc) {
    doc.title = "Call";
    doc.content = "";
  },

  getTitle(doc) {
    return doc.title || "Call";
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};

// ============================================================================
// WebRTC Configuration
// ============================================================================

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ============================================================================
// Styles
// ============================================================================

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
  `;
  return style;
}

// ============================================================================
// Tool
// ============================================================================

export function Tool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  const peerId = crypto.randomUUID();
  let localStream = null;
  let cameraEnabled = true;
  let micEnabled = true;

  // Map of remotePeerId -> { pc: RTCPeerConnection, stream: MediaStream, el: HTMLElement }
  const peers = new Map();

  // DOM
  const container = document.createElement("div");
  container.className = "call-container";
  element.appendChild(container);

  const grid = document.createElement("div");
  grid.className = "call-grid";
  container.appendChild(grid);

  // Local video box
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

  localBar.appendChild(camBtn);
  localBar.appendChild(micBtn);
  localBox.appendChild(localBar);

  // ---- Grid layout ---
  function updateGrid() {
    const count = 1 + peers.size; // local + remotes
    grid.setAttribute("data-count", String(Math.min(count, 9)));

    // Ensure local box is first
    if (!grid.contains(localBox)) {
      grid.prepend(localBox);
    }
  }

  // ---- Create peer connection ----
  function createPeerConnection(remotePeerId) {
    if (peers.has(remotePeerId)) return peers.get(remotePeerId);

    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks
    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    // Remote video element
    const box = document.createElement("div");
    box.className = "call-participant";
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    box.appendChild(video);
    const bar = document.createElement("div");
    bar.className = "call-participant-bar";
    const label = document.createElement("span");
    label.textContent = remotePeerId.slice(0, 8);
    bar.appendChild(label);
    box.appendChild(bar);

    const remoteStream = new MediaStream();
    video.srcObject = remoteStream;

    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
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

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        removePeer(remotePeerId);
      }
    };

    const peer = { pc, stream: remoteStream, el: box };
    peers.set(remotePeerId, peer);
    grid.appendChild(box);
    updateGrid();

    return peer;
  }

  function removePeer(remotePeerId) {
    const peer = peers.get(remotePeerId);
    if (!peer) return;
    peer.pc.close();
    peer.el.remove();
    peers.delete(remotePeerId);
    updateGrid();
  }

  // ---- Signaling over broadcast ----
  function broadcast(msg) {
    handle.broadcast(msg);
  }

  async function handleSignal(msg) {
    // Ignore our own messages
    if (msg.from === peerId) return;
    // Ignore messages not for us (if targeted)
    if (msg.to && msg.to !== peerId) return;

    switch (msg.type) {
      case "join": {
        // A new peer joined — create a connection and send an offer
        const peer = createPeerConnection(msg.from);
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        broadcast({
          type: "offer",
          from: peerId,
          to: msg.from,
          sdp: peer.pc.localDescription.toJSON(),
        });
        break;
      }

      case "offer": {
        const peer = createPeerConnection(msg.from);
        await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        broadcast({
          type: "answer",
          from: peerId,
          to: msg.from,
          sdp: peer.pc.localDescription.toJSON(),
        });
        break;
      }

      case "answer": {
        const peer = peers.get(msg.from);
        if (peer) {
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(msg.sdp)
          );
        }
        break;
      }

      case "ice-candidate": {
        const peer = peers.get(msg.from);
        if (peer) {
          await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;
      }

      case "leave": {
        removePeer(msg.from);
        break;
      }
    }
  }

  // Listen for ephemeral messages
  function onEphemeral(payload) {
    const msg = payload.message;
    if (msg && msg.type) {
      handleSignal(msg);
    }
  }
  handle.on("ephemeral-message", onEphemeral);

  // ---- Start ----
  async function start() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localVideo.srcObject = localStream;
    } catch (err) {
      console.warn("[call] Could not get media devices:", err);
      // Still join so others can see us as a box
      localName.textContent = "You (no camera)";
    }

    grid.appendChild(localBox);
    updateGrid();

    // Announce our presence
    broadcast({ type: "join", from: peerId });

    // Periodically re-announce in case peers missed us
    heartbeatInterval = setInterval(() => {
      broadcast({ type: "join", from: peerId });
    }, 5000);
  }

  let heartbeatInterval = null;
  start();

  // ---- Cleanup ----
  return () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    // Announce departure
    broadcast({ type: "leave", from: peerId });

    handle.off("ephemeral-message", onEphemeral);

    // Stop all tracks
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }

    // Close all peer connections
    for (const [, peer] of peers) {
      peer.pc.close();
    }
    peers.clear();

    container.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "call",
    name: "Call",
    icon: "Video",
    async load() {
      return CallDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "call",
    name: "Call",
    icon: "Video",
    supportedDatatypes: ["call"],
    async load() {
      return Tool;
    },
  },
];
