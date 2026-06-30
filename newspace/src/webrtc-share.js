// Share a live MediaStream peer-to-peer over WebRTC, signalled through a node's
// item-scoped ephemeral channel (the `broadcast`/`onBroadcast` the host passes to a
// mount — already keyed to THIS item id, so signaling for one shared camera/mic never
// crosses another). The OWNER offers their stream; each receiver answers and gets it.
//
//   owner:    shareMyStream({ stream, broadcast, onBroadcast, myUrl }) -> stop()
//   receiver: receiveStream({ broadcast, onBroadcast, myUrl, onStream }) -> stop()
//
// Messages (all carry `rtc`): "available" (owner announces) · "request" (receiver asks)
// · "offer"/"answer" (sdp, addressed by `to`) · "ice" (candidate, addressed by `to`).
// ICE config copied from the `call` tool: STUN + the Automerge TURN relay. TURN is
// essential — STUN-only fails across NATs (why a cross-network stream never connects).
const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:sync3.automerge.org:3478", username: "user", credential: "password" },
] };
const hasRTC = () => typeof RTCPeerConnection !== "undefined";
const sdpOf = (s) => (typeof RTCSessionDescription !== "undefined" ? new RTCSessionDescription(s) : s);
const iceOf = (c) => (typeof RTCIceCandidate !== "undefined" ? new RTCIceCandidate(c) : c);

export function shareMyStream({ stream, broadcast, onBroadcast, myUrl }) {
  if (!hasRTC() || !stream) return () => {};
  const pcs = new Map(); // receiverUrl -> RTCPeerConnection
  const offer = async (to) => {
    const prev = pcs.get(to); if (prev) { try { prev.close(); } catch {} }
    const pc = new RTCPeerConnection(ICE);
    pcs.set(to, pc);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (e) => { if (e.candidate) broadcast({ rtc: "ice", to, from: myUrl, candidate: e.candidate.toJSON() }); };
    try { const o = await pc.createOffer(); await pc.setLocalDescription(o); broadcast({ rtc: "offer", to, from: myUrl, sdp: pc.localDescription }); } catch {}
  };
  const off = onBroadcast((m) => {
    if (!m || !m.rtc || m.from === myUrl) return;
    if (m.rtc === "request") offer(m.from);
    else if (m.rtc === "answer" && m.to === myUrl) { const pc = pcs.get(m.from); if (pc) pc.setRemoteDescription(sdpOf(m.sdp)).catch(() => {}); }
    else if (m.rtc === "ice" && m.to === myUrl) { const pc = pcs.get(m.from); if (pc && m.candidate) pc.addIceCandidate(iceOf(m.candidate)).catch(() => {}); }
  });
  broadcast({ rtc: "available", from: myUrl }); // any receiver already present re-requests
  const hb = setInterval(() => broadcast({ rtc: "available", from: myUrl }), 2500); // so a refreshed receiver re-requests
  return () => { clearInterval(hb); off(); for (const pc of pcs.values()) { try { pc.close(); } catch {} } pcs.clear(); };
}

export function receiveStream({ broadcast, onBroadcast, myUrl, onStream }) {
  if (!hasRTC()) return () => {};
  let pc = null, from = null;
  const off = onBroadcast(async (m) => {
    if (!m || !m.rtc || m.from === myUrl) return;
    if (m.rtc === "available") broadcast({ rtc: "request", from: myUrl });
    else if (m.rtc === "offer" && m.to === myUrl) {
      if (pc) { try { pc.close(); } catch {} }
      from = m.from;
      pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (e) => { if (e.candidate) broadcast({ rtc: "ice", to: from, from: myUrl, candidate: e.candidate.toJSON() }); };
      pc.ontrack = (e) => { const s = e.streams && e.streams[0]; if (s) onStream(s); };
      try { await pc.setRemoteDescription(sdpOf(m.sdp)); const a = await pc.createAnswer(); await pc.setLocalDescription(a); broadcast({ rtc: "answer", to: from, from: myUrl, sdp: pc.localDescription }); } catch {}
    } else if (m.rtc === "ice" && m.to === myUrl && pc && m.candidate) pc.addIceCandidate(iceOf(m.candidate)).catch(() => {});
  });
  broadcast({ rtc: "request", from: myUrl }); // in case the owner is already broadcasting
  // keep asking until we have a live connection (covers the owner not yet listening / lost offers)
  const hb = setInterval(() => { if (!pc || (pc.connectionState !== "connected" && pc.iceConnectionState !== "connected")) broadcast({ rtc: "request", from: myUrl }); }, 2500);
  return () => { clearInterval(hb); off(); if (pc) { try { pc.close(); } catch {} } };
}

// the current user's contact url (used as the WebRTC peer identity)
export function myContactUrl() {
  try { return window.accountDocHandle.doc().contactUrl || null; } catch { return null; }
}
