import type { DocHandle } from "@automerge/automerge-repo";
import { decodeStandardCard, Player } from "mental-poker-toolkit";
import {
  decryptKeyShare,
  encryptKeyShare,
  importExchangePublicKey,
} from "./exchange-keys";
import { cryptoLog } from "./debug-log";
import { decryptionMaterial, decryptWithMaterial } from "./serialize";
import {
  keyShareIsValid,
  keyShareMatchesTable,
  logKeyShareMismatch,
  logPlayerMismatch,
  playerMatchesTablePublicKey,
} from "./validate-keys";
import { sortedParticipants } from "./protocol";
import type {
  CardTableDoc,
  DecryptedCard,
  IndividualKeyShare,
  SecureHandZone,
  ShuffleParticipant,
} from "../types";
import { suitSymbol } from "../types";

const log = cryptoLog("reveal");

function offsetKey(offset: number): string {
  return String(offset);
}

export function persistKeyShare(
  doc: CardTableDoc,
  offset: number,
  participantId: string,
  material: IndividualKeyShare,
) {
  if (!doc.keyShares) doc.keyShares = {};
  const bucket = offsetKey(offset);
  if (!doc.keyShares[bucket]) doc.keyShares[bucket] = {};
  doc.keyShares[bucket][participantId] = {
    d: material.d,
    n: material.n,
    shuffleId: material.shuffleId ?? doc.shuffleId ?? 0,
  };
}

function persistEncryptedShare(
  doc: CardTableDoc,
  offset: number,
  responderId: string,
  recipientId: string,
  ct: string,
) {
  if (!doc.keyShareEnvelopes) doc.keyShareEnvelopes = {};
  const bucket = offsetKey(offset);
  if (!doc.keyShareEnvelopes[bucket]) doc.keyShareEnvelopes[bucket] = {};
  if (!doc.keyShareEnvelopes[bucket][responderId]) {
    doc.keyShareEnvelopes[bucket][responderId] = {};
  }
  doc.keyShareEnvelopes[bucket][responderId][recipientId] = { ct };
}

function hasPlaintextShare(
  doc: CardTableDoc,
  offset: number,
  responderId: string,
): boolean {
  const bucket = offsetKey(offset);
  const share = doc.keyShares?.[bucket]?.[responderId];
  if (!share) return false;
  return keyShareMatchesTable(doc, share);
}

function hasPublishedShare(
  doc: CardTableDoc,
  offset: number,
  responderId: string,
  recipientId: string,
): boolean {
  if (hasPlaintextShare(doc, offset, responderId)) return true;
  const bucket = offsetKey(offset);
  return !!doc.keyShareEnvelopes?.[bucket]?.[responderId]?.[recipientId];
}

