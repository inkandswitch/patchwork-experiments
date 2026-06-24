import {
  changeTable,
  createProtocolPlayers,
  initKeyDocs,
  initTableAutomergeDoc,
  joinParticipant,
  linkKeyDoc,
  markReady,
  mergePeerDocs,
  publishAllKeyShares,
  referenceDecrypt,
  runFullShuffleOnDoc,
  sortedParticipants,
  gatherForeignKeys,
} from "./lib/automerge-harness.mjs";

const roster = await createProtocolPlayers(["peer-a", "peer-b"]);
initKeyDocs(roster);

let peerA = initTableAutomergeDoc();
for (const id of ["peer-b", "peer-a"]) {
  peerA = joinParticipant(peerA, id);
  peerA = markReady(peerA, id);
  peerA = linkKeyDoc(peerA, id, `automerge:keys-${id}`);
}
peerA = runFullShuffleOnDoc(peerA, roster);

let peerB = mergePeerDocs(peerA, initTableAutomergeDoc());

console.log("peerA.shuffleId =", peerA.shuffleId, " peerA.publicKey =", peerA.publicKey);
console.log("peerB.shuffleId =", peerB.shuffleId, " peerB.publicKey =", peerB.publicKey);
console.log("peerB.phase =", peerB.phase);
console.log("peerB.publishedDeck len =", peerB.publishedDeck?.length);
console.log("peerB participants =", peerB.shuffleParticipants.map((p) => p.id));

peerB = changeTable(peerB, (draft) => {
  publishAllKeyShares(draft, roster, [0, 5, 10]);
});

console.log("keyShares[0] =", JSON.stringify(peerB.keyShares["0"]));

const offset = 0;
const foreign = gatherForeignKeys(peerB, offset, "peer-b");
console.log("foreignKeys for peer-b:", [...foreign.keys()]);
console.log("sorted participants:", sortedParticipants(peerB).map((p) => p.id));

const expected = referenceDecrypt(peerB.publishedDeck, offset, roster);
console.log("referenceDecrypt expected:", expected);

// Manual decryptOffset trace
const peerB_player = roster[1].player;
let cipher = BigInt(peerB.publishedDeck[offset]);
console.log("start cipher:", cipher.toString());
for (const participant of sortedParticipants(peerB)) {
  if (participant.id === "peer-b") {
    cipher = peerB_player.getIndividualKey(offset).decrypt(cipher);
    console.log(`after local peer-b decrypt:`, cipher.toString());
  } else {
    const material = foreign.get(`${participant.id}:${offset}`);
    const { DecryptionKey } = await import("mental-poker-toolkit");
    const key = new DecryptionKey(BigInt(material.d), BigInt(material.n));
    cipher = key.decrypt(cipher);
    console.log(`after foreign ${participant.id} decrypt:`, cipher.toString());
  }
}
console.log("final value:", Number(cipher));

// Compare reference order
let c2 = BigInt(peerB.publishedDeck[offset]);
for (const { id, player } of roster) {
  c2 = player.getIndividualKey(offset).decrypt(c2);
  console.log(`ref after ${id}:`, c2.toString());
}
console.log("ref final value:", Number(c2));

const { tryDecryptFromDoc, playerMatchesTablePublicKey } = await import("./lib/automerge-harness.mjs");
console.log("playerMatchesTablePublicKey:", playerMatchesTablePublicKey(peerB, peerB_player));
console.log("peerB_player.publicKey:", peerB_player.publicKey.p.toString(), peerB_player.publicKey.q.toString());
const card = tryDecryptFromDoc(peerB, peerB_player, "peer-b", offset);
console.log("tryDecryptFromDoc card:", card);
