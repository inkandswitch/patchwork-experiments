import { Repo, Automerge } from '@automerge/automerge-repo/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { MessageChannelNetworkAdapter } from '@automerge/vanillajs';

// TODO: can we get rid of the base64 thing?
// (can we just initializeWasm?)

export async function getRepo(port: MessagePort, peerId: string) {
  await Automerge.initializeBase64Wasm(automergeWasmBase64);
  console.log('Automerge WASM initialized');

  return new Repo({
    network: [new MessageChannelNetworkAdapter(port)],
    peerId: peerId as any,
  });
}
