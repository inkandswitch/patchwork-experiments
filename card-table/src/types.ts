import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { SerializedSra } from "./crypto/serialize";

export type TablePhase =
  | "setup"
  | "keygen"
  | "shuffle-forward"
  | "shuffle-back"
  | "shuffle-verify"
  | "ready";

export type ShuffleParticipant = {
  /** Contact doc URL (or repo peer id). Display name is resolved from this at render time. */
  id: string;
  /** Player clicked ready during setup; init runs when all joined players (>1) are ready. */
  readyToStart: boolean;
  keygenReady: boolean;
  shuffleDone: boolean;
  /** Link to this player's private key document (ACL-protected later). */
  keyDocUrl: AutomergeUrl | null;
  /** RSA-OAEP public key others use to post encrypted key shares on the table doc. */
  exchangePublicKey: ExchangePublicKey | null;
};

export type ExchangePublicKey = {
  jwk: Pick<JsonWebKey, "kty" | "n" | "e">;
};

export type KeyRequest = {
  requestId: string;
  offset: number;
  requesterId: string;
  createdAt: number;
};

export type EncryptedKeyShare = {
  /** Base64 RSA-OAEP ciphertext of `{ d, n }` JSON. */
  ct: string;
};

export type CardTableKeysDoc = {
  "@patchwork"?: { type: "card-table-keys" };
  tableUrl: AutomergeUrl;
  playerId: string;
  deckSize: number;
  main: SerializedSra;
  individual: SerializedSra[];
  /** Private half of the RSA-OAEP exchange keypair (stored locally per player). */
  exchangePrivateJwk?: JsonWebKey;
  /** Public half — used to restore table state without rotating the private key. */
  exchangePublicJwk?: JsonWebKey;
};

export type PublicKeyFields = {
  p: string;
  q: string;
};

export type ZoneLayout = "fan" | "row" | "stack";

/**
 * A single unified card container. A "hand" is a zone with an `ownerId`
 * (a private viewer); a "pile" is an unowned zone; the "deck" is an unowned
 * zone with `role: "deck"` that the shuffle fills and that is drawn from the
 * front. Reveal state is per-card (`revealedOffsets`) plus an optional
 * `faceUp` reveal-all policy.
 */
export type CardZone = {
  "@patchwork"?: { type: "card-zone" };
  id: string;
  title: string;
  cards: number[];
  /** Contact doc URL of the private viewer. Absent/"" = shared (pile/deck). */
  ownerId?: string;
  /** Offsets revealed publicly to everyone (per-card reveal). */
  revealedOffsets?: number[];
  /** Reveal-all policy — every card (incl. future ones) is face up to all. */
  faceUp?: boolean;
  /** Presentation hint. */
  layout?: ZoneLayout;
  /** "deck" = filled by the shuffle, drawn from the front, never auto-revealed. */
  role?: "deck";
};

export type IndividualKeyShare = {
  d: string;
  n: string;
  shuffleId: number;
};

/** Published individual decryption material per deck offset and shuffle participant. */
export type KeyShareCache = {
  [offset: string]: {
    [participantId: string]: IndividualKeyShare;
  };
};

/** Encrypted key shares posted on the table doc for a specific recipient. */
export type KeyShareEnvelopeCache = {
  [offset: string]: {
    [responderId: string]: {
      [recipientId: string]: EncryptedKeyShare;
    };
  };
};

export type CardTableDoc = {
  "@patchwork"?: { type: "card-table" };
  title: string;
  deckSize: number;

  phase: TablePhase;
  /** Incremented on each shuffle; key shares must match this id. */
  shuffleId: number;
  shuffleTurn: number;
  shuffleParticipants: ShuffleParticipant[];

  publicKey: PublicKeyFields | null;
  workingDeck: string[] | null;
  publishedDeck: string[] | null;

  /** All card containers (deck, hands, piles) — path-addressed as `zones/{id}`. */
  zones: CardZone[];

  /** Cached individual key shares — populated as players cooperate to reveal cards. */
  keyShares: KeyShareCache;
  /** Encrypted key shares addressed to specific players (preferred over plaintext). */
  keyShareEnvelopes: KeyShareEnvelopeCache;
  /** Outstanding requests for missing shuffle key material (synced, not ephemeral). */
  keyRequests: KeyRequest[];
};

/** Reference to a zone by id. */
export type ZoneRef = { id: string };

export const CRYPTO_BITS = 32;

export const suitSymbol: Record<string, string> = {
  Heart: "♥",
  Diamond: "♦",
  Club: "♣",
  Spade: "♠",
};

export type DecryptedCard = {
  suit: string;
  rank: string;
  label: string;
};
