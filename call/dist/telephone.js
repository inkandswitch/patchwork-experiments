// src/telephone.js
import { next as Automerge } from "@automerge/automerge";
var RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};
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
function TelephoneTool(handle, element) {
  const style = createStyles();
  element.appendChild(style);
  const peerId = crypto.randomUUID();
  let localStream = null;
  let cameraEnabled = true;
  let micEnabled = true;
  const peers = /* @__PURE__ */ new Map();
  const container = document.createElement("div");
  container.className = "call-container";
  element.appendChild(container);
  const grid = document.createElement("div");
  grid.className = "call-grid";
  container.appendChild(grid);
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
  function updateGrid() {
    const count = 1 + peers.size;
    grid.setAttribute("data-count", String(Math.min(count, 9)));
    const all = [
      { name: myName, el: localBox },
      ...[...peers.values()].map((p) => ({ name: p.name, el: p.el }))
    ];
    all.sort(
      (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    for (const { el } of all) {
      grid.appendChild(el);
    }
  }
  function createPeerConnection(remotePeerId) {
    if (peers.has(remotePeerId)) return peers.get(remotePeerId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }
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
          candidate: event.candidate.toJSON()
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        removePeer(remotePeerId);
      }
    };
    const peer = {
      pc,
      stream: remoteStream,
      el: box,
      name: remotePeerId.slice(0, 8),
      label
    };
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
  function broadcast(msg) {
    handle.broadcast(msg);
  }
  async function handleSignal(msg) {
    if (msg.from === peerId) return;
    if (msg.to && msg.to !== peerId) return;
    switch (msg.type) {
      case "join": {
        const peer = createPeerConnection(msg.from);
        if (msg.name) {
          peer.name = msg.name;
          peer.label.textContent = msg.name;
          updateGrid();
        }
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        broadcast({
          type: "offer",
          from: peerId,
          to: msg.from,
          sdp: peer.pc.localDescription.toJSON()
        });
        broadcast({ type: "name", from: peerId, name: myName });
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
          sdp: peer.pc.localDescription.toJSON()
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
  let whisperWorker = null;
  let audioContext = null;
  let scriptProcessor = null;
  let audioBuffer = [];
  let audioBufferLength = 0;
  let sendInterval = null;
  let myName = "unknown";
  const SEND_INTERVAL_MS = 5e3;
  const WHISPER_SAMPLE_RATE = 16e3;
  const loadingIndicator = document.createElement("div");
  loadingIndicator.style.cssText = "position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.7);color:white;padding:4px 10px;border-radius:6px;font-size:12px;font-family:system-ui,sans-serif;z-index:10;display:none;";
  container.style.position = "relative";
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
          const line = `<${myName}> ${text}
`;
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
  async function start() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localVideo.srcObject = localStream;
    } catch (err) {
      console.warn("[call] Could not get media devices:", err);
      localName.textContent = "You (no camera)";
    }
    grid.appendChild(localBox);
    updateGrid();
    await resolveMyName();
    startTranscription();
    broadcast({ type: "join", from: peerId, name: myName });
    heartbeatInterval = setInterval(() => {
      broadcast({ type: "join", from: peerId, name: myName });
    }, 5e3);
  }
  let heartbeatInterval = null;
  start();
  return () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (sendInterval) clearInterval(sendInterval);
    broadcast({ type: "leave", from: peerId });
    handle.off("ephemeral-message", onEphemeral);
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
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }
    for (const [, peer] of peers) {
      peer.pc.close();
    }
    peers.clear();
    container.remove();
    style.remove();
  };
}
export {
  TelephoneTool as default
};
//# sourceMappingURL=telephone.js.map
