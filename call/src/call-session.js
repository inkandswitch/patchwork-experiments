/**
 * CallSession — persistent singleton managing all WebRTC state for a call.
 *
 * Extends EventTarget so views (telephone.js, call-titlebar.js) can listen
 * for changes without owning the underlying connections.
 *
 * Events emitted:
 *   "peers-changed"   — peer added/removed, detail: { peers: Map }
 *   "media-changed"   — localStream/screenStream changed
 *   "state-changed"   — joined/camera/mic state changed
 *   "local-status"    — { message, retryable }
 *   "peer-status"     — { peerId, message, state, retryable }
 *   "destroyed"       — session ended
 */

import { next as Automerge } from "@automerge/automerge";
import { createTranscriptionStream } from "@chee/patchwork-transcript";

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

const DISCONNECT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_MS = 5000;
const PEER_TIMEOUT_MS = 20000;

export const QUALITY_PRESETS = {
  high: { label: "HD" },
  medium: { label: "SD", maxFramerate: 15, scaleResolutionDownBy: 1.5, maxBitrate: 500_000 },
  low: { label: "LD", maxFramerate: 10, scaleResolutionDownBy: 2, maxBitrate: 250_000 },
  potato: { label: "\u{1F954}", maxFramerate: 5, scaleResolutionDownBy: 4, maxBitrate: 100_000 },
};
export const QUALITY_LEVELS = ["high", "medium", "low", "potato"];

const COORD_CHANNEL = "patchwork-call-coordination";
const COORD_PING_MS = 3000;
const COORD_QUERY_WAIT_MS = 300;

async function applyQuality(pc, quality) {
  const preset = QUALITY_PRESETS[quality];
  if (!preset) return;
  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== "video") continue;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    for (const enc of params.encodings) {
      if (preset.maxFramerate) enc.maxFramerate = preset.maxFramerate;
      else delete enc.maxFramerate;
      if (preset.scaleResolutionDownBy) enc.scaleResolutionDownBy = preset.scaleResolutionDownBy;
      else delete enc.scaleResolutionDownBy;
      if (preset.maxBitrate) enc.maxBitrate = preset.maxBitrate;
      else delete enc.maxBitrate;
    }
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.warn("[call] setParameters failed:", err);
    }
  }
}

