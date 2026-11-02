import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Player } from "mental-poker-toolkit";
import {
  advancePastCompletedTurns,
  allReadyToStart,
  canJoinTable,
  completeVerifiedShuffle,
  ensureLocalPlayer,
  ensureSortedParticipants,
  hostParticipantId,
  isMyShuffleTurn,
  markKeygenReady,
  runShuffleStep,
  tryStartShuffle,
  verifyShuffledDeckWithRetry,
} from "../crypto/protocol";
import { loadExchangePrivateKey, loadLocalPlayer } from "../crypto/player-keys";
import { publishKeyShares, requestCardDecryption } from "../crypto/reveal";
import { publicKeyToFields } from "../crypto/serialize";
import type { CardTableDoc, CardZone, DecryptedCard } from "../types";

const DEFAULT_TIMEOUT_MS = 60000;

/** Resolve after the doc changes (predicate true) or after `timeoutMs`. */
function waitForChange(
  handle: DocHandle<CardTableDoc>,
  predicate: (doc: CardTableDoc | undefined) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate(handle.doc())) {
      resolve(true);
      return;
    }
    const finish = (value: boolean) => {
      handle.off("change", onChange);
      window.clearTimeout(timer);
      window.clearInterval(poll);
      resolve(value);
    };
    const onChange = () => {
      if (predicate(handle.doc())) finish(true);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    const poll = window.setInterval(onChange, 250);
    handle.on("change", onChange);
  });
}

/** Add the agent to the roster (if room) and mark it ready to start. */
export function joinTable(handle: DocHandle<CardTableDoc>, agentId: string) {
  const doc = handle.doc();
  if (!doc) throw new Error("Table document is not available");
  const already = doc.shuffleParticipants.some((p) => p.id === agentId);
  if (!already && !canJoinTable(doc)) {
    throw new Error(
      doc.phase === "setup"
        ? "The table is full"
        : "The game has already started — cannot join now",
    );
  }
  handle.change((draft) => {
    let me = draft.shuffleParticipants.find((p) => p.id === agentId);
    if (!me) {
      draft.shuffleParticipants.push({
        id: agentId,
        readyToStart: false,
        keygenReady: false,
        shuffleDone: false,
        keyDocUrl: null,
        exchangePublicKey: null,
      });
      me = draft.shuffleParticipants.find((p) => p.id === agentId);
    }
    if (me && draft.phase === "setup") me.readyToStart = true;
  });
}

async function runVerify(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
): Promise<void> {
  const ok = await verifyShuffledDeckWithRetry(repo, () => handle.doc(), agentId);
  if (ok) handle.change((draft) => completeVerifiedShuffle(draft));
  // On failure we leave the doc alone; a human participant's hook will abort.
}

/**
 * Perform one slice of the agent's keygen/shuffle responsibilities. Mirrors the
 * `runInit` body of the browser's `useAutoInit`, but as a plain async step the
 * agent loop can call repeatedly.
 */
