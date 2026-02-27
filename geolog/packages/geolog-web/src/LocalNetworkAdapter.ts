import { NetworkAdapter, PeerId, PeerMetadata, Message } from "@automerge/automerge-repo";

/**
 * A pair of LocalNetworkAdapters that connect two repos directly in memory.
 * The connection can be programmatically disconnected and reconnected.
 */
export class LocalNetworkAdapter extends NetworkAdapter {
  private _isReady = false;
  private _isConnected = true;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private peer: LocalNetworkAdapter | null = null;

  constructor() {
    super();
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Create a pair of connected adapters.
   * Returns [adapterA, adapterB] which are linked together.
   */
  static createPair(): [LocalNetworkAdapter, LocalNetworkAdapter] {
    const a = new LocalNetworkAdapter();
    const b = new LocalNetworkAdapter();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  isReady(): boolean {
    return this._isReady;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    console.log(`[LocalNetworkAdapter] connect called with peerId: ${peerId}`);
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this._isReady = true;
    this.resolveReady();

    // Announce connection to peer if connected
    if (this._isConnected && this.peer && this.peer._isReady) {
      console.log(`[LocalNetworkAdapter ${peerId}] Both peers ready, announcing`);
      this.announcePeer();
      this.peer.announcePeer();
    } else {
      console.log(`[LocalNetworkAdapter ${peerId}] Peer not ready yet, connected: ${this._isConnected}, hasPeer: ${!!this.peer}, peerReady: ${this.peer?._isReady}`);
    }
  }

  private announcePeer(): void {
    if (!this.peer || !this.peer.peerId || !this._isConnected) return;
    
    this.emit("peer-candidate", {
      peerId: this.peer.peerId,
      peerMetadata: this.peer.peerMetadata || {},
    });
  }

  send(message: Message): void {
    console.log(`[LocalNetworkAdapter ${this.peerId}] send called, connected: ${this._isConnected}, hasPeer: ${!!this.peer}`);
    if (!this._isConnected || !this.peer) return;
    
    // Deliver message to peer asynchronously (simulates network)
    setTimeout(() => {
      if (this._isConnected && this.peer) {
        console.log(`[LocalNetworkAdapter ${this.peerId}] delivering message to peer ${this.peer.peerId}`, message.type);
        this.peer.emit("message", message);
      }
    }, 0);
  }

  disconnect(): void {
    this._isConnected = false;
    if (this.peer && this.peer.peerId) {
      this.emit("peer-disconnected", { peerId: this.peer.peerId });
    }
  }

  /**
   * Simulate network disconnection between the two peers.
   * Messages will not be delivered while disconnected.
   */
  setConnected(connected: boolean): void {
    const wasConnected = this._isConnected;
    this._isConnected = connected;

    if (connected && !wasConnected) {
      // Reconnecting - announce peer again
      if (this.peer && this.peer._isReady) {
        this.announcePeer();
      }
    } else if (!connected && wasConnected) {
      // Disconnecting - emit peer-disconnected
      if (this.peer && this.peer.peerId) {
        this.emit("peer-disconnected", { peerId: this.peer.peerId });
      }
    }
  }

  /**
   * Check if currently connected to peer.
   */
  get isConnectedToPeer(): boolean {
    return this._isConnected;
  }
}

/**
 * Helper to disconnect/reconnect a pair of LocalNetworkAdapters.
 */
export function setConnectionState(
  adapters: [LocalNetworkAdapter, LocalNetworkAdapter],
  connected: boolean
): void {
  adapters[0].setConnected(connected);
  adapters[1].setConnected(connected);
}
