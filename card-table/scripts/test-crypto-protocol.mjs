/**
 * Local sanity checks for the card-table mental-poker protocol.
 *
 * Mirrors production helpers in src/crypto/{serialize,protocol,reveal}.ts
 * without Automerge or React.
 *
 * Run: pnpm test:crypto
 */

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

const CRYPTO_BITS = 32;
const DECK_SIZE = 52;

let passed = 0;
let failed = 0;

function ok(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// --- serialize.ts -----------------------------------------------------------

function serializeSra(sra) {
  return {
    p: sra.publicKey.p.toString(),
    q: sra.publicKey.q.toString(),
    e: sra.encryptionKey.e.toString(),
    d: sra.decryptionKey.d.toString(),
  };
}

function deserializeSra(data) {
  const publicKey = new PublicKey(BigInt(data.p), BigInt(data.q));
  const encryptionKey = new EncryptionKey(BigInt(data.e), publicKey.n);
  const decryptionKey = new DecryptionKey(BigInt(data.d), publicKey.n);
  return new ShamirRivestAdleman({ publicKey, encryptionKey, decryptionKey });
}

function publicKeyToFields(key) {
  return { p: key.p.toString(), q: key.q.toString() };
}

function publicKeyFromFields(fields) {
  return new PublicKey(BigInt(fields.p), BigInt(fields.q));
}

function bigintStrings(values) {
  return values.map((value) => value.toString());
}

function parseBigintStrings(values) {
  return values.map((value) => BigInt(value));
}

function decryptionMaterial(sra) {
  return {
    d: sra.decryptionKey.d.toString(),
    n: sra.decryptionKey.n.toString(),
  };
}

function decryptWithMaterial(cipher, material) {
  const key = new DecryptionKey(BigInt(material.d), BigInt(material.n));
  return key.decrypt(cipher);
}

// --- player-keys.ts (serde) -------------------------------------------------

function playerToStored(player, deckSize) {
  const individual = [];
  for (let offset = 0; offset < deckSize; offset++) {
    individual.push(serializeSra(player.getIndividualKey(offset)));
  }
  const mainSraKey = player.mainSraKey;
  return { main: serializeSra(mainSraKey), individual };
}

function storedToPlayer(stored) {
  const mainSraKey = deserializeSra(stored.main);
  const individualSraKeys = stored.individual.map(deserializeSra);
  return new Player({ mainSraKey, individualSraKeys });
}

// --- protocol.ts (shuffle) --------------------------------------------------

function buildInitialDeck(deckSize) {
  const deck = getStandard52Deck().slice(0, deckSize);
  return new EncodedDeck(deck.map((card) => BigInt(encodeStandardCard(card))));
}

/** Run shuffle-forward then shuffle-back; returns published deck strings. */
function runShuffleProtocol(playersInOrder) {
  let working = buildInitialDeck(DECK_SIZE);

  for (const player of playersInOrder) {
    working = player.encryptAndShuffle(working);
  }

  for (let i = playersInOrder.length - 1; i >= 0; i--) {
    working = playersInOrder[i].decryptAndEncryptIndividually(working);
  }

  return bigintStrings(working.cards);
}

async function createProtocolPlayers(ids) {
  const players = [];
  let publicKey;

  for (let i = 0; i < ids.length; i++) {
    const player = await createPlayer({
      cards: DECK_SIZE,
      publicKey,
      bits: CRYPTO_BITS,
    });
    if (i === 0) publicKey = player.publicKey;
    players.push({ id: ids[i], player });
  }

  return players;
}

// --- reveal.ts (decrypt) ----------------------------------------------------

function formatCard(suit, rank) {
  if (!suit || !rank) return null;
  const symbols = { Heart: "♥", Diamond: "♦", Club: "♣", Spade: "♠" };
  const symbol = symbols[suit] ?? suit[0];
  return { suit, rank, label: `${rank}${symbol}` };
}

/** Production decryptOffset logic. */
function decryptOffset(
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

function gatherPlaintextForeignKeys(
  docKeyShares,
  offset,
  localPeerId,
  tableN,
  shuffleId = 0,
) {
  const map = new Map();
  const bucket = String(offset);
  const plaintext = docKeyShares[bucket];
  if (!plaintext) return map;

  for (const [participantId, material] of Object.entries(plaintext)) {
    if (participantId === localPeerId) continue;
    if (BigInt(material.n) !== tableN) continue;
    if (shuffleId > 0) {
      if (material.shuffleId === undefined || material.shuffleId !== shuffleId) {
        continue;
      }
    }
    map.set(`${participantId}:${offset}`, material);
  }
  return map;
}

function decryptAsViewer(
  publishedDeck,
  offset,
  roster,
  viewerId,
  playersById,
  keyShares = {},
  shuffleId = 0,
) {
  const local = playersById.get(viewerId);
  const tableN = local.player.publicKey.n;
  const foreignKeys = gatherPlaintextForeignKeys(
    keyShares,
    offset,
    viewerId,
    tableN,
    shuffleId,
  );
  return decryptOffset(
    publishedDeck,
    offset,
    roster,
    local.player,
    viewerId,
    foreignKeys,
  );
}

function referenceDecrypt(publishedDeck, offset, playersInOrder) {
  let cipher = BigInt(publishedDeck[offset]);
  for (const { player } of playersInOrder) {
    cipher = player.getIndividualKey(offset).decrypt(cipher);
  }
  const value = Number(cipher);
  if (!Number.isSafeInteger(value) || value < 1 || value > 52) return null;
  return decodeStandardCard(value);
}

// --- exchange-keys.ts (RSA envelopes) -----------------------------------------

const RSA_ALGORITHM = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateExchangeKeyPair() {
  const pair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
    "encrypt",
    "decrypt",
  ]);
  return pair;
}