export class CallSession extends EventTarget {
  constructor(handle, repo) {
    super();
    this.handle = handle;
    this.repo = repo;
    this.callUrl = handle.url;
    this.peerId = crypto.randomUUID();
    this.tabId = crypto.randomUUID();

    // Media state
    this.localStream = null;
    this.screenStream = null;
    this.cameraEnabled = true;
    this.micEnabled = true;
    this.joined = false;
    this.destroyed = false;
    this.sendQuality = "high";
    this.myName = "unknown";

    // Parsed from window.location.hash at join time so the titlebar
    // can dispatch patchwork:open-document to return to the exact
    // context (e.g. spatial folder that embeds the call).
    this.callContext = null; // { url, toolId } | null

    // Peer connections: remotePeerId -> { pc, polite, stream, name, lastHeartbeat, reconnectAttempts, connectionState, pendingCandidates, makingOffer }
    this.peers = new Map();

    // Transcription
    this._transcriptionStream = null; // @chee/patchwork-transcript session
    this._transcriptionToken = null;  // guards against stop racing async start
    this._prefixCursor = null; // cursor anchored to last char of prefix (the space)
    this._currentInterimLength = 0;

    // Intervals
    this._heartbeatInterval = null;
    this._livenessInterval = null;

    // Cross-tab coordination
    this._coordChannel = new BroadcastChannel(COORD_CHANNEL);
    this._coordPingInterval = null;
    this._onCoordMessage = this._handleCoordMessage.bind(this);
    this._coordChannel.addEventListener("message", this._onCoordMessage);

    // Bind ephemeral handler
    this._onEphemeral = (payload) => {
      const msg = payload.message;
      if (msg && msg.type) this._handleSignal(msg);
    };

    // Device change handler
    this._onDeviceChange = () => {
      if (this.destroyed) return;
      if (!this.localStream) {
        this.retryMedia();
        return;
      }
      const dead = this.localStream.getTracks().some((t) => t.readyState === "ended");
      if (dead) {
        console.warn("[call] Media track ended, retrying");
        this.retryMedia();
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", this._onDeviceChange);

    // Beforeunload handler
    this._onBeforeUnload = () => this.leave();
    window.addEventListener("beforeunload", this._onBeforeUnload);
  }

  // ---- Singleton access ----

  static getSession() {
    return window.__patchworkCallSession || null;
  }

  static create(handle, repo) {
    const existing = CallSession.getSession();
    if (existing && existing.callUrl === handle.url && !existing.destroyed) {
      return existing;
    }
    if (existing) existing.leave();
    const session = new CallSession(handle, repo);
    window.__patchworkCallSession = session;
    CallSession._notifyChanged();
    return session;
  }

  static _notifyChanged() {
    window.dispatchEvent(new CustomEvent("patchwork-call-session-changed"));
  }

  /**
   * Parse the current page URL hash to extract the patchwork document
   * context. Hash format: #doc=<docId>&tool=<toolId>&...
   * Returns { url, toolId } suitable for a patchwork:open-document event.
   */
  static _parseLocationContext() {
    try {
      const hash = window.location.hash;
      if (!hash || hash.length < 2) return null;
      const params = new URLSearchParams(hash.slice(1));
      const docId = params.get("doc");
      if (!docId) return null;
      const url = docId.startsWith("automerge:") ? docId : `automerge:${docId}`;
      const toolId = params.get("tool") || undefined;
      return { url, toolId };
    } catch {
      return null;
    }
  }

  static async isActiveInAnotherTab(callUrl) {
    try {
      const channel = new BroadcastChannel(COORD_CHANNEL);
      return await new Promise((resolve) => {
        const onMsg = (e) => {
          if (e.data.type === "call-active-response" && e.data.callUrl === callUrl) {
            channel.removeEventListener("message", onMsg);
            channel.close();
            resolve(true);
          }
        };
        channel.addEventListener("message", onMsg);
        channel.postMessage({ type: "call-active-query", callUrl });
        setTimeout(() => {
          channel.removeEventListener("message", onMsg);
          channel.close();
          resolve(false);
        }, COORD_QUERY_WAIT_MS);
      });
    } catch {
      return false;
    }
  }

  // ---- Cross-tab coordination ----

  _handleCoordMessage(e) {
    const msg = e.data;
    if (msg.type === "call-active-query" && msg.callUrl === this.callUrl && this.joined) {
      this._coordChannel.postMessage({
        type: "call-active-response",
        callUrl: this.callUrl,
        tabId: this.tabId,
      });
    }
  }

  _startCoordPing() {
    this._coordChannel.postMessage({
      type: "call-active",
      tabId: this.tabId,
      callUrl: this.callUrl,
    });
    this._coordPingInterval = setInterval(() => {
      this._coordChannel.postMessage({
        type: "call-active",
        tabId: this.tabId,
        callUrl: this.callUrl,
      });
    }, COORD_PING_MS);
  }

  _stopCoordPing() {
    if (this._coordPingInterval) {
      clearInterval(this._coordPingInterval);
      this._coordPingInterval = null;
    }
    try {
      this._coordChannel.postMessage({
        type: "call-ended",
        tabId: this.tabId,
        callUrl: this.callUrl,
      });
    } catch {}
  }

  // ---- Name resolution ----

  async resolveMyName() {
    try {
      const contactHandle = await this.repo.find(
        window.accountDocHandle.doc().contactUrl
      );
      const name = contactHandle.doc().name;
      if (name) this.myName = name;
    } catch (err) {
      console.warn("[call] Could not resolve name:", err);
    }
  }

  // ---- Media acquisition ----

  async acquireMedia() {
    // Try video + audio
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this._emitLocalStatus(null);
      return stream;
    } catch (err) {
      console.warn("[call] Could not get video+audio:", err.name, err.message);
    }

    // Try audio only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      this._emitLocalStatus("Camera unavailable \u2014 audio only", true);
      return stream;
    } catch (err) {
      console.warn("[call] Could not get audio:", err.name, err.message);
    }

    // Try video only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this._emitLocalStatus("Microphone unavailable \u2014 video only", true);
      return stream;
    } catch (err) {
      console.warn("[call] Could not get video:", err.name, err.message);
    }

