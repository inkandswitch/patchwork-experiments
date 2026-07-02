// ShareSession — one WebRTC mesh for the whole canvas, modelled on the `call` tool's
// CallSession. Node sharing ("everyone sees mine") runs over it instead of raw
// ephemeral: VALUES go over a reliable data channel (high-frequency pointer/viewport
// without flooding the doc), STREAMS go over media tracks. Signaling (join/offer/
// answer/ice) rides the folder-doc ephemeral channel — proven to relay (presence + the
// call tool use it). Perfect-negotiation handles glare; ICE candidates buffer until the
// remote description lands; the owner heartbeats so refreshed/late peers reconnect.
//
//   const s = new ShareSession(folderHandle, myUrl)
//   s.shareValue(itemId, value)         // broadcast a value to all peers
//   s.onValue(itemId, (value) => …)     // receive a value
//   s.shareStream(itemId, stream)       // add a MediaStream's tracks + map them to itemId
//   s.onStream(itemId, (stream) => …)   // receive the remote stream for an item (null when the owner unshares)
//   s.unshare(itemId);  s.destroy()
const RTC_CONFIG = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:sync3.automerge.org:3478", username: "user", credential: "password" },
] };
const hasRTC = () => typeof RTCPeerConnection !== "undefined";
const sdp = (s) => (typeof RTCSessionDescription !== "undefined" ? new RTCSessionDescription(s) : s);
const ice = (c) => (typeof RTCIceCandidate !== "undefined" ? new RTCIceCandidate(c) : c);

