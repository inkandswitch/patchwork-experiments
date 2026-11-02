import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createPlayer,
  EncodedDeck,
  encodeStandardCard,
  getStandard52Deck,
  Player,
} from "mental-poker-toolkit";
import {
  clearDeck,
  fillDeck,
} from "../ops/deck";
import type { CardTableDoc, CardTableKeysDoc } from "../types";
import { CRYPTO_BITS } from "../types";
import {
  bigintStrings,
  parseBigintStrings,
  publicKeyFromFields,
  publicKeyToFields,
} from "./serialize";
import {
  cachePlayer,
  ensureExchangeKeys,
  linkKeyDoc,
  loadLocalPlayer,
  loadPlayerFromKeyDoc,
  writePlayerToKeyDoc,
} from "./player-keys";
import { playerMatchesTablePublicKey } from "./validate-keys";
import type { ShuffleParticipant } from "../types";

/** Plain-object copy — required when reordering Automerge array entries. */
function cloneShuffleParticipant(
  participant: ShuffleParticipant,
): ShuffleParticipant {
  return {
    id: participant.id,
    readyToStart: participant.readyToStart,
    keygenReady: participant.keygenReady,
    shuffleDone: participant.shuffleDone,
    keyDocUrl: participant.keyDocUrl,
    exchangePublicKey: participant.exchangePublicKey
      ? {
          jwk: {
            kty: participant.exchangePublicKey.jwk.kty,
            n: participant.exchangePublicKey.jwk.n,
            e: participant.exchangePublicKey.jwk.e,
          },
        }
      : null,
  };
}

function copyStringArray(values: string[]): string[] {
  return values.map((value) => `${value}`);
}

/** Stable participant order — must match between shuffle and decrypt. */
export function sortedParticipants(doc: CardTableDoc) {
  return [...doc.shuffleParticipants].sort((a, b) => a.id.localeCompare(b.id));
}

export function hostParticipantId(doc: CardTableDoc): string | null {
  return sortedParticipants(doc)[0]?.id ?? null;
}

