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

export type SecureDeckZone = {
  "@patchwork"?: { type: "secure-deck" };
  id: string;
  title: string;
  cards: number[];
};

export type SecureHandZone = {
  "@patchwork"?: { type: "secure-hand" };
  id: string;
  title: string;
  /** Empty until a player claims this hand on the canvas. */
  /** Contact doc URL (or repo peer id). Empty until claimed. */
  ownerId: string;
  cards: number[];
  /** Deck offsets the owner has revealed to other players. */
  revealedOffsets?: number[];
};

export type SecurePileZone = {
  "@patchwork"?: { type: "secure-pile" };
  id: string;
  title: string;
  faceUp: boolean;
  cards: number[];
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

  /** Face-down draw pile — path-addressed sub-document (`decks/{id}`). */
  decks: SecureDeckZone[];

  /** Cached individual key shares — populated as players cooperate to reveal cards. */
  keyShares: KeyShareCache;
  /** Encrypted key shares addressed to specific players (preferred over plaintext). */
  keyShareEnvelopes: KeyShareEnvelopeCache;
  /** Outstanding requests for missing shuffle key material (synced, not ephemeral). */
  keyRequests: KeyRequest[];

  hands: SecureHandZone[];
  piles: SecurePileZone[];
};

export type ZoneRef =
  | { kind: "deck"; id: string }
  | { kind: "hand"; id: string }
  | { kind: "pile"; id: string };

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
