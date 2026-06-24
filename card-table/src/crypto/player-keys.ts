import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { Player } from "mental-poker-toolkit";
import type { CardTableDoc, CardTableKeysDoc } from "../types";
import {
  exchangePublicKeyFromJwk,
  generateExchangeKeyPair,
  importExchangePrivateKey,
} from "./exchange-keys";
import {
  deserializeSra,
  serializeSra,
  type SerializedSra,
} from "./serialize";

const memory = new Map<AutomergeUrl, Player>();
const exchangeMemory = new Map<AutomergeUrl, CryptoKey>();

export function cachePlayer(keyDocUrl: AutomergeUrl, player: Player): void {
  memory.set(keyDocUrl, player);
}

function isValidSerializedSra(
  data: SerializedSra | undefined,
): data is SerializedSra {
  return !!(data?.p && data?.q && data?.e && data?.d);
}

function playerToStored(player: Player, deckSize: number): {
  main: SerializedSra;
  individual: SerializedSra[];
} {
  const individual: SerializedSra[] = [];
  for (let offset = 0; offset < deckSize; offset++) {
    individual.push(serializeSra(player.getIndividualKey(offset)));
  }
  const mainSraKey = (
    player as unknown as {
      mainSraKey: Parameters<typeof serializeSra>[0];
    }
  ).mainSraKey;
  return {
    main: serializeSra(mainSraKey),
    individual,
  };
}

function storedToPlayer(stored: {
  main: SerializedSra;
  individual: SerializedSra[];
}): Player {
  const mainSraKey = deserializeSra(stored.main);
  const individualSraKeys = stored.individual.map(deserializeSra);
  return new Player({ mainSraKey, individualSraKeys });
}

export function writePlayerToKeyDoc(
  keyDoc: CardTableKeysDoc,
  tableUrl: AutomergeUrl,
  playerId: string,
  deckSize: number,
  player: Player,
) {
  keyDoc["@patchwork"] = { type: "card-table-keys" };
  keyDoc.tableUrl = tableUrl;
  keyDoc.playerId = playerId;
  keyDoc.deckSize = deckSize;

  const stored = playerToStored(player, deckSize);

  if (!keyDoc.main) {
    keyDoc.main = { ...stored.main };
  } else {
    keyDoc.main.p = stored.main.p;
    keyDoc.main.q = stored.main.q;
    keyDoc.main.e = stored.main.e;
    keyDoc.main.d = stored.main.d;
  }

  if (!keyDoc.individual) {
    keyDoc.individual = stored.individual.map((item) => ({ ...item }));
    return;
  }

  keyDoc.individual.splice(0, keyDoc.individual.length);
  for (const item of stored.individual) {
    keyDoc.individual.push({
      p: item.p,
      q: item.q,
      e: item.e,
      d: item.d,
    });
  }
}

export async function loadPlayerFromKeyDoc(
  repo: Repo,
  keyDocUrl: AutomergeUrl,
  options?: { waitAttempts?: number; waitMs?: number },
): Promise<Player | null> {
  const cached = memory.get(keyDocUrl);
  if (cached) return cached;

  const waitAttempts = options?.waitAttempts ?? 1;
  const waitMs = options?.waitMs ?? 0;

  for (let attempt = 0; attempt < waitAttempts; attempt++) {
    const keyHandle = await repo.find<CardTableKeysDoc>(keyDocUrl);
    await keyHandle.whenReady();
    const keyDoc = keyHandle.doc();
    if (
      keyDoc?.main &&
      isValidSerializedSra(keyDoc.main) &&
      keyDoc.individual?.length === keyDoc.deckSize &&
      keyDoc.individual.every(isValidSerializedSra)
    ) {
      const player = storedToPlayer(keyDoc);
      memory.set(keyDocUrl, player);
      return player;
    }

    if (attempt < waitAttempts - 1 && waitMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    }
  }

  return null;
}

export async function loadExchangePrivateKey(
  repo: Repo,
  doc: CardTableDoc,
  peerId: string,
): Promise<CryptoKey | null> {
  const participant = doc.shuffleParticipants.find((entry) => entry.id === peerId);
  if (!participant?.keyDocUrl) return null;

  const cached = exchangeMemory.get(participant.keyDocUrl);
  if (cached) return cached;

  const keyHandle = await repo.find<CardTableKeysDoc>(participant.keyDocUrl);
  await keyHandle.whenReady();
  const jwk = keyHandle.doc()?.exchangePrivateJwk;
  if (!jwk?.d) return null;

  const privateKey = await importExchangePrivateKey(jwk);
  exchangeMemory.set(participant.keyDocUrl, privateKey);
  return privateKey;
}

export async function ensureExchangeKeys(
  tableHandle: DocHandle<CardTableDoc>,
  keyHandle: DocHandle<CardTableKeysDoc>,
  peerId: string,
): Promise<void> {
  const keyDoc = keyHandle.doc();
  if (keyDoc?.exchangePrivateJwk?.d) {
    const participant = tableHandle.doc()?.shuffleParticipants.find(
      (entry) => entry.id === peerId,
    );
    if (participant?.exchangePublicKey?.jwk?.n) return;

    const privateJwk = keyDoc.exchangePrivateJwk;
    const publicJwk =
      keyDoc.exchangePublicJwk ??
      (privateJwk?.n && privateJwk?.e
        ? { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e }
        : undefined);
    if (publicJwk?.n) {
      tableHandle.change((table) => {
        const entry = table.shuffleParticipants.find((p) => p.id === peerId);
        if (entry && !entry.exchangePublicKey?.jwk?.n) {
          entry.exchangePublicKey = exchangePublicKeyFromJwk(publicJwk);
        }
      });
      return;
    }
  }

  const generated = await generateExchangeKeyPair();
  exchangeMemory.set(keyHandle.url, generated.privateKey);

  keyHandle.change((draft) => {
    draft.exchangePrivateJwk = generated.privateJwk;
    draft.exchangePublicJwk = generated.publicJwk;
  });

  tableHandle.change((table) => {
    const participant = table.shuffleParticipants.find((entry) => entry.id === peerId);
    if (participant) {
      participant.exchangePublicKey = exchangePublicKeyFromJwk(generated.publicJwk);
    }
  });
}

export async function loadLocalPlayer(
  repo: Repo,
  doc: CardTableDoc,
  peerId: string,
): Promise<Player | null> {
  const participant = doc.shuffleParticipants.find((entry) => entry.id === peerId);
  if (!participant?.keyDocUrl) return null;
  return loadPlayerFromKeyDoc(repo, participant.keyDocUrl);
}

export function linkKeyDoc(
  tableHandle: DocHandle<CardTableDoc>,
  peerId: string,
  keyDocUrl: AutomergeUrl,
) {
  tableHandle.change((table) => {
    const participant = table.shuffleParticipants.find((entry) => entry.id === peerId);
    if (participant) participant.keyDocUrl = keyDocUrl;
  });
}