/** Persist lexicographic participant order (call inside handle.change). */
export function ensureSortedParticipants(doc: CardTableDoc): void {
  const sorted = [...doc.shuffleParticipants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(cloneShuffleParticipant);
  const changed = sorted.some(
    (participant, index) =>
      participant.id !== doc.shuffleParticipants[index]?.id,
  );
  if (changed) {
    doc.shuffleParticipants.splice(0, doc.shuffleParticipants.length, ...sorted);
  }
}

export function buildInitialDeck(deckSize: number): EncodedDeck {
  const deck = getStandard52Deck().slice(0, deckSize);
  return new EncodedDeck(
    deck.map((card) => BigInt(encodeStandardCard(card))),
  );
}

export async function ensureLocalPlayer(
  tableUrl: AutomergeUrl,
  tableHandle: DocHandle<CardTableDoc>,
  repo: Repo,
  peerId: string,
  doc: CardTableDoc,
): Promise<Player> {
  const hostId = hostParticipantId(doc);
  const participant = doc.shuffleParticipants.find((entry) => entry.id === peerId);
  if (!participant) {
    throw new Error("Join the table before generating keys");
  }

  if (participant.keyDocUrl) {
    const existing = await loadPlayerFromKeyDoc(repo, participant.keyDocUrl);
    if (existing) {
      const keyHandle = await repo.find<CardTableKeysDoc>(participant.keyDocUrl);
      await keyHandle.whenReady();
      await ensureExchangeKeys(tableHandle, keyHandle, peerId);
      return existing;
    }
    if (participant.keygenReady) {
      throw new Error(
        "Could not load your shuffle keys for this table. Create a new card table and shuffle again.",
      );
    }
  }

  if (hostId && peerId !== hostId && !doc.publicKey) {
    throw new Error("Waiting for host to publish the table public key");
  }

  const publicKey = doc.publicKey
    ? publicKeyFromFields(doc.publicKey)
    : undefined;

  const player = await createPlayer({
    cards: doc.deckSize,
    publicKey,
    bits: CRYPTO_BITS,
  });

  const keyHandle = repo.create<CardTableKeysDoc>();
  keyHandle.change((keyDoc) => {
    writePlayerToKeyDoc(keyDoc, tableUrl, peerId, doc.deckSize, player);
  });

  linkKeyDoc(tableHandle, peerId, keyHandle.url);
  cachePlayer(keyHandle.url, player);
  await ensureExchangeKeys(tableHandle, keyHandle, peerId);

  tableHandle.change((table) => {
    table.keyShares = {};
    table.keyShareEnvelopes = {};
    table.keyRequests = [];
  });

  return player;
}

export function isMyShuffleTurn(
  doc: CardTableDoc,
  peerId: string,
): boolean {
  const participant = doc.shuffleParticipants[doc.shuffleTurn];
  return participant?.id === peerId;
}

export function advanceShuffleTurn(doc: CardTableDoc) {
  const count = doc.shuffleParticipants.length;
  if (count === 0) return;

  if (doc.phase === "shuffle-forward") {
    if (doc.shuffleTurn >= count - 1) {
      doc.phase = "shuffle-back";
      doc.shuffleTurn = count - 1;
      for (const participant of doc.shuffleParticipants) {
        participant.shuffleDone = false;
      }
    } else {
      doc.shuffleTurn += 1;
    }
    return;
  }

  if (doc.phase === "shuffle-back") {
    if (doc.shuffleTurn <= 0) {
      finishShuffle(doc);
    } else {
      doc.shuffleTurn -= 1;
    }
  }
}

function finishShuffle(doc: CardTableDoc) {
  if (doc.phase === "shuffle-verify" || doc.phase === "ready") return;
  if (!doc.workingDeck || doc.workingDeck.length !== doc.deckSize) return;

  doc.phase = "shuffle-verify";
  doc.shuffleTurn = 0;
  doc.publishedDeck = copyStringArray(doc.workingDeck);
}

export function completeVerifiedShuffle(doc: CardTableDoc) {
  if (doc.phase !== "shuffle-verify") return;
  doc.phase = "ready";
  fillDeck(doc);
}

/**
 * Reshuffle an already-dealt table. Collects every card back, drops the reveal
 * state, and forces a fresh key generation + shuffle round (reusing the same
 * SRA keys would let anyone who saw a previously revealed card re-derive it,
 * since individual keys are position-indexed). Participants keep their seats and
 * `readyToStart`, so the new round runs automatically without re-readying.
 */
export function requestReshuffle(doc: CardTableDoc) {
  if (doc.phase !== "ready") return;

  // Gather every dealt card back to the (about to be refilled) deck and clear
  // any per-card reveals.
  for (const zone of doc.zones) {
    if (zone.cards.length > 0) zone.cards.splice(0, zone.cards.length);
    if (zone.revealedOffsets && zone.revealedOffsets.length > 0) {
      zone.revealedOffsets.splice(0, zone.revealedOffsets.length);
    }
  }

  doc.publicKey = null;
  doc.workingDeck = null;
  doc.publishedDeck = null;
  doc.keyShares = {};
  doc.keyShareEnvelopes = {};
  doc.keyRequests = [];
  for (const participant of doc.shuffleParticipants) {
    participant.shuffleDone = false;
    participant.keygenReady = false;
    participant.keyDocUrl = null;
  }

  // Back to keygen; useAutoInit regenerates keys and starts the shuffle.
  doc.phase = "keygen";
}

export function abortShuffle(doc: CardTableDoc) {
  doc.phase = "setup";
  doc.shuffleTurn = 0;
  doc.workingDeck = null;
  doc.publishedDeck = null;
  clearDeck(doc);
  doc.keyShares = {};
  doc.keyShareEnvelopes = {};
  doc.keyRequests = [];
  for (const participant of doc.shuffleParticipants) {
    participant.shuffleDone = false;
    participant.readyToStart = false;
  }
}

/** Reference decrypt offset 0 using every participant's key doc. */
export async function verifyShuffledDeck(
  repo: Repo,
  doc: CardTableDoc,
  localPeerId?: string,
): Promise<boolean> {
  if (
    !doc.publishedDeck?.length ||
    !doc.publicKey ||
    doc.publishedDeck.length !== doc.deckSize
  ) {
    return false;
  }

  let cipher = BigInt(doc.publishedDeck[0]);

  for (const participant of doc.shuffleParticipants) {
    if (!participant.keyDocUrl) return false;

    let player =
      participant.id === localPeerId
        ? await loadLocalPlayer(repo, doc, participant.id)
        : null;
    player ??= await loadPlayerFromKeyDoc(repo, participant.keyDocUrl, {
      waitAttempts: 8,
      waitMs: 300,
    });
    if (!player || !playerMatchesTablePublicKey(doc, player)) return false;
    cipher = player.getIndividualKey(0).decrypt(cipher);
  }

  const value = Number(cipher);
  return Number.isSafeInteger(value) && value >= 1 && value <= 52;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Retry verification while docs sync across peers. */
export async function verifyShuffledDeckWithRetry(
  repo: Repo,
  readDoc: () => CardTableDoc | undefined,
  localPeerId: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = options?.attempts ?? 15;
  const delayMs = options?.delayMs ?? 400;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const doc = readDoc();
    if (!doc || doc.phase !== "shuffle-verify") return false;

    if (doc.publishedDeck?.length === doc.deckSize) {
      const ok = await verifyShuffledDeck(repo, doc, localPeerId);
      if (ok) return true;
    }

    if (attempt < attempts - 1) await sleep(delayMs);
  }

  return false;
}

/** Advance past turns whose participant already has shuffleDone. */
export function advancePastCompletedTurns(doc: CardTableDoc): boolean {
  if (doc.phase !== "shuffle-forward" && doc.phase !== "shuffle-back") {
    return false;
  }

  let changed = false;
  const limit = doc.shuffleParticipants.length + 2;

  for (let i = 0; i < limit; i++) {
    const current = doc.shuffleParticipants[doc.shuffleTurn];
    if (!current?.shuffleDone) break;
    advanceShuffleTurn(doc);
    changed = true;
    if (doc.phase !== "shuffle-forward" && doc.phase !== "shuffle-back") {
      return true;
    }
  }

  return changed;
}

export function runShuffleStep(
  doc: CardTableDoc,
  player: Player,
  peerId: string,
): boolean {
  if (!isMyShuffleTurn(doc, peerId)) {
    return false;
  }

  const participant = doc.shuffleParticipants[doc.shuffleTurn];
  if (!participant) throw new Error("Missing shuffle participant");
  if (participant.shuffleDone) return false;

  if (!playerMatchesTablePublicKey(doc, player)) {
    throw new Error(
      "Your shuffle keys do not match this table's public key. Create a new card table and shuffle again.",
    );
  }

  if (doc.phase === "shuffle-forward") {
    const input =
      doc.workingDeck != null
        ? new EncodedDeck(parseBigintStrings(doc.workingDeck))
        : buildInitialDeck(doc.deckSize);

    const output = player.encryptAndShuffle(input);
    doc.workingDeck = copyStringArray(bigintStrings(output.cards));

    if (doc.shuffleTurn === 0 && !doc.publicKey) {
      doc.publicKey = publicKeyToFields(player.publicKey);
    }
  } else if (doc.phase === "shuffle-back") {
    if (!doc.workingDeck) throw new Error("Missing working deck");
    const input = new EncodedDeck(parseBigintStrings(doc.workingDeck));
    const output = player.decryptAndEncryptIndividually(input);
    doc.workingDeck = copyStringArray(bigintStrings(output.cards));
  } else {
    throw new Error(`Cannot shuffle in phase ${doc.phase}`);
  }

  participant.shuffleDone = true;
  advanceShuffleTurn(doc);
  return true;
}

export function tryStartShuffle(doc: CardTableDoc): boolean {
  if (doc.phase !== "keygen" || !allParticipantsReady(doc)) return false;
  startShuffle(doc);
  return true;
}

export const MAX_TABLE_PLAYERS = 8;

export function markReadyToStart(doc: CardTableDoc, peerId: string) {
  const participant = doc.shuffleParticipants.find((p) => p.id === peerId);
  if (!participant) throw new Error("Join the table before marking ready");
  if (doc.phase !== "setup") throw new Error("Game has already started");
  participant.readyToStart = true;
}

export function readyToStartCount(doc: CardTableDoc): number {
  return doc.shuffleParticipants.filter((p) => p.readyToStart === true).length;
}

export function allReadyToStart(doc: CardTableDoc): boolean {
  const count = doc.shuffleParticipants.length;
  return count >= 2 && doc.shuffleParticipants.every((p) => p.readyToStart === true);
}

export function markKeygenReady(doc: CardTableDoc, peerId: string) {
  const participant = doc.shuffleParticipants.find((p) => p.id === peerId);
  if (!participant) throw new Error("Join the table before generating keys");
  participant.keygenReady = true;
}

export function allParticipantsReady(doc: CardTableDoc): boolean {
  return (
    doc.shuffleParticipants.length >= 2 &&
    doc.shuffleParticipants.every((p) => p.keygenReady && p.keyDocUrl)
  );
}

export function canJoinTable(doc: CardTableDoc): boolean {
  return (
    doc.phase === "setup" &&
    doc.shuffleParticipants.length < MAX_TABLE_PLAYERS
  );
}

export function startShuffle(doc: CardTableDoc) {
  if (!allParticipantsReady(doc)) {
    throw new Error("All participants must finish key generation first");
  }
  ensureSortedParticipants(doc);
  doc.shuffleId += 1;
  doc.phase = "shuffle-forward";
  doc.shuffleTurn = 0;
  doc.workingDeck = null;
  doc.publishedDeck = null;
  clearDeck(doc);
  doc.keyShares = {};
  doc.keyShareEnvelopes = {};
  doc.keyRequests = [];
  for (const participant of doc.shuffleParticipants) {
    participant.shuffleDone = false;
  }
}