    // Nothing available
    const reason = await this._describeMediaError();
    this._emitLocalStatus(reason, true);
    return null;
  }

  async _describeMediaError() {
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

  async retryMedia() {
    const stream = await this.acquireMedia();
    if (!stream) return;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
    }
    this.localStream = stream;
    this._replaceTracksOnAllPeers();
    this._emit("media-changed");

    // Restart transcription with new audio
    this._stopTranscription();
    this._startTranscription();
  }

  _replaceTracksOnAllPeers() {
    if (!this.localStream) return;
    for (const [, peer] of this.peers) {
      const senders = peer.pc.getSenders();
      for (const track of this.localStream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch((err) => {
            console.warn("[call] replaceTrack failed:", err);
          });
        } else {
          try {
            peer.pc.addTrack(track, this.localStream);
          } catch (err) {
            console.warn("[call] addTrack failed:", err);
          }
        }
      }
    }
  }

  // ---- Join / Leave ----

  async joinCall() {
    if (this.joined) return;

    this.localStream = await this.acquireMedia();
    await this.resolveMyName();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.addEventListener("ended", () => {
          console.warn(`[call] Track ${track.kind} ended`);
          this._emitLocalStatus(
            `${track.kind === "video" ? "Camera" : "Microphone"} disconnected`,
            true
          );
        });
      }
    }

    this.joined = true;
    this.callContext = CallSession._parseLocationContext();
    this._emit("state-changed");
    this._emit("media-changed");
    CallSession._notifyChanged();
    // Re-notify after a tick — titlebar tools may have mounted during the
    // async acquireMedia() gap and missed the synchronous event.
    setTimeout(() => CallSession._notifyChanged(), 0);

    this._startTranscription();

    // Start listening for signaling
    this.handle.on("ephemeral-message", this._onEphemeral);

    // Start peer liveness checks
    this._livenessInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, peer] of this.peers) {
        if (now - peer.lastHeartbeat > PEER_TIMEOUT_MS) {
          console.warn(`[call] Peer ${id} timed out (no heartbeat)`);
          this._removePeer(id);
        }
      }
    }, PEER_TIMEOUT_MS / 2);

    this._broadcast({ type: "join", from: this.peerId, name: this.myName, quality: this.sendQuality });

    this._heartbeatInterval = setInterval(() => {
      if (!this.destroyed) {
        this._broadcast({ type: "join", from: this.peerId, name: this.myName, quality: this.sendQuality });
      }
    }, HEARTBEAT_MS);

    this._startCoordPing();
  }

  leave() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    if (this._livenessInterval) clearInterval(this._livenessInterval);

    if (this.joined) {
      this._broadcast({ type: "leave", from: this.peerId });
    }

    this.handle.off("ephemeral-message", this._onEphemeral);
    navigator.mediaDevices.removeEventListener("devicechange", this._onDeviceChange);
    window.removeEventListener("beforeunload", this._onBeforeUnload);

    this._stopTranscription();
    this._stopCoordPing();

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) track.stop();
      this.screenStream = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }

    for (const [, peer] of this.peers) {
      try { peer.pc.close(); } catch {}
    }
    this.peers.clear();

    this._coordChannel.removeEventListener("message", this._onCoordMessage);
    try { this._coordChannel.close(); } catch {}

    this.joined = false;

    if (window.__patchworkCallSession === this) {
      window.__patchworkCallSession = null;
    }

    this._emit("destroyed");
    CallSession._notifyChanged();
  }

  // ---- Toggle controls ----

  toggleCamera() {
    if (!this.localStream) return;
    this.cameraEnabled = !this.cameraEnabled;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = this.cameraEnabled;
    }
    this._emit("state-changed");
  }

  toggleMic() {
    if (!this.localStream) return;
    this.micEnabled = !this.micEnabled;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = this.micEnabled;
    }
    this._transcriptionStream?.setEnabled(this.micEnabled);
    this._emit("state-changed");
  }

  async toggleScreenShare() {
    if (this.screenStream) {
      this._stopScreenShare();
      return;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    } catch (err) {
      console.warn("[call] Screen share cancelled:", err.message);
      return;
    }

    const screenTrack = this.screenStream.getVideoTracks()[0];
    for (const [, peer] of this.peers) {
      try {
        peer.pc.addTrack(screenTrack, this.screenStream);
      } catch (err) {
        console.warn("[call] addTrack (screen) failed:", err);
      }
    }

    screenTrack.addEventListener("ended", () => {
      this._stopScreenShare();
    });

    this._emit("media-changed");
  }

  _stopScreenShare() {
    if (!this.screenStream) return;
    const screenTrack = this.screenStream.getVideoTracks()[0];

    for (const [, peer] of this.peers) {
      const sender = peer.pc.getSenders().find((s) => s.track === screenTrack);
      if (sender) {
        try { peer.pc.removeTrack(sender); } catch (err) {
          console.warn("[call] removeTrack (screen) failed:", err);
        }
      }
    }

    for (const track of this.screenStream.getTracks()) track.stop();
    this.screenStream = null;
    this._emit("media-changed");
  }

  async setQuality(level) {
    this.sendQuality = level;
    for (const [, peer] of this.peers) {
      await applyQuality(peer.pc, this.sendQuality);
    }
    this._broadcast({
      type: "quality-announce",
      from: this.peerId,
      quality: this.sendQuality,
    });
    this._emit("state-changed");
  }

  renegotiateAll() {
    console.log("[call] Renegotiating with all peers");
    for (const [id, peer] of this.peers) {
      try {
        peer.pc.restartIce();
        console.log(`[call] ICE restart triggered for ${id}`);
      } catch (err) {
        console.warn(`[call] ICE restart failed for ${id}:`, err);
      }
    }
    this._broadcast({ type: "join", from: this.peerId, name: this.myName });
  }

  requestPeerQuality(remotePeerId, quality) {
    this._broadcast({
      type: "quality-request",
      from: this.peerId,
      to: remotePeerId,
      quality,
    });
  }

  // ---- Peer connection management ----

  _isPolite(remotePeerId) {
    return this.peerId < remotePeerId;
  }

  _createPeerConnection(remotePeerId) {
    if (this.peers.has(remotePeerId)) return this.peers.get(remotePeerId);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const polite = this._isPolite(remotePeerId);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        pc.addTrack(track, this.screenStream);
      }
    }

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      if (!remoteStream.getTrackById(event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._broadcast({
          type: "ice-candidate",
          from: this.peerId,
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
        this._broadcast({
          type: "offer",
          from: this.peerId,
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

      peer.connectionState = state;

      switch (state) {
        case "connecting":
        case "new":
          this._emitPeerStatus(remotePeerId, "Connecting\u2026", "connecting");
          break;
        case "connected":
          this._emitPeerStatus(remotePeerId, null, "connected");
          peer.reconnectAttempts = 0;
          if (this.sendQuality !== "high") {
            applyQuality(pc, this.sendQuality);
          }
          break;
        case "disconnected":
          this._emitPeerStatus(remotePeerId, "Connection interrupted\u2026", "reconnecting");
          disconnectTimer = setTimeout(() => {
            if (pc.connectionState === "disconnected") {
              this._attemptReconnect(remotePeerId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          break;
        case "failed":
          this._emitPeerStatus(remotePeerId, null, "failed");
          this._attemptReconnect(remotePeerId);
          break;
        case "closed":
          this._removePeer(remotePeerId);
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        console.warn(`[call] ICE failed for ${remotePeerId}, restarting`);
        try { pc.restartIce(); } catch (err) {
          console.warn("[call] ICE restart failed:", err);
        }
      }
    };

    const peer = {
      pc,
      polite,
      makingOffer: () => makingOffer,
      stream: remoteStream,
      name: remotePeerId.slice(0, 8),
      pendingCandidates: [],
      reconnectAttempts: 0,
      lastHeartbeat: Date.now(),
      connectionState: "new",
      sendingQuality: null, // quality the remote peer is sending at
    };
    this.peers.set(remotePeerId, peer);

    this._emitPeerStatus(remotePeerId, "Connecting\u2026", "connecting");
    this._emit("peers-changed");

    return peer;
  }

  _attemptReconnect(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer || this.destroyed) return;

    peer.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, peer.reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );

    if (peer.reconnectAttempts <= 5) {
      this._emitPeerStatus(
        remotePeerId,
        `Reconnecting (attempt ${peer.reconnectAttempts})\u2026`,
        "reconnecting"
      );
      console.warn(
        `[call] Reconnecting to ${remotePeerId} in ${delay}ms (attempt ${peer.reconnectAttempts})`
      );
      setTimeout(() => {
        if (this.destroyed || !this.peers.has(remotePeerId)) return;
        this._reconnectPeer(remotePeerId);
      }, delay);
    } else {
      this._emitPeerStatus(remotePeerId, "Connection lost", "failed", true);
    }
  }

  _reconnectPeer(remotePeerId) {
    const oldPeer = this.peers.get(remotePeerId);
    if (!oldPeer) return;

    const name = oldPeer.name;
    const reconnectAttempts = oldPeer.reconnectAttempts;

    try { oldPeer.pc.close(); } catch {}

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const polite = this._isPolite(remotePeerId);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        pc.addTrack(track, this.screenStream);
      }
    }

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      if (!remoteStream.getTrackById(event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._broadcast({
          type: "ice-candidate",
          from: this.peerId,
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
        this._broadcast({
          type: "offer",
          from: this.peerId,
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

      oldPeer.connectionState = state;

      switch (state) {
        case "connecting":
        case "new":
          this._emitPeerStatus(remotePeerId, "Connecting\u2026", "connecting");
          break;
        case "connected":
          this._emitPeerStatus(remotePeerId, null, "connected");
          oldPeer.reconnectAttempts = 0;
          break;
        case "disconnected":
          this._emitPeerStatus(remotePeerId, "Connection interrupted\u2026", "reconnecting");
          disconnectTimer = setTimeout(() => {
            if (pc.connectionState === "disconnected") {
              this._attemptReconnect(remotePeerId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          break;
        case "failed":
          this._emitPeerStatus(remotePeerId, null, "failed");
          this._attemptReconnect(remotePeerId);
          break;
        case "closed":
          this._removePeer(remotePeerId);
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch {}
      }
    };

    oldPeer.pc = pc;
    oldPeer.polite = polite;
    oldPeer.makingOffer = () => makingOffer;
    oldPeer.stream = remoteStream;
    oldPeer.pendingCandidates = [];
    oldPeer.reconnectAttempts = reconnectAttempts;
    oldPeer.name = name;

    if (this.sendQuality !== "high") {
      applyQuality(pc, this.sendQuality);
    }

    this._emit("peers-changed");
    this._broadcast({ type: "join", from: this.peerId, name: this.myName });
  }

  manualReconnectPeer(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (peer) {
      peer.reconnectAttempts = 0;
      this._reconnectPeer(remotePeerId);
    }
  }

  _removePeer(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    this.peers.delete(remotePeerId);
    this._emit("peers-changed");
  }

  // ---- Signaling ----

  _broadcast(msg) {
    this.handle.broadcast(msg);
  }

  async _flushCandidates(peer) {
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

  async _handleSignal(msg) {
    if (msg.from === this.peerId) return;
    if (msg.to && msg.to !== this.peerId) return;

    switch (msg.type) {
      case "join": {
        const existing = this.peers.get(msg.from);
        if (existing) {
          existing.lastHeartbeat = Date.now();
          let changed = false;
          if (msg.name) { existing.name = msg.name; changed = true; }
          if (msg.quality) { existing.sendingQuality = msg.quality; changed = true; }
          if (changed) this._emit("peers-changed");
          if (
            existing.pc.connectionState === "connected" ||
            existing.pc.signalingState !== "stable"
          ) {
            this._broadcast({ type: "name", from: this.peerId, name: this.myName });
            break;
          }
        }
        const peer = this._createPeerConnection(msg.from);
        peer.lastHeartbeat = Date.now();
        if (msg.name) { peer.name = msg.name; }
        if (msg.quality) { peer.sendingQuality = msg.quality; }
        if (msg.name || msg.quality) this._emit("peers-changed");
        if (!this.localStream) {
          try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            this._broadcast({
              type: "offer",
              from: this.peerId,
              to: msg.from,
              sdp: peer.pc.localDescription.toJSON(),
            });
          } catch (err) {
            console.warn("[call] Error creating offer:", err);
          }
        }
        this._broadcast({ type: "name", from: this.peerId, name: this.myName });
        break;
      }

      case "offer": {
        const peer = this._createPeerConnection(msg.from);
        try {
          const offerCollision =
            peer.makingOffer() || peer.pc.signalingState !== "stable";
          if (offerCollision && !peer.polite) break;

          await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this._flushCandidates(peer);
          await peer.pc.setLocalDescription();
          this._broadcast({
            type: "answer",
            from: this.peerId,
            to: msg.from,
            sdp: peer.pc.localDescription.toJSON(),
          });
        } catch (err) {
          console.warn("[call] Error handling offer:", err);
        }
        break;
      }

      case "answer": {
        const peer = this.peers.get(msg.from);
        if (!peer) break;
        try {
          if (peer.pc.signalingState !== "have-local-offer") break;
          await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this._flushCandidates(peer);
        } catch (err) {
          console.warn("[call] Error handling answer:", err);
        }
        break;
      }

      case "ice-candidate": {
        const peer = this.peers.get(msg.from);
        if (!peer) break;
        try {
          if (!peer.pc.remoteDescription) {
            peer.pendingCandidates.push(msg.candidate);
          } else {
            await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
        } catch (err) {
          if (!err.message?.includes("location information")) {
            console.warn("[call] Error adding ICE candidate:", err);
          }
        }
        break;
      }

      case "name": {
        const peer = this.peers.get(msg.from);
        if (peer && msg.name) {
          peer.name = msg.name;
          this._emit("peers-changed");
        }
        break;
      }

      case "quality-request": {
        const peer = this.peers.get(msg.from);
        if (peer && msg.quality) {
          console.log(`[call] ${msg.from} requested quality: ${msg.quality}`);
          applyQuality(peer.pc, msg.quality);
        }
        break;
      }

      case "quality-announce": {
        const peer = this.peers.get(msg.from);
        if (peer && msg.quality) {
          peer.sendingQuality = msg.quality;
          this._emit("peers-changed");
        }
        break;
      }

      case "leave": {
        this._removePeer(msg.from);
        break;
      }
    }
  }

  // ---- Transcription ----

  async _startTranscription() {
    console.log("[transcription] _startTranscription called");
    if (!this.localStream) {
      console.warn("[transcription] No localStream, aborting");
      return;
    }
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn("[transcription] No audio track found in localStream");
      return;
    }

    // @chee/patchwork-transcript runs Silero VAD + the ASR model in a worker and
    // reads the mic track itself (MediaStreamTrackProcessor — keeps flowing when
    // the page loses focus). We keep the speaker-prefix / cursor bookkeeping here
    // since it's specific to call's shared transcript document.
    const token = {};
    this._transcriptionToken = token;

    const stream = await createTranscriptionStream({
      track: audioTrack,
      enabled: this.micEnabled,
      onStatus: (message) => this._emit("transcription-status", { message }),
      onReady: () => this._emit("transcription-status", { message: null }),
      onSpeechStart: () => {
        // Insert speaker prefix and anchor a cursor to its last char (the space),
        // which is stable and survives concurrent edits from other speakers.
        this.handle.change((doc) => {
          const prefix = `<${this.myName}> `;
          Automerge.splice(doc, ["content"], doc.content.length, 0, prefix);
          this._prefixCursor = Automerge.getCursor(
            doc,
            ["content"],
            doc.content.length - 1
          );
          this._currentInterimLength = 0;
        });
      },
      onInterim: (text) => {
        // Replace previous interim text right after the prefix cursor.
        if (this._prefixCursor == null) return;
        this.handle.change((doc) => {
          const anchorPos = Automerge.getCursorPosition(
            doc,
            ["content"],
            this._prefixCursor
          );
          const insertPos = anchorPos + 1;
          Automerge.splice(
            doc,
            ["content"],
            insertPos,
            this._currentInterimLength,
            text
          );
          this._currentInterimLength = text.length;
        });
        this._emit("transcript", { text, speaker: this.myName, interim: true });
      },
      onFinal: (text) => {
        // Replace interim text with the final transcription + newline.
        if (this._prefixCursor == null) return;
        this.handle.change((doc) => {
          const anchorPos = Automerge.getCursorPosition(
            doc,
            ["content"],
            this._prefixCursor
          );
          const insertPos = anchorPos + 1;
          Automerge.splice(
            doc,
            ["content"],
            insertPos,
            this._currentInterimLength,
            text + "\n"
          );
        });
        this._prefixCursor = null;
        this._currentInterimLength = 0;
        this._emit("transcript", { text, speaker: this.myName });
      },
      onSpeechEnd: () => {
        // Speech ended without a final (e.g. too short) — clean up the prefix.
        if (this._prefixCursor == null) return;
        const prefixLen = `<${this.myName}> `.length;
        this.handle.change((doc) => {
          const anchorPos = Automerge.getCursorPosition(
            doc,
            ["content"],
            this._prefixCursor
          );
          const startPos = anchorPos - (prefixLen - 1);
          Automerge.splice(
            doc,
            ["content"],
            startPos,
            prefixLen + this._currentInterimLength,
            ""
          );
        });
        this._prefixCursor = null;
        this._currentInterimLength = 0;
      },
      onError: (err) => console.error("[transcription] stream error:", err),
    });

    // _stopTranscription may have run while we awaited the worker spawn.
    if (this._transcriptionToken !== token) {
      stream.close();
      return;
    }
    this._transcriptionStream = stream;
    console.log("[transcription] Setup complete (streaming via @chee/patchwork-transcript)");
  }

  _stopTranscription() {
    this._transcriptionToken = null;
    if (this._transcriptionStream) {
      this._transcriptionStream.close();
      this._transcriptionStream = null;
    }
    this._prefixCursor = null;
    this._currentInterimLength = 0;
  }

  // ---- Event helpers ----

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _emitLocalStatus(message, retryable = false) {
    this._emit("local-status", { message, retryable });
  }

  _emitPeerStatus(peerId, message, state, retryable = false) {
    this._emit("peer-status", { peerId, message, state, retryable });
  }
}

export function getCallSession() {
  return CallSession.getSession();
}

export function createCallSession(handle, repo) {
  return CallSession.create(handle, repo);
}