// a live registry of active sessions + a change bus, so a TRAY tool can observe the
// canvas's WebRTC mesh without owning it.
export const sessionRegistry = new Set();
export const sessionEvents = typeof EventTarget !== "undefined" ? new EventTarget() : { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
const bump = () => { try { sessionEvents.dispatchEvent(new CustomEvent("change")); } catch {} };

export class ShareSession {
  constructor(handle, myUrl) {
    this.handle = handle;
    this.myUrl = myUrl || ("anon-" + Math.random().toString(36).slice(2));
    sessionRegistry.add(this);
    this.peers = new Map();              // peerUrl -> { pc, dc, polite, makingOffer, pendingIce[], tracks: Map<trackId,track>, itemStreams: Map<item,MediaStream>, trackMap: Map<trackId,item> }
    this.shared = new Map();             // itemId -> { value? , stream? , trackIds?[] }
    this.valueCb = new Map();            // itemId -> Set<cb>
    this.streamCb = new Map();           // itemId -> Set<cb>
    this.destroyed = false;
    if (!handle || !handle.broadcast || !hasRTC()) return; // no-op if unavailable
    this._onMsg = (p) => this._signal(p && p.message);
    handle.on("ephemeral-message", this._onMsg);
    this._announce();                                       // say hello now
    this._hb = setInterval(() => this._announce(), 3000);   // …and keep saying it (presence-style)
  }

  // ── public API ────────────────────────────────────────────────────────────
  onValue(item, cb) { return this._on(this.valueCb, item, cb); }
  onStream(item, cb) {
    const off = this._on(this.streamCb, item, cb);
    for (const pr of this.peers.values()) { const ms = pr.itemStreams && pr.itemStreams.get(item); if (ms && ms.getTracks().length) cb(ms); } // late subscriber
    return off;
  }
  shareValue(item, value) {
    const rec = this.shared.get(item) || {}; rec.value = value; this.shared.set(item, rec);
    const msg = JSON.stringify({ t: "val", item, value });
    for (const pr of this.peers.values()) this._send(pr, msg);
    bump();
  }
  shareStream(item, stream) {
    if (!stream) return;
    const ids = stream.getTracks().map((t) => t.id);
    const rec = this.shared.get(item) || {}; rec.stream = stream; rec.trackIds = ids; this.shared.set(item, rec);
    console.log("[share] streaming", item, "to", this.peers.size, "peer(s)");
    for (const pr of this.peers.values()) this._addStreamTo(pr, item, stream, ids);
    bump();
  }
  unshare(item) {
    const rec = this.shared.get(item); this.shared.delete(item);
    if (rec && rec.stream) {
      // tell receivers the mapping is gone so they drop the frozen frame
      const msg = JSON.stringify({ t: "unmap", item });
      for (const pr of this.peers.values()) { this._removeStreamFrom(pr, rec.stream); this._send(pr, msg); }
    }
    bump();
  }
  destroy() {
    this.destroyed = true;
    if (this._hb) clearInterval(this._hb);
    if (this.handle && this._onMsg) { try { this.handle.off("ephemeral-message", this._onMsg); } catch {} }
    for (const pr of this.peers.values()) { if (pr.disconnectTimer) clearTimeout(pr.disconnectTimer); try { pr.pc.close(); } catch {} }
    this.peers.clear();
    sessionRegistry.delete(this); bump();
  }

  // a snapshot for the tray tool — who's connected, what's flowing
  state() {
    const peers = [];
    for (const [url, pr] of this.peers) {
      const recvItems = [...new Set([...pr.trackMap.values()])];
      peers.push({ url, short: url.slice(-6), connection: pr.pc.connectionState, channel: pr.dc && pr.dc.readyState, receiving: recvItems });
    }
    return { myUrl: this.myUrl, peers, sharing: [...this.shared.keys()], listening: { values: [...this.valueCb.keys()], streams: [...this.streamCb.keys()] } };
  }

  // ── internals ─────────────────────────────────────────────────────────────
  _on(map, item, cb) { let s = map.get(item); if (!s) { s = new Set(); map.set(item, s); } s.add(cb); bump(); return () => { s.delete(cb); bump(); }; }
  _announce() { this.handle.broadcast({ ns: "share", t: "join", from: this.myUrl }); }
  _polite(other) { return this.myUrl < other; }

  // a pc we must not reuse: closed, or its transport gave up — a reloading peer's
  // fresh offer can never be applied to it, so it has to be torn down + rebuilt
  _dead(pr) { const cs = pr.pc.connectionState; return cs === "failed" || cs === "closed" || pr.pc.signalingState === "closed"; }
  _evict(other, pr) {
    if (this.peers.get(other) !== pr) return; // already replaced by a fresh pc
    if (pr.disconnectTimer) clearTimeout(pr.disconnectTimer);
    try { pr.pc.close(); } catch {}
    this.peers.delete(other);
    console.log("[share] peer -", other.slice(-6), "(evicted:", pr.pc.connectionState + ")");
    bump();
  }

  _peer(other) {
    let pr = this.peers.get(other);
    if (pr && this._dead(pr)) { this._evict(other, pr); pr = null; } // zombie — rebuild
    if (pr) return pr;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pr = { pc, dc: null, polite: this._polite(other), makingOffer: false, pendingIce: [], tracks: new Map(), itemStreams: new Map(), trackMap: new Map(), disconnectTimer: null };
    this.peers.set(other, pr);
    console.log("[share] peer +", other.slice(-6), pr.polite ? "(polite)" : "(impolite)");
    pc.onconnectionstatechange = () => {
      console.log("[share]", other.slice(-6), "→", pc.connectionState);
      const cs = pc.connectionState;
      if (cs === "failed" || cs === "closed") this._evict(other, pr);
      else if (cs === "disconnected") { // give ICE a chance to recover, then evict
        if (!pr.disconnectTimer) pr.disconnectTimer = setTimeout(() => { pr.disconnectTimer = null; if (pc.connectionState === "disconnected") this._evict(other, pr); }, 8000);
      } else if (pr.disconnectTimer) { clearTimeout(pr.disconnectTimer); pr.disconnectTimer = null; }
      bump();
    };
    pc.oniceconnectionstatechange = () => bump();
    // the polite peer creates the data channel; both see it via ondatachannel
    if (pr.polite) { pr.dc = pc.createDataChannel("ns-share"); this._wireDc(pr); }
    pc.ondatachannel = (e) => { pr.dc = e.channel; this._wireDc(pr); };
    pc.ontrack = (e) => { pr.tracks.set(e.track.id, e.track); this._routeTrack(pr, e.track.id); };
    pc.onicecandidate = (e) => { if (e.candidate) this.handle.broadcast({ ns: "share", t: "ice", from: this.myUrl, to: other, candidate: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try { pr.makingOffer = true; await pc.setLocalDescription(); this.handle.broadcast({ ns: "share", t: "offer", from: this.myUrl, to: other, sdp: pc.localDescription.toJSON() }); }
      catch {} finally { pr.makingOffer = false; }
    };
    // push everything we're already sharing to the new peer
    for (const [item, rec] of this.shared) if (rec.stream) this._addStreamTo(pr, item, rec.stream, rec.trackIds);
    return pr;
  }

  _wireDc(pr) {
    pr.dc.onopen = () => { for (const [item, rec] of this.shared) if ("value" in rec) this._send(pr, JSON.stringify({ t: "val", item, value: rec.value })); };
    pr.dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onData(pr, m); };
  }
  _send(pr, msg) { try { if (pr.dc && pr.dc.readyState === "open") pr.dc.send(msg); } catch {} }
  _onData(pr, m) {
    if (m.t === "val") { const s = this.valueCb.get(m.item); if (s) for (const cb of [...s]) cb(m.value); }
    else if (m.t === "map") { for (const id of m.trackIds || []) pr.trackMap.set(id, m.item); this._routeTrack(pr, null, m.item); }
    else if (m.t === "unmap") { // the sender unshared: drop the mapping + clear the frozen frame
      for (const [id, it] of [...pr.trackMap]) if (it === m.item) { pr.trackMap.delete(id); pr.tracks.delete(id); }
      pr.itemStreams.delete(m.item);
      const s = this.streamCb.get(m.item); if (s) for (const cb of [...s]) cb(null);
      bump();
    }
  }
  _addStreamTo(pr, item, stream, ids) {
    for (const track of stream.getTracks()) { if (!pr.pc.getSenders().some((s) => s.track === track)) pr.pc.addTrack(track, stream); }
    this._send(pr, JSON.stringify({ t: "map", item, trackIds: ids || stream.getTracks().map((t) => t.id) }));
  }
  _removeStreamFrom(pr, stream) {
    for (const track of stream.getTracks()) { const s = pr.pc.getSenders().find((x) => x.track === track); if (s) try { pr.pc.removeTrack(s); } catch {} }
  }
  // once we know a track↔item mapping (from a "map" msg) AND have the track, deliver
  // a PER-ITEM stream carrying only that item's tracks (two shares from one peer must
  // not conflate into one stream)
  _routeTrack(pr, trackId, item) {
    const it = item || (trackId && pr.trackMap.get(trackId));
    if (!it) return;
    let ms = pr.itemStreams.get(it);
    if (!ms) { ms = new MediaStream(); pr.itemStreams.set(it, ms); }
    for (const [id, mapped] of pr.trackMap) {
      if (mapped !== it) continue;
      const track = pr.tracks.get(id);
      if (track && !ms.getTrackById(id)) ms.addTrack(track);
    }
    const cbs = this.streamCb.get(it);
    if (cbs && ms.getTracks().length) for (const cb of [...cbs]) cb(ms);
  }

  async _signal(m) {
    if (this.destroyed || !m || m.ns !== "share" || m.from === this.myUrl) return;
    if (m.to && m.to !== this.myUrl) return;
    if (m.t === "join") { this._peer(m.from); return; } // discovering a peer triggers negotiation (onnegotiationneeded fires once we add tracks / a dc); a dead pc is rebuilt inside _peer
    let pr = this._peer(m.from);
    try {
      // a fresh offer aimed at a pc that can no longer take one (peer reloaded and the
      // old connection died mid-signal) — tear it down and apply to a fresh pc instead
      if (m.t === "offer" && this._dead(pr)) { this._evict(m.from, pr); pr = this._peer(m.from); }
      if (m.t === "offer") {
        const collision = pr.makingOffer || pr.pc.signalingState !== "stable";
        if (collision && !pr.polite) return;             // impolite peer ignores a glare offer
        await pr.pc.setRemoteDescription(sdp(m.sdp));
        await this._flush(pr);
        await pr.pc.setLocalDescription();
        this.handle.broadcast({ ns: "share", t: "answer", from: this.myUrl, to: m.from, sdp: pr.pc.localDescription.toJSON() });
      } else if (m.t === "answer") {
        if (pr.pc.signalingState !== "have-local-offer") return;
        await pr.pc.setRemoteDescription(sdp(m.sdp)); await this._flush(pr);
      } else if (m.t === "ice") {
        if (!pr.pc.remoteDescription) pr.pendingIce.push(m.candidate);
        else await pr.pc.addIceCandidate(ice(m.candidate));
      }
    } catch (e) { console.warn("[share] signal", m.t, "from", (m.from || "").slice(-6), e); }
  }
  async _flush(pr) { const cs = pr.pendingIce.splice(0); for (const c of cs) { try { await pr.pc.addIceCandidate(ice(c)); } catch {} } }
}

export function myContactUrl() {
  try { return window.accountDocHandle.doc().contactUrl || null; } catch { return null; }
}
