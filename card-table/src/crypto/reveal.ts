import type { DocHandle } from "@automerge/automerge-repo";
import { decodeStandardCard, Player } from "mental-poker-toolkit";
import {
  decryptKeyShare,
  encryptKeyShare,
  importExchangePublicKey,
} from "./exchange-keys";
import { decryptionMaterial, decryptWithMaterial } from "./serialize";
import {
  keyShareIsValid,
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
    shuffleId: material.shuffleId,
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
  return keyShareIsValid(doc, share);
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
      if (!keyShareIsValid(doc, material)) continue;
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
        if (!keyShareIsValid(doc, material)) continue;
        map.set(key, material);
      } catch {
        // Envelope decrypt failed — plaintext share may still be available.
      }
    }
  }

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

export async function tryDecryptFromDoc(
  doc: CardTableDoc,
  localPlayer: Player | null,
  localPeerId: string,
  offset: number,
  exchangePrivateKey: CryptoKey | null,
): Promise<DecryptedCard | null> {
  if (!doc.publishedDeck?.length) return null;

  const isParticipant = doc.shuffleParticipants.some(
    (participant) => participant.id === localPeerId,
  );
  if (isParticipant && !localPlayer) return null;
  if (localPlayer && !playerMatchesTablePublicKey(doc, localPlayer)) return null;

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
    const missing = doc.shuffleParticipants.some(
      (participant) =>
        participant.id !== localPeerId &&
        !foreignKeys.has(`${participant.id}:${offset}`),
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

export function submitKeyRequests(
  handle: DocHandle<CardTableDoc>,
  localPeerId: string,
  offsets: number[],
) {
  if (offsets.length === 0) return;

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
    throw new Error(
      "Cannot publish key shares — your shuffle keys do not match this table.",
    );
  }

  if (hasPlaintextShare(doc, offset, responderId)) return;

  const material: IndividualKeyShare = {
    ...decryptionMaterial(player.getIndividualKey(offset)),
    shuffleId: doc.shuffleId,
  };

  handle.change((draft) => {
    persistKeyShare(draft, offset, responderId, material);
  });

  const recipient = doc.shuffleParticipants.find(
    (participant) => participant.id === recipientId,
  );
  if (!recipient?.exchangePublicKey?.jwk?.n) return;

  try {
    const publicKey = await importExchangePublicKey(recipient.exchangePublicKey);
    const ct = await encryptKeyShare(publicKey, material);
    handle.change((draft) => {
      persistEncryptedShare(draft, offset, responderId, recipientId, ct);
    });
  } catch {
    // Plaintext share on the table doc is sufficient.
  }
}

/** Respond to synced key requests by posting shares on the table doc. */
export async function fulfillKeyRequests(
  handle: DocHandle<CardTableDoc>,
  doc: CardTableDoc,
  player: Player,
  localPeerId: string,
) {
  if (!doc.keyRequests?.length) return;

  for (const request of doc.keyRequests) {
    if (request.requesterId === localPeerId) continue;
    const latest = handle.doc() ?? doc;
    if (hasPlaintextShare(latest, request.offset, localPeerId)) continue;
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
  const initial = await tryDecryptFromDoc(
    doc,
    localPlayer,
    localPeerId,
    offset,
    exchangePrivateKey,
  );
  if (initial) return initial;

  const missingBefore = missingKeyParticipants(doc, offset, localPeerId);
  if (missingBefore.length === 0) {
    return tryDecryptFromDoc(
      doc,
      localPlayer,
      localPeerId,
      offset,
      exchangePrivateKey,
    );
  }

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
  return tryDecryptFromDoc(
    latest,
    localPlayer,
    localPeerId,
    offset,
    exchangePrivateKey,
  );
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

export function revealedOffsetsForHand(hand: SecureHandZone): Set<number> {
  return new Set(hand.revealedOffsets ?? []);
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