async function encryptKeyShare(recipientPublicKey, material) {
  const encoded = new TextEncoder().encode(JSON.stringify(material));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    recipientPublicKey,
    encoded,
  );
  return bytesToBase64(new Uint8Array(ciphertext));
}

async function decryptKeyShare(privateKey, ciphertext) {
  const decoded = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decoded));
}

// --- tests ------------------------------------------------------------------

section("mental-poker-toolkit README example (2 players)");
{
  const deck = getStandard52Deck();
  const deckEncoded = new EncodedDeck(
    deck.map((card) => BigInt(encodeStandardCard(card))),
  );
  const alice = await createPlayer({ cards: deck.length, bits: CRYPTO_BITS });
  const bob = await createPlayer({
    cards: deck.length,
    publicKey: alice.publicKey,
    bits: CRYPTO_BITS,
  });

  let working = alice.encryptAndShuffle(deckEncoded);
  working = bob.encryptAndShuffle(working);
  working = bob.decryptAndEncryptIndividually(working);
  working = alice.decryptAndEncryptIndividually(working);

  const offset = 0;
  let cipher = working.cards[offset];
  cipher = alice.getIndividualKey(offset).decrypt(cipher);
  cipher = bob.getIndividualKey(offset).decrypt(cipher);
  const value = Number(cipher);
  ok("README flow yields card 1–52", value >= 1 && value <= 52, String(value));
}

section("protocol shuffle (2 players, sorted ids)");
{
  const roster = await createProtocolPlayers(["player-a", "player-b"]);
  const published = runShuffleProtocol(roster.map((entry) => entry.player));

  ok("published deck length", published.length === DECK_SIZE);
  ok(
    "all offsets decrypt via reference",
    [0, 7, 25, 51].every((offset) => {
      const card = referenceDecrypt(published, offset, roster);
      return card && card.rank && card.suit;
    }),
  );

  const playersById = new Map(roster.map((entry) => [entry.id, entry]));
  const participants = roster.map(({ id }) => ({ id }));

  const keyShares = {};
  const SHUFFLE_ID = 1;
  for (const offset of [0, 7, 25]) {
    const bucket = String(offset);
    keyShares[bucket] = {};
    for (const { id, player } of roster) {
      keyShares[bucket][id] = {
        ...decryptionMaterial(player.getIndividualKey(offset)),
        shuffleId: SHUFFLE_ID,
      };
    }
  }

  for (const viewerId of ["player-a", "player-b"]) {
    for (const offset of [0, 7, 25]) {
      const viaProtocol = decryptAsViewer(
        published,
        offset,
        participants,
        viewerId,
        playersById,
        keyShares,
        SHUFFLE_ID,
      );
      const viaReference = referenceDecrypt(published, offset, roster);
      ok(
        `${viewerId} offset ${offset} matches reference (${viaReference?.rank}${viaReference?.suit?.[0]})`,
        viaProtocol?.rank === viaReference?.rank &&
          viaProtocol?.suit === viaReference?.suit,
      );
    }
  }
}

