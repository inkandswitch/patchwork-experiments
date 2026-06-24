/**
 * Automerge-backed simulation of CardTableDoc + CardTableKeysDoc.
 * Mirrors production mutations in src/crypto/{protocol,reveal,validate-keys}.ts.
 */

import * as Automerge from "@automerge/automerge";
import {
  createPlayer,
  DecryptionKey,
  EncodedDeck,
  encodeStandardCard,
  getStandard52Deck,
  decodeStandardCard,
  EncryptionKey,
  Player,
  PublicKey,
  ShamirRivestAdleman,
} from "mental-poker-toolkit";

export const CRYPTO_BITS = 32;
export const DECK_SIZE = 52;

// --- serialize (mirrors src/crypto/serialize.ts) ----------------------------

export function serializeSra(sra) {
  return {
    p: sra.publicKey.p.toString(),
    q: sra.publicKey.q.toString(),
    e: sra.encryptionKey.e.toString(),
    d: sra.decryptionKey.d.toString(),
  };
}

export function deserializeSra(data) {
  const publicKey = new PublicKey(BigInt(data.p), BigInt(data.q));
  const encryptionKey = new EncryptionKey(BigInt(data.e), publicKey.n);
  const decryptionKey = new DecryptionKey(BigInt(data.d), publicKey.n);
  return new ShamirRivestAdleman({ publicKey, encryptionKey, decryptionKey });
}

export function publicKeyToFields(key) {
  return { p: key.p.toString(), q: key.q.toString() };
}

export function publicKeyFromFields(fields) {
  return new PublicKey(BigInt(fields.p), BigInt(fields.q));
}

export function bigintStrings(values) {
  return values.map((value) => value.toString());
}

export function parseBigintStrings(values) {
  return values.map((value) => BigInt(value));
}

export function decryptionMaterial(sra) {
  return {
    d: sra.decryptionKey.d.toString(),
    n: sra.decryptionKey.n.toString(),
  };
}

export function decryptWithMaterial(cipher, material) {
  const key = new DecryptionKey(BigInt(material.d), BigInt(material.n));
  return key.decrypt(cipher);
}

// --- player key serde (mirrors src/crypto/player-keys.ts) -------------------

export function playerToStored(player, deckSize) {
  const individual = [];
  for (let offset = 0; offset < deckSize; offset++) {
    individual.push(serializeSra(player.getIndividualKey(offset)));
  }
  return { main: serializeSra(player.mainSraKey), individual };
}

export function storedToPlayer(stored) {
  const mainSraKey = deserializeSra(stored.main);
  const individualSraKeys = stored.individual.map(deserializeSra);
  return new Player({ mainSraKey, individualSraKeys });
}

export function writePlayerToKeyDoc(keyDoc, playerId, deckSize, player) {
  keyDoc["@patchwork"] = { type: "card-table-keys" };
  keyDoc.playerId = playerId;
  keyDoc.deckSize = deckSize;
  const stored = playerToStored(player, deckSize);
  keyDoc.main = { ...stored.main };
  keyDoc.individual = stored.individual.map((item) => ({ ...item }));
}

// --- validate-keys (mirrors src/crypto/validate-keys.ts) --------------------

export function playerMatchesTablePublicKey(doc, player) {
  if (!doc.publicKey) return true;
  return (
    player.publicKey.p.toString() === doc.publicKey.p &&
    player.publicKey.q.toString() === doc.publicKey.q
  );
}

export function keyShareIsValid(doc, material) {
  if (!doc.publicKey) return true;
  if (BigInt(material.n) !== publicKeyFromFields(doc.publicKey).n) return false;
  return material.shuffleId === doc.shuffleId;
}

// --- protocol helpers (mirrors src/crypto/protocol.ts) --------------------

