// The pipe: how a worker reaches documents. A host (the page's pool host in a
// browser, the host process in Node) holds the one Repo of its place, with the
// place's storage and network; each worker's Repo (webworker-lib.ts) has the
// pipe as its only network adapter, so everything a worker reads or writes
// goes through its host's Repo. A pipe is a MessageChannel: the host keeps
// one end, the worker is handed the other.

import type { Repo } from '@automerge/automerge-repo/slim';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { WORKER_PEER } from './ids';

/** The hosts' Repos told to offer a worker's Repo nothing. */
const offeringNothing = new WeakSet<object>();

/**
 * Joins `repo` to a worker by `port`, the host's end of a MessageChannel, as
 * one of `repo`'s network adapters. The Repo gives the worker what it asks
 * for, as its own access rule says, and offers it nothing: a worker's Repo
 * (its peer id starts with WORKER_PEER) is not sent every open document.
 * Returns how to take the pipe out again.
 */
export function pipe(repo: Repo, port: MessagePort): () => void {
  if (!offeringNothing.has(repo)) {
    offeringNothing.add(repo);
    // The Repo's synchronizer holds this object, so it is changed in place, as core does for its public reader.
    const config = repo.shareConfig;
    const { announce } = config;
    config.announce = (peerId, documentId) => (String(peerId).startsWith(WORKER_PEER) ? Promise.resolve(false) : announce(peerId, documentId));
  }
  const adapter = new MessageChannelNetworkAdapter(port);
  repo.networkSubsystem.addNetworkAdapter(adapter);
  return () => {
    repo.networkSubsystem.removeNetworkAdapter(adapter);
    port.close();
  };
}
