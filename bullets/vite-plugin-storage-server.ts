import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import type { Plugin } from "vite";

export function storageServerPlugin(dir: string): Plugin {
  return {
    name: "bullets-storage-server",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer!.on("upgrade", (request, socket, head) => {
        if (request.url === "/automerge-sync") {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        }
      });

      const adapter = new WebSocketServerAdapter(wss);
      new Repo({
        storage: new NodeFSStorageAdapter(dir),
        network: [adapter],
      });
      console.log(`[Storage] Persisting to ${dir}`);
    },
  };
}