function cloneShuffleParticipant(participant) {
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

function copyStringArray(values) {
  return values.map((value) => `${value}`);
}

export function sortedParticipants(doc) {
  return [...doc.shuffleParticipants].sort((a, b) => a.id.localeCompare(b.id));
}

export function ensureSortedParticipants(doc) {
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

function buildInitialDeck(deckSize) {
  const deck = getStandard52Deck().slice(0, deckSize);
  return new EncodedDeck(deck.map((card) => BigInt(encodeStandardCard(card))));
}

function clearDeck(doc) {
  const deck = doc.decks.find((entry) => entry.id === "deck");
  if (deck) deck.cards = [];
}

function fillDeck(doc) {
  const deck = doc.decks.find((entry) => entry.id === "deck");
  if (deck) deck.cards = Array.from({ length: doc.deckSize }, (_, i) => i);
}

function finishShuffle(doc) {
  if (doc.phase === "shuffle-verify" || doc.phase === "ready") return;
  if (!doc.workingDeck || doc.workingDeck.length !== doc.deckSize) return;
  doc.phase = "shuffle-verify";
  doc.shuffleTurn = 0;
  doc.publishedDeck = copyStringArray(doc.workingDeck);
}

export function advancePastCompletedTurns(doc) {
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

function advanceShuffleTurn(doc) {
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

export function runShuffleStep(doc, player, peerId) {
  const participant = doc.shuffleParticipants[doc.shuffleTurn];
  if (!participant || participant.id !== peerId || participant.shuffleDone) {
    return false;
  }
  if (!playerMatchesTablePublicKey(doc, player)) {
    throw new Error("player public key mismatch");
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
    const input = new EncodedDeck(parseBigintStrings(doc.workingDeck));
    const output = player.decryptAndEncryptIndividually(input);
    doc.workingDeck = copyStringArray(bigintStrings(output.cards));
  } else {
    throw new Error(`cannot shuffle in phase ${doc.phase}`);
  }

  participant.shuffleDone = true;
  advanceShuffleTurn(doc);
  return true;
}

export function startShuffle(doc) {
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

export function completeVerifiedShuffle(doc) {
  if (doc.phase !== "shuffle-verify") return;
  doc.phase = "ready";
  fillDeck(doc);
}

export function verifyShuffledDeck(doc, playersById) {
  if (
    !doc.publishedDeck?.length ||
    !doc.publicKey ||
    doc.publishedDeck.length !== doc.deckSize
  ) {
    return false;
  }

  let cipher = BigInt(doc.publishedDeck[0]);
  for (const participant of doc.shuffleParticipants) {
    const player = playersById.get(participant.id);
    if (!player || !playerMatchesTablePublicKey(doc, player)) return false;
    cipher = player.getIndividualKey(0).decrypt(cipher);
  }

  const value = Number(cipher);
  return Number.isSafeInteger(value) && value >= 1 && value <= 52;
}

// --- reveal helpers (mirrors src/crypto/reveal.ts) --------------------------

function offsetKey(offset) {
  return String(offset);
}

export function persistKeyShare(doc, offset, participantId, material) {
  if (!doc.keyShares) doc.keyShares = {};
  const bucket = offsetKey(offset);
  if (!doc.keyShares[bucket]) doc.keyShares[bucket] = {};
  doc.keyShares[bucket][participantId] = {
    d: material.d,
    n: material.n,
    shuffleId: material.shuffleId,
  };
}

function hasPlaintextShare(doc, offset, responderId) {
  const share = doc.keyShares?.[offsetKey(offset)]?.[responderId];
  if (!share) return false;
  return keyShareIsValid(doc, share);
}

export function gatherForeignKeys(doc, offset, localPeerId) {
  const map = new Map();
  const bucket = offsetKey(offset);
  const plaintext = doc.keyShares?.[bucket];
  if (!plaintext) return map;

  for (const [participantId, material] of Object.entries(plaintext)) {
    if (participantId === localPeerId) continue;
    if (!keyShareIsValid(doc, material)) continue;
    map.set(`${participantId}:${offset}`, {
      d: material.d,
      n: material.n,
      shuffleId: material.shuffleId,
    });
  }
  return map;
}

function formatCard(suit, rank) {
  if (!suit || !rank) return null;
  const symbols = { Heart: "♥", Diamond: "♦", Club: "♣", Spade: "♠" };
  return { suit, rank, label: `${rank}${symbols[suit] ?? suit[0]}` };
}

export function decryptOffset(
  publishedDeck,
  offset,
  participants,
  localPlayer,
  localPeerId,
  foreignKeys,
) {
  if (!publishedDeck[offset]) return null;
  let cipher = BigInt(publishedDeck[offset]);

  for (const participant of participants) {
    if (participant.id === localPeerId && localPlayer) {
      cipher = localPlayer.getIndividualKey(offset).decrypt(cipher);
      continue;
    }
    const material = foreignKeys.get(`${participant.id}:${offset}`);
    if (!material) return null;
    cipher = decryptWithMaterial(cipher, material);
  }

  const value = Number(cipher);
  if (!Number.isSafeInteger(value) || value < 1 || value > 52) return null;
  const card = decodeStandardCard(value);
  return formatCard(card.suit, card.rank);
}

export function tryDecryptFromDoc(doc, localPlayer, localPeerId, offset) {
  if (!doc.publishedDeck?.length) return null;
  if (!localPlayer || !playerMatchesTablePublicKey(doc, localPlayer)) return null;

  const foreignKeys = gatherForeignKeys(doc, offset, localPeerId);
  const needsForeign = doc.shuffleParticipants.some((p) => p.id !== localPeerId);
  if (needsForeign) {
    const missing = doc.shuffleParticipants.some(
      (p) => p.id !== localPeerId && !foreignKeys.has(`${p.id}:${offset}`),
    );
    if (missing) return null;
  }

  return decryptOffset(
    doc.publishedDeck,
    offset,
    sortedParticipants(doc),
    localPlayer,
    localPeerId,
    foreignKeys,
  );
}

export function publishAllKeyShares(doc, roster, offsets) {
  for (const offset of offsets) {
    for (const { id, player } of roster) {
      if (hasPlaintextShare(doc, offset, id)) continue;
      const material = {
        ...decryptionMaterial(player.getIndividualKey(offset)),
        shuffleId: doc.shuffleId,
      };
      persistKeyShare(doc, offset, id, material);
    }
  }
}

// --- Automerge table + in-memory key docs -----------------------------------

export function initTableAutomergeDoc() {
  return Automerge.change(Automerge.init(), (draft) => {
    draft["@patchwork"] = { type: "card-table" };
    draft.title = "Card Table";
    draft.deckSize = DECK_SIZE;
    draft.phase = "setup";
    draft.shuffleId = 0;
    draft.shuffleTurn = 0;
    draft.shuffleParticipants = [];
    draft.publicKey = null;
    draft.workingDeck = null;
    draft.publishedDeck = null;
    draft.decks = [
      {
        "@patchwork": { type: "secure-deck" },
        id: "deck",
        title: "Deck",
        cards: [],
      },
    ];
    draft.keyShares = {};
    draft.keyShareEnvelopes = {};
    draft.keyRequests = [];
    draft.hands = [];
    draft.piles = [];
  });
}

export function changeTable(doc, fn) {
  return Automerge.change(doc, (draft) => {
    fn(draft);
  });
}

export function joinParticipant(doc, id) {
  return changeTable(doc, (draft) => {
    if (draft.shuffleParticipants.some((p) => p.id === id)) return;
    draft.shuffleParticipants.push({
      id,
      readyToStart: false,
      keygenReady: false,
      shuffleDone: false,
      keyDocUrl: null,
      exchangePublicKey: null,
    });
  });
}

export function markReady(doc, id) {
  return changeTable(doc, (draft) => {
    const p = draft.shuffleParticipants.find((entry) => entry.id === id);
    if (p) p.readyToStart = true;
  });
}

export function linkKeyDoc(doc, peerId, keyDocUrl) {
  return changeTable(doc, (draft) => {
    const p = draft.shuffleParticipants.find((entry) => entry.id === peerId);
    if (p) {
      p.keyDocUrl = keyDocUrl;
      p.keygenReady = true;
    }
    if (draft.phase === "setup") draft.phase = "keygen";
  });
}

export async function createProtocolPlayers(ids) {
  const roster = [];
  let publicKey;
  for (let i = 0; i < ids.length; i++) {
    const player = await createPlayer({
      cards: DECK_SIZE,
      publicKey,
      bits: CRYPTO_BITS,
    });
    if (i === 0) publicKey = player.publicKey;
    roster.push({ id: ids[i], player });
  }
  return roster;
}

export function initKeyDocs(roster) {
  const keyDocs = new Map();
  for (const { id, player } of roster) {
    const url = `automerge:keys-${id}`;
    const doc = Automerge.change(Automerge.init(), (draft) => {
      writePlayerToKeyDoc(draft, id, DECK_SIZE, player);
    });
    keyDocs.set(url, { url, doc, player });
  }
  return keyDocs;
}

export function runOneShuffleStep(doc, roster) {
  return changeTable(doc, (draft) => {
    advancePastCompletedTurns(draft);
    const turn = draft.shuffleParticipants[draft.shuffleTurn];
    if (!turn || turn.shuffleDone) return;
    const entry = roster.find((r) => r.id === turn.id);
    if (!entry) throw new Error(`missing player for ${turn.id}`);
    runShuffleStep(draft, entry.player, turn.id);
  });
}

export function runFullShuffleOnDoc(doc, roster) {
  let current = changeTable(doc, (draft) => {
    startShuffle(draft);
  });

  while (
    current.phase === "shuffle-forward" ||
    current.phase === "shuffle-back"
  ) {
    const before = `${current.phase}:${current.shuffleTurn}`;
    current = runOneShuffleStep(current, roster);
    const after = `${current.phase}:${current.shuffleTurn}`;
    if (before === after) break;
  }

  return current;
}

export function referenceDecrypt(publishedDeck, offset, roster) {
  let cipher = BigInt(publishedDeck[offset]);
  for (const { player } of roster) {
    cipher = player.getIndividualKey(offset).decrypt(cipher);
  }
  const value = Number(cipher);
  if (!Number.isSafeInteger(value) || value < 1 || value > 52) return null;
  return decodeStandardCard(value);
}

/** Merge peer copies — simulates Automerge sync between two browsers. */
export function mergePeerDocs(docA, docB) {
  return Automerge.merge(docA, docB);
}