async function runProtocolStep(
  tableUrl: AutomergeUrl,
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
): Promise<void> {
  const latest = () => handle.doc();
  const doc = latest();
  if (!doc) return;

  const me = doc.shuffleParticipants.find((p) => p.id === agentId);
  if (!me) throw new Error("Agent is not seated at this table");

  if (doc.phase === "shuffle-verify") {
    await runVerify(handle, repo, agentId);
    return;
  }

  // Keygen: create our SRA player + exchange keys, then mark ready.
  if (!me.keygenReady || !me.keyDocUrl) {
    const hostId = hostParticipantId(doc);
    if (hostId && agentId !== hostId && !doc.publicKey) return; // wait for host pk

    const player = await ensureLocalPlayer(tableUrl, handle, repo, agentId, doc);
    const meAfter = latest()?.shuffleParticipants.find((p) => p.id === agentId);
    if (!meAfter || meAfter.keygenReady) return;

    handle.change((draft) => {
      ensureSortedParticipants(draft);
      const entry = draft.shuffleParticipants.find((p) => p.id === agentId);
      if (!entry || entry.keygenReady) return;
      markKeygenReady(draft, agentId);
      if (!draft.publicKey && hostParticipantId(draft) === agentId) {
        draft.publicKey = publicKeyToFields(player.publicKey);
      }
      if (draft.phase === "setup") draft.phase = "keygen";
    });
    return;
  }

  // Everyone has keys — try to start the shuffle (no-op until all ready).
  handle.change((draft) => {
    ensureSortedParticipants(draft);
    advancePastCompletedTurns(draft);
    tryStartShuffle(draft);
  });

  const afterStart = latest();
  if (!afterStart || afterStart.phase === "ready") return;
  if (afterStart.phase === "shuffle-verify") {
    await runVerify(handle, repo, agentId);
    return;
  }
  if (
    afterStart.phase !== "shuffle-forward" &&
    afterStart.phase !== "shuffle-back"
  ) {
    return;
  }

  const turnParticipant = afterStart.shuffleParticipants[afterStart.shuffleTurn];
  if (turnParticipant?.shuffleDone) {
    handle.change((draft) => {
      ensureSortedParticipants(draft);
      advancePastCompletedTurns(draft);
    });
    if (latest()?.phase === "shuffle-verify") await runVerify(handle, repo, agentId);
    return;
  }

  if (!isMyShuffleTurn(afterStart, agentId)) return;

  const player = await ensureLocalPlayer(
    tableUrl,
    handle,
    repo,
    agentId,
    afterStart,
  );
  handle.change((draft) => {
    ensureSortedParticipants(draft);
    advancePastCompletedTurns(draft);
    runShuffleStep(draft, player, agentId);
  });
  if (latest()?.phase === "shuffle-verify") await runVerify(handle, repo, agentId);
}

export type AdvanceResult = {
  phase: CardTableDoc["phase"];
  ready: boolean;
  status: string;
};

/**
 * Drive the agent's half of keygen + shuffle until the deck is ready (or the
 * timeout elapses). Requires every other seated player's client to be running
 * the protocol too (i.e. their card-table tool is open and readied up).
 */
export async function advanceProtocol(
  tableUrl: AutomergeUrl,
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AdvanceResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const doc = handle.doc();
    if (!doc) break;
    if (doc.phase === "ready") break;

    if (!doc.shuffleParticipants.some((p) => p.id === agentId)) {
      throw new Error("Agent is not seated at this table — call join() first");
    }

    if (doc.phase === "setup" && !allReadyToStart(doc)) {
      await waitForChange(
        handle,
        (d) => !d || d.phase !== "setup" || allReadyToStart(d),
        Math.min(4000, Math.max(0, deadline - Date.now())),
      );
      continue;
    }

    const beforePhase = doc.phase;
    const beforeTurn = doc.shuffleTurn;
    await runProtocolStep(tableUrl, handle, repo, agentId);

    await waitForChange(
      handle,
      (d) =>
        !d ||
        d.phase === "ready" ||
        d.phase !== beforePhase ||
        d.shuffleTurn !== beforeTurn,
      Math.min(2000, Math.max(0, deadline - Date.now())),
    );
  }

  const finalDoc = handle.doc();
  const phase = finalDoc?.phase ?? "setup";
  // Once ready, immediately publish shares so opponents can read their hands.
  if (phase === "ready") await publishOwnShares(handle, repo, agentId);
  return {
    phase,
    ready: phase === "ready",
    status: describePhase(finalDoc, agentId),
  };
}

function describePhase(doc: CardTableDoc | undefined, agentId: string): string {
  if (!doc) return "Table unavailable";
  switch (doc.phase) {
    case "setup": {
      const total = doc.shuffleParticipants.length;
      const ready = doc.shuffleParticipants.filter((p) => p.readyToStart).length;
      if (total < 2) return `Waiting for another player (${total} seated)`;
      return `Waiting for everyone to ready up (${ready}/${total})`;
    }
    case "keygen":
      return "Generating keys";
    case "shuffle-forward":
    case "shuffle-back": {
      const current = doc.shuffleParticipants[doc.shuffleTurn];
      if (current?.id === agentId) return "Running the agent's shuffle step";
      return "Waiting for another player to shuffle";
    }
    case "shuffle-verify":
      return "Verifying the shuffle";
    case "ready":
      return "Deck is shuffled and ready";
    default:
      return doc.phase;
  }
}

