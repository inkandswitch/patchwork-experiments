import {
  changeTable,
  createProtocolPlayers,
  initTableAutomergeDoc,
  joinParticipant,
  linkKeyDoc,
  markReady,
  mergePeerDocs,
  publishAllKeyShares,
  referenceDecrypt,
  runFullShuffleOnDoc,
  tryDecryptFromDoc,
} from "./lib/automerge-harness.mjs";

const TRIALS = Number(process.argv[2] ?? 20);
let pass = 0;
let fail = 0;

for (let trial = 0; trial < TRIALS; trial++) {
  const roster = await createProtocolPlayers(["peer-a", "peer-b"]);

  let peerA = initTableAutomergeDoc();
  for (const id of ["peer-b", "peer-a"]) {
    peerA = joinParticipant(peerA, id);
    peerA = markReady(peerA, id);
    peerA = linkKeyDoc(peerA, id, `automerge:keys-${id}`);
  }
  peerA = runFullShuffleOnDoc(peerA, roster);

  let peerB = mergePeerDocs(peerA, initTableAutomergeDoc());

  peerB = changeTable(peerB, (draft) => {
    publishAllKeyShares(draft, roster, [0, 5, 10]);
  });

  for (const offset of [0, 5, 10]) {
    const expected = referenceDecrypt(peerB.publishedDeck, offset, roster);
    const card = tryDecryptFromDoc(peerB, roster[1].player, "peer-b", offset);
    const okCard = card?.rank === expected?.rank && card?.suit === expected?.suit;
    if (okCard) {
      pass++;
    } else {
      fail++;
      if (fail <= 5) {
        console.log(
          `trial ${trial} offset ${offset}: expected ${expected?.rank}${expected?.suit} got ${card ? card.rank + card.suit : "null"}`,
        );
        console.log(
          `  publishedDeck.len=${peerB.publishedDeck?.length} publicKey=${JSON.stringify(peerB.publicKey)} shuffleId=${peerB.shuffleId}`,
        );
        console.log(`  keyShares[${offset}]=${JSON.stringify(peerB.keyShares?.[String(offset)])}`);
        console.log(`  participants=${peerB.shuffleParticipants.map((p) => p.id).join(",")}`);
      }
    }
  }
}

console.log(`\nmerge decrypt: ${pass} pass, ${fail} fail`);