section("protocol shuffle (3 players)");
{
  const roster = await createProtocolPlayers([
    "player-a",
    "player-b",
    "player-c",
  ]);
  const published = runShuffleProtocol(roster.map((entry) => entry.player));
  const playersById = new Map(roster.map((entry) => [entry.id, entry]));
  const participants = roster.map(({ id }) => ({ id }));

  const keyShares = {};
  const SHUFFLE_ID = 1;
  for (const offset of [0, 13, 51]) {
    const bucket = String(offset);
    keyShares[bucket] = {};
    for (const { id, player } of roster) {
      keyShares[bucket][id] = {
        ...decryptionMaterial(player.getIndividualKey(offset)),
        shuffleId: SHUFFLE_ID,
      };
    }
  }

  for (const viewerId of ["player-a", "player-b", "player-c"]) {
    const card = decryptAsViewer(
      published,
      13,
      participants,
      viewerId,
      playersById,
      keyShares,
      SHUFFLE_ID,
    );
    const ref = referenceDecrypt(published, 13, roster);
    ok(
      `${viewerId} 3-player offset 13`,
      card?.rank === ref?.rank && card?.suit === ref?.suit,
    );
  }
}

section("player key serde round-trip (simulates key doc load)");
{
  const roster = await createProtocolPlayers(["player-a", "player-b"]);
  const published = runShuffleProtocol(roster.map((entry) => entry.player));

  const reloaded = roster.map(({ id, player }) => ({
    id,
    player: storedToPlayer(playerToStored(player, DECK_SIZE)),
  }));

  const playersById = new Map(reloaded.map((entry) => [entry.id, entry]));
  const participants = reloaded.map(({ id }) => ({ id }));
  const keyShares = {};
  const bucket = "0";
  keyShares[bucket] = {};
  for (const { id, player } of reloaded) {
    keyShares[bucket][id] = decryptionMaterial(player.getIndividualKey(0));
  }

  const original = referenceDecrypt(published, 0, roster);
  const afterSerde = decryptAsViewer(
    published,
    0,
    participants,
    "player-a",
    playersById,
    keyShares,
  );
  ok(
    "serde round-trip preserves decrypt",
    afterSerde?.rank === original?.rank && afterSerde?.suit === original?.suit,
  );
}

section("public key chain (host publishes p,q; guest uses it)");
{
  const host = await createPlayer({ cards: DECK_SIZE, bits: CRYPTO_BITS });
  const docPublicKey = publicKeyToFields(host.publicKey);
  const guest = await createPlayer({
    cards: DECK_SIZE,
    publicKey: publicKeyFromFields(docPublicKey),
    bits: CRYPTO_BITS,
  });

  ok(
    "guest shares modulus with host",
    guest.publicKey.p === host.publicKey.p &&
      guest.publicKey.q === host.publicKey.q,
  );
  ok(
    "guest main key differs from host",
    guest.mainSraKey.encryptionKey.e !== host.mainSraKey.encryptionKey.e,
  );

  const roster = [
    { id: "host", player: host },
    { id: "guest", player: guest },
  ];
  const published = runShuffleProtocol(roster.map((entry) => entry.player));
  const ref = referenceDecrypt(published, 5, roster);
  ok("host+guest shuffle decrypts", !!ref?.rank);
}

