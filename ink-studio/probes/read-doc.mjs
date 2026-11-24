// Prints a doc from the sync server as JSON (bytes summarised), or a folder's entries.
//   node probes/read-doc.mjs <url> [--folder]
import { Repo, initSubduction } from "@automerge/automerge-repo";
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"] });
const d = (await repo.find(process.argv[2])).doc();
const json = JSON.parse(JSON.stringify(d, (k, v) => (v instanceof Uint8Array ? `<${v.byteLength} bytes>` : v)));
if (process.argv.includes("--folder")) for (const e of json.docs) console.log(`${e.name}\t${e.type}\t${e.url}`);
else console.log(JSON.stringify(json, null, 1));
process.exit(0);