export async function gatherForeignKeys(
  doc: CardTableDoc,
  offset: number,
  localPeerId: string,
  exchangePrivateKey: CryptoKey | null,
): Promise<Map<string, IndividualKeyShare>> {
  const map = new Map<string, IndividualKeyShare>();
  const bucket = offsetKey(offset);

  const plaintext = doc.keyShares?.[bucket];
  if (plaintext) {
    for (const [participantId, material] of Object.entries(plaintext)) {
      if (participantId === localPeerId) continue;
      if (!keyShareMatchesTable(doc, material)) {
        logKeyShareMismatch(doc, material, participantId, offset);
        continue;
      }
      map.set(`${participantId}:${offset}`, material);
    }
  }

  const envelopes = doc.keyShareEnvelopes?.[bucket];
  if (envelopes && exchangePrivateKey) {
    for (const [responderId, byRecipient] of Object.entries(envelopes)) {
      if (responderId === localPeerId) continue;
      const key = `${responderId}:${offset}`;
      if (map.has(key)) continue;
      const encrypted = byRecipient[localPeerId];
      if (!encrypted) continue;
      try {
        const material = await decryptKeyShare(exchangePrivateKey, encrypted.ct);
        if (!keyShareMatchesTable(doc, material)) {
          logKeyShareMismatch(doc, material, responderId, offset);
          continue;
        }
        map.set(key, material);
        log.debug("gatherForeignKeys: decrypted envelope", {
          offset,
          responderId,
          localPeerId,
        });
      } catch (error) {
        log.warn("gatherForeignKeys: envelope decrypt failed", {
          offset,
          responderId,
          localPeerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  log.debug("gatherForeignKeys", {
    offset,
    localPeerId,
    hasExchangePrivateKey: !!exchangePrivateKey,
    plaintextCount: plaintext ? Object.keys(plaintext).length - (plaintext[localPeerId] ? 1 : 0) : 0,
    foreignKeyCount: map.size,
    foreignParticipants: [...map.keys()],
  });

  return map;
}

export function missingKeyParticipants(
  doc: CardTableDoc,
  offset: number,
  localPeerId: string,
): ShuffleParticipant[] {
  return doc.shuffleParticipants.filter((participant) => {
    if (participant.id === localPeerId) return false;
    return !hasPlaintextShare(doc, offset, participant.id);
  });
}

export function hasAllForeignKeys(
  doc: CardTableDoc,
  offset: number,
  localPeerId: string,
): boolean {
  return missingKeyParticipants(doc, offset, localPeerId).length === 0;
}

export function formatCard(
  suit: string | undefined,
  rank: string | undefined,
): DecryptedCard | null {
  if (!suit || !rank) return null;
  const symbol = suitSymbol[suit] ?? suit[0];
  return {
    suit,
    rank,
    label: `${rank}${symbol}`,
  };
}

export function decryptOffset(
  publishedDeck: string[],
  offset: number,
  participants: ShuffleParticipant[],
  localPlayer: Player | null,
  localPeerId: string,
  foreignKeys: Map<string, IndividualKeyShare>,
): DecryptedCard | null {
  if (!publishedDeck[offset]) return null;

  let cipher = BigInt(publishedDeck[offset]);
  log.debug("decryptOffset: start", {
    offset,
    localPeerId,
    initialCipher: cipher.toString(),
    participantOrder: participants.map((p) => p.id),
  });

  for (const participant of participants) {
    if (participant.id === localPeerId && localPlayer) {
      const before = cipher.toString();
      cipher = localPlayer.getIndividualKey(offset).decrypt(cipher);
      log.debug("decryptOffset: local key", {
        offset,
        localPeerId,
        participantId: participant.id,
        cipherBefore: before,
        cipherAfter: cipher.toString(),
      });
      continue;
    }
    const material = foreignKeys.get(`${participant.id}:${offset}`);
    if (!material) {
      log.debug("decryptOffset: missing foreign material", {
        offset,
        localPeerId,
        participantId: participant.id,
      });
      return null;
    }
    const before = cipher.toString();
    cipher = decryptWithMaterial(cipher, material);
    log.debug("decryptOffset: foreign key", {
      offset,
      localPeerId,
      participantId: participant.id,
      cipherBefore: before,
      cipherAfter: cipher.toString(),
      shareN: material.n,
    });
  }

  const value = Number(cipher);
  if (!Number.isSafeInteger(value) || value < 1 || value > 52) {
    log.warn("decryptOffset: invalid card value", {
      offset,
      value: String(cipher),
      localPeerId,
      foreignParticipants: [...foreignKeys.keys()],
    });
    return null;
  }

  const card = decodeStandardCard(value);
  return formatCard(card.suit, card.rank);
}

function isLocalParticipant(
  doc: CardTableDoc,
  localPeerId: string,
): boolean {
  return doc.shuffleParticipants.some((participant) => participant.id === localPeerId);
}

export async function tryDecryptFromDoc(
  doc: CardTableDoc,
  localPlayer: Player | null,
  localPeerId: string,
  offset: number,
  exchangePrivateKey: CryptoKey | null,
): Promise<DecryptedCard | null> {
  if (!doc.publishedDeck?.length) {
    log.debug("tryDecryptFromDoc: no published deck", { offset, localPeerId });
    return null;
  }
  if (isLocalParticipant(doc, localPeerId) && !localPlayer) {
    log.warn("tryDecryptFromDoc: shuffle participant but no local player", {
      offset,
      localPeerId,
    });
    return null;
  }

  if (localPlayer && !playerMatchesTablePublicKey(doc, localPlayer)) {
    logPlayerMismatch(doc, localPlayer, localPeerId);
    return null;
  }

  const needsForeign = doc.shuffleParticipants.some(
    (participant) => participant.id !== localPeerId,
  );

  const foreignKeys = await gatherForeignKeys(
    doc,
    offset,
    localPeerId,
    exchangePrivateKey,
  );

  if (needsForeign) {
    const missing = doc.shuffleParticipants.filter(
      (participant) =>
        participant.id !== localPeerId &&
        !foreignKeys.has(`${participant.id}:${offset}`),
    );
    if (missing.length > 0) {
      log.info("tryDecryptFromDoc: missing foreign keys", {
        offset,
        localPeerId,
        missing: missing.map((p) => p.id),
        hasExchangePrivateKey: !!exchangePrivateKey,
        plaintextShares: Object.keys(doc.keyShares?.[offsetKey(offset)] ?? {}).filter(
          (id) => id !== localPeerId,
        ),
      });
      return null;
    }
  }

  const card = decryptOffset(
    doc.publishedDeck,
    offset,
    sortedParticipants(doc),
    localPlayer,
    localPeerId,
    foreignKeys,
  );
  if (card) {
    log.debug("tryDecryptFromDoc: success", {
      offset,
      localPeerId,
      card: card.label,
    });
  } else {
    log.warn("tryDecryptFromDoc: decryptOffset returned null", {
      offset,
      localPeerId,
      participantCount: doc.shuffleParticipants.length,
      foreignKeyCount: foreignKeys.size,
    });
  }
  return card;
}

export function submitKeyRequests(
  handle: DocHandle<CardTableDoc>,
  localPeerId: string,
  offsets: number[],
) {
  if (offsets.length === 0) return;

  log.info("submitKeyRequests", {
    localPeerId,
    offsets,
    existingRequestCount: handle.doc()?.keyRequests?.length ?? 0,
  });

  handle.change((draft) => {
    if (!draft.keyRequests) draft.keyRequests = [];
    for (const offset of offsets) {
      const already = draft.keyRequests.some(
        (request) =>
          request.requesterId === localPeerId && request.offset === offset,
      );
      if (already) continue;
      draft.keyRequests.push({
        requestId: crypto.randomUUID(),
        offset,
        requesterId: localPeerId,
        createdAt: Date.now(),
      });
    }
  });
}

async function publishKeyShare(
  handle: DocHandle<CardTableDoc>,
  doc: CardTableDoc,
  player: Player,
  responderId: string,
  recipientId: string,
  offset: number,
) {
  if (!playerMatchesTablePublicKey(doc, player)) {
    logPlayerMismatch(doc, player, responderId);
    throw new Error(
      "Cannot publish key shares — your shuffle keys do not match this table.",
    );
  }

  if (hasPlaintextShare(doc, offset, responderId)) {
    log.debug("publishKeyShare: already published", {
      offset,
      responderId,
      recipientId,
    });
    return;
  }

  const material = decryptionMaterial(player.getIndividualKey(offset));

  // Plaintext on the table doc is the reliable path — encrypted envelopes are
  // optional and can become undecipherable if exchange keys are rotated.
  handle.change((draft) => {
    persistKeyShare(draft, offset, responderId, material);
  });
  log.info("publishKeyShare: plaintext share written", {
    offset,
    responderId,
    recipientId,
  });

  const recipient = doc.shuffleParticipants.find(
    (participant) => participant.id === recipientId,
  );
  if (!recipient?.exchangePublicKey?.jwk?.n) {
    log.debug("publishKeyShare: skip envelope (no recipient exchange key)", {
      offset,
      responderId,
      recipientId,
      hasRecipient: !!recipient,
    });
    return;
  }

  try {
    const publicKey = await importExchangePublicKey(recipient.exchangePublicKey);
    const ct = await encryptKeyShare(publicKey, material);
    handle.change((draft) => {
      persistEncryptedShare(draft, offset, responderId, recipientId, ct);
    });
    log.debug("publishKeyShare: encrypted envelope written", {
      offset,
      responderId,
      recipientId,
    });
  } catch (error) {
    log.warn("publishKeyShare: envelope encrypt failed (plaintext ok)", {
      offset,
      responderId,
      recipientId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Respond to synced key requests by posting encrypted shares on the table doc. */
export async function fulfillKeyRequests(
  handle: DocHandle<CardTableDoc>,
  doc: CardTableDoc,
  player: Player,
  localPeerId: string,
) {
  if (!doc.keyRequests?.length) return;

  const pending = doc.keyRequests.filter((r) => r.requesterId !== localPeerId);
  log.info("fulfillKeyRequests", {
    localPeerId,
    totalRequests: doc.keyRequests.length,
    pendingForOthers: pending.length,
    pending: pending.map((r) => ({
      offset: r.offset,
      requesterId: r.requesterId,
    })),
  });

  for (const request of doc.keyRequests) {
    if (request.requesterId === localPeerId) continue;
    const latest = handle.doc() ?? doc;
    if (hasPlaintextShare(latest, request.offset, localPeerId)) {
      log.debug("fulfillKeyRequests: already fulfilled", {
        offset: request.offset,
        requesterId: request.requesterId,
        localPeerId,
      });
      continue;
    }
    log.info("fulfillKeyRequests: publishing share", {
      offset: request.offset,
      requesterId: request.requesterId,
      localPeerId,
    });
    await publishKeyShare(
      handle,
      latest,
      player,
      localPeerId,
      request.requesterId,
      request.offset,
    );
  }
}

function waitForDocUpdate(
  handle: DocHandle<CardTableDoc>,
  shouldStop: () => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (shouldStop()) {
      resolve();
      return;
    }

    const onChange = () => {
      if (shouldStop()) done();
    };

    const timer = window.setTimeout(done, timeoutMs);
    const interval = window.setInterval(onChange, 200);
    handle.on("change", onChange);

    function done() {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      handle.off("change", onChange);
      resolve();
    }
  });
}

export async function requestCardDecryption(
  handle: DocHandle<CardTableDoc>,
  doc: CardTableDoc,
  localPlayer: Player | null,
  localPeerId: string,
  offset: number,
  exchangePrivateKey: CryptoKey | null,
  timeoutMs = 15000,
): Promise<DecryptedCard | null> {
  log.info("requestCardDecryption: start", { offset, localPeerId, timeoutMs });

  const initial = await tryDecryptFromDoc(
    doc,
    localPlayer,
    localPeerId,
    offset,
    exchangePrivateKey,
  );
  if (initial) {
    log.info("requestCardDecryption: immediate success", { offset, localPeerId });
    return initial;
  }

  const missingBefore = missingKeyParticipants(doc, offset, localPeerId);
  if (missingBefore.length === 0) {
    log.warn("requestCardDecryption: no missing participants but decrypt failed", {
      offset,
      localPeerId,
    });
    return tryDecryptFromDoc(
      doc,
      localPlayer,
      localPeerId,
      offset,
      exchangePrivateKey,
    );
  }

  log.info("requestCardDecryption: waiting for shares", {
    offset,
    localPeerId,
    missing: missingBefore.map((p) => p.id),
  });

  submitKeyRequests(handle, localPeerId, [offset]);

  await waitForDocUpdate(
    handle,
    () => {
      const latest = handle.doc();
      if (!latest) return true;
      return missingKeyParticipants(latest, offset, localPeerId).length === 0;
    },
    timeoutMs,
  );

  const latest = handle.doc() ?? doc;
  const missingAfter = missingKeyParticipants(latest, offset, localPeerId);
  if (missingAfter.length > 0) {
    log.warn("requestCardDecryption: timed out waiting for shares", {
      offset,
      localPeerId,
      timeoutMs,
      stillMissing: missingAfter.map((p) => p.id),
      keyRequests: (latest.keyRequests ?? []).filter((r) => r.offset === offset),
      plaintextShares: Object.keys(latest.keyShares?.[offsetKey(offset)] ?? {}),
    });
  }

  const result = await tryDecryptFromDoc(
    latest,
    localPlayer,
    localPeerId,
    offset,
    exchangePrivateKey,
  );
  log.info("requestCardDecryption: done", {
    offset,
    localPeerId,
    success: !!result,
    card: result?.label,
  });
  return result;
}

export function keyMaterialDigest(
  doc: CardTableDoc,
  offsets: number[],
  localPeerId: string,
): string {
  return offsets
    .map((offset) => {
      const bucket = offsetKey(offset);
      return JSON.stringify({
        shares: doc.keyShares?.[bucket] ?? null,
        envelopes: doc.keyShareEnvelopes?.[bucket] ?? null,
        requests: (doc.keyRequests ?? []).filter(
          (request) => request.offset === offset,
        ),
        localPeerId,
      });
    })
    .join("|");
}

/** @deprecated use keyMaterialDigest */
export function keyShareDigest(doc: CardTableDoc, offsets: number[]): string {
  return keyMaterialDigest(doc, offsets, "");
}

/** Offsets in this hand that are visible to non-owners. */
export function revealedOffsetsForHand(hand: SecureHandZone): Set<number> {
  const set = new Set(hand.revealedOffsets ?? []);
  if (hand.revealed) {
    for (const offset of hand.cards) set.add(offset);
  }
  return set;
}

/** Owner publishes one card's key material so other players can decrypt it. */
export async function publishCardReveal(
  handle: DocHandle<CardTableDoc>,
  doc: CardTableDoc,
  handId: string,
  ownerId: string,
  player: Player,
  offset: number,
) {
  const hand = doc.hands.find((entry) => entry.id === handId);
  if (!hand) throw new Error(`Hand not found: ${handId}`);
  if (hand.ownerId !== ownerId) {
    throw new Error("Only the hand owner can reveal cards");
  }
  if (!hand.cards.includes(offset)) {
    throw new Error("Card is not in this hand");
  }

  handle.change((draft) => {
    const target = draft.hands.find((entry) => entry.id === handId);
    if (!target) return;
    if (!target.revealedOffsets) target.revealedOffsets = [];
    if (!target.revealedOffsets.includes(offset)) {
      target.revealedOffsets.push(offset);
    }
  });

  for (const participant of doc.shuffleParticipants) {
    if (participant.id === ownerId) continue;
    await publishKeyShare(
      handle,
      handle.doc() ?? doc,
      player,
      ownerId,
      participant.id,
      offset,
    );
  }
}