/**
 * Offsets the agent should share keys for: every card that is NOT in one of the
 * agent's own private hands and NOT still hidden in the deck. Publishing the
 * agent's share for these lets other players read their own hands and any public
 * cards — without exposing the agent's own hand or the undealt deck.
 */
function shareableOffsets(doc: CardTableDoc, agentId: string): number[] {
  const offsets = new Set<number>();
  for (const zone of doc.zones) {
    if (zone.role === "deck") continue; // never share undealt deck cards
    if (zone.ownerId === agentId) continue; // keep the agent's own hand private
    for (const offset of zone.cards) offsets.add(offset);
  }
  return [...offsets];
}

/**
 * Publish the agent's key shares for every card other players legitimately need
 * to read (their hands + public cards). Because the agent only runs during a
 * chat turn — unlike a human's always-on client — it must publish proactively so
 * the human can decrypt later without waiting for the agent to be online.
 * Returns the number of offsets shared.
 */
export async function publishOwnShares(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
): Promise<number> {
  const doc = handle.doc();
  if (!doc || doc.phase !== "ready") return 0;
  if (!doc.shuffleParticipants.some((p) => p.id === agentId)) return 0;
  const player = await loadLocalPlayer(repo, doc, agentId);
  if (!player) return 0;

  const offsets = shareableOffsets(doc, agentId);
  if (offsets.length === 0) return 0;
  await publishKeyShares(handle, doc, player, agentId, offsets);
  return offsets.length;
}

/**
 * Cooperative "stay online" window: keep the agent's shares up to date as the
 * table changes (e.g. while a human draws or reveals), for `durationMs`.
 */
export async function serviceKeyRequests(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
  durationMs = 0,
): Promise<number> {
  let shared = await publishOwnShares(handle, repo, agentId);
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await waitForChange(
      handle,
      () => false, // wake on any change
      Math.min(1000, Math.max(0, deadline - Date.now())),
    );
    shared += await publishOwnShares(handle, repo, agentId);
  }
  return shared;
}

export type RevealedCard = {
  zoneId: string;
  zoneTitle: string;
  offset: number;
  card: string | null;
};

/** Decrypt a set of offsets within a zone, gathering shares as needed. */
async function decryptOffsets(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
  zone: CardZone,
  offsets: number[],
  timeoutMs: number,
): Promise<RevealedCard[]> {
  const doc = handle.doc();
  if (!doc) return [];
  const player: Player | null = await loadLocalPlayer(repo, doc, agentId);
  const exchangeKey = await loadExchangePrivateKey(repo, doc, agentId);

  const out: RevealedCard[] = [];
  for (const offset of offsets) {
    let card: DecryptedCard | null = null;
    try {
      card = await requestCardDecryption(
        handle,
        handle.doc() ?? doc,
        player,
        agentId,
        offset,
        exchangeKey,
        timeoutMs,
      );
    } catch {
      card = null;
    }
    out.push({
      zoneId: zone.id,
      zoneTitle: zone.title,
      offset,
      card: card ? card.label : null,
    });
  }
  return out;
}

/** Read every publicly-visible card (face-up zones + per-card reveals). */
export async function readPublicCards(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
  timeoutMs = 15000,
): Promise<RevealedCard[]> {
  const doc = handle.doc();
  if (!doc) return [];
  const results: RevealedCard[] = [];
  for (const zone of doc.zones) {
    if (zone.role === "deck") continue;
    const revealed = new Set(zone.revealedOffsets ?? []);
    const offsets = zone.faceUp
      ? [...zone.cards]
      : zone.cards.filter((offset) => revealed.has(offset));
    if (offsets.length === 0) continue;
    results.push(
      ...(await decryptOffsets(handle, repo, agentId, zone, offsets, timeoutMs)),
    );
  }
  return results;
}

/** Read the agent's own private hand(s). */
export async function readOwnCards(
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  agentId: string,
  timeoutMs = 15000,
): Promise<RevealedCard[]> {
  const doc = handle.doc();
  if (!doc) return [];
  const results: RevealedCard[] = [];
  for (const zone of doc.zones) {
    if (zone.role === "deck" || zone.ownerId !== agentId) continue;
    results.push(
      ...(await decryptOffsets(
        handle,
        repo,
        agentId,
        zone,
        [...zone.cards],
        timeoutMs,
      )),
    );
  }
  return results;
}
