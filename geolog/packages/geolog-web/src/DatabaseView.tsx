import { useState, useEffect, useCallback } from "react";
import { Repo } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { GeologAutomerge, GeologDoc } from "./geolog-automerge";
import { LocalNetworkAdapter, setConnectionState } from "./LocalNetworkAdapter";
import { GenericEditor } from "./GenericEditor";

interface DatabaseViewProps {
  schema: string;
  onEditSchema: () => void;
}

/**
 * The dual-pane database sync demo.
 *
 * Creates two Automerge repos connected by a LocalNetworkAdapter pair,
 * initializes GeologAutomerge bridges for each, and renders two
 * GraphEditor panels side by side.
 *
 * All repo/handle/adapter lifecycle is owned by this component.
 * Unmounting discards everything.
 */
export function DatabaseView({ schema, onEditSchema }: DatabaseViewProps) {
  const [geologA, setGeologA] = useState<GeologAutomerge | null>(null);
  const [geologB, setGeologB] = useState<GeologAutomerge | null>(null);
  const [adapters, setAdapters] = useState<[LocalNetworkAdapter, LocalNetworkAdapter] | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Create paired network adapters
      const [adapterA, adapterB] = LocalNetworkAdapter.createPair();

      // Create two repos
      const repoA = new Repo({
        network: [adapterA],
        storage: new IndexedDBStorageAdapter("geolog-repo-a"),
      });

      const repoB = new Repo({
        network: [adapterB],
        storage: new IndexedDBStorageAdapter("geolog-repo-b"),
      });

      // Create document in repo A
      const handleA = repoA.create<GeologDoc>();

      // Find the same document in repo B
      const handleB = repoB.find<GeologDoc>(handleA.url);

      // Initialize instance A (creates the document with the theory)
      const geoA = GeologAutomerge.create(handleA, schema);

      // Wait for handle B to be ready, then load from it
      const resolvedHandleB = await handleB;

      // Brief delay for initial sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      const geoB = await GeologAutomerge.load(resolvedHandleB);

      if (cancelled) return;

      setAdapters([adapterA, adapterB]);
      setGeologA(geoA);
      setGeologB(geoB);
      setLoading(false);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [schema]);

  const toggleConnection = useCallback(() => {
    if (!adapters) return;
    const newState = !isConnected;
    setIsConnected(newState);
    setConnectionState(adapters, newState);
  }, [isConnected, adapters]);

  if (loading) {
    return <div className="loading">Initializing Geolog databases...</div>;
  }

  return (
    <div className="app">
      <header>
        <h1>Geolog + Automerge Demo</h1>
        <p className="description">
          Two instances of a database, synchronized via Automerge.
          <br />
          Disconnect, make changes on both sides, then reconnect to see merge behavior.
        </p>
        <pre className="schema-code">{schema.trim()}</pre>
        <div className="header-buttons">
          <button
            className={`connection-toggle ${isConnected ? "connected" : "disconnected"}`}
            onClick={toggleConnection}
          >
            {isConnected ? "Connected" : "Disconnected"}
          </button>
          <button className="edit-schema-btn" onClick={onEditSchema}>
            Edit Schema
          </button>
        </div>
      </header>

      <div className="editors">
        <div className="editor-panel">
          <h2>Instance A</h2>
          {geologA && <GenericEditor geolog={geologA} />}
        </div>

        <div className="editor-panel">
          <h2>Instance B</h2>
          {geologB && <GenericEditor geolog={geologB} />}
        </div>
      </div>
    </div>
  );
}
