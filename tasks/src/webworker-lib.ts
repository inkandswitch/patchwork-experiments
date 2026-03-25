import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { Repo, Automerge, MessageChannelNetworkAdapter, IndexedDBStorageAdapter } from '@automerge/vanillajs/slim';

// TODO: can we get rid of the base64 thing?
// (can we just initializeWasm?)

export async function getRepo(port: MessagePort, peerId: string) {
  await Automerge.initializeBase64Wasm(automergeWasmBase64);
  console.log('Automerge WASM initialized');

  const repo = new Repo({
    network: [new MessageChannelNetworkAdapter(port)],
    storage: new IndexedDBStorageAdapter(),
    peerId: peerId as any,
  });

  await repo.networkSubsystem.whenReady();

  return repo;
}