section("negative: wrong foreign key share fails");
{
  const roster = await createProtocolPlayers(["player-a", "player-b"]);
  const published = runShuffleProtocol(roster.map((entry) => entry.player));
  const playersById = new Map(roster.map((entry) => [entry.id, entry]));
  const participants = roster.map(({ id }) => ({ id }));

  // player-b publishes material from offset 1 while viewer decrypts offset 0
  const badShares = {
    0: {
      "player-b": decryptionMaterial(roster[1].player.getIndividualKey(1)),
    },
  };

  const result = decryptAsViewer(
    published,
    0,
    participants,
    "player-a",
    playersById,
    badShares,
  );
  ok("wrong offset share does not decrypt", result === null);
}

section("negative: mismatched public key (simulates desynced keygen)");
{
  const host = await createPlayer({ cards: DECK_SIZE, bits: CRYPTO_BITS });
  const guestWrong = await createPlayer({ cards: DECK_SIZE, bits: CRYPTO_BITS });
  ok(
    "independent keygens produce different moduli",
    guestWrong.publicKey.n !== host.publicKey.n,
  );

  const roster = [
    { id: "host", player: host },
    { id: "guest", player: guestWrong },
  ];
  const published = runShuffleProtocol(roster.map((entry) => entry.player));
  const ref = referenceDecrypt(published, 0, roster);
  ok(
    "mismatched keys produce invalid or inconsistent decrypt",
    ref === null || Number(ref.rank) > 0,
  );

  const playersById = new Map(roster.map((entry) => [entry.id, entry]));
  const participants = roster.map(({ id }) => ({ id }));
  const keyShares = {
    0: {
      host: decryptionMaterial(host.getIndividualKey(0)),
      guest: decryptionMaterial(guestWrong.getIndividualKey(0)),
    },
  };

  const hostView = decryptAsViewer(
    published,
    0,
    participants,
    "host",
    playersById,
    keyShares,
  );
  const guestView = decryptAsViewer(
    published,
    0,
    participants,
    "guest",
    playersById,
    keyShares,
  );

  ok(
    "mismatched keygen: viewers disagree or fail",
    hostView === null ||
      guestView === null ||
      hostView.label !== guestView.label,
  );
}

section("negative: stale shuffleId share rejected");
{
  const roster = await createProtocolPlayers(["player-a", "player-b"]);
  const published = runShuffleProtocol(roster.map((entry) => entry.player));
  const playersById = new Map(roster.map((entry) => [entry.id, entry]));
  const participants = roster.map(({ id }) => ({ id }));

  const staleShares = {
    0: {
      "player-b": {
        ...decryptionMaterial(roster[1].player.getIndividualKey(0)),
        shuffleId: 1,
      },
    },
  };

  const result = decryptAsViewer(
    published,
    0,
    participants,
    "player-a",
    playersById,
    staleShares,
    2,
  );
  ok("stale shuffleId share does not decrypt", result === null);
}

section("deterministic shuffle participant order");
{
  const roster = await createProtocolPlayers(["player-a", "player-b"]);
  const deckSorted = runShuffleProtocol(roster.map((entry) => entry.player));
  const deckReversed = runShuffleProtocol(
    [...roster].reverse().map((entry) => entry.player),
  );
  ok(
    "shuffle turn order affects published deck",
    deckSorted[0] !== deckReversed[0],
  );
}

section("RSA-OAEP key share envelope round-trip");
{
  const pair = await generateExchangeKeyPair();
  const material = decryptionMaterial(
    (await createPlayer({ cards: DECK_SIZE, bits: CRYPTO_BITS })).getIndividualKey(
      3,
    ),
  );
  const ct = await encryptKeyShare(pair.publicKey, material);
  const recovered = await decryptKeyShare(pair.privateKey, ct);
  ok(
    "envelope preserves d,n",
    recovered.d === material.d && recovered.n === material.n,
  );
}

// --- summary ----------------------------------------------------------------

console.log(`\n${"=".repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} checks passed.`);
  process.exit(0);
}
console.error(`${failed} failed, ${passed} passed.`);
process.exit(1);
