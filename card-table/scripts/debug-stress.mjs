import {
  changeTable,
  createProtocolPlayers,
  initTableAutomergeDoc,
  joinParticipant,
  linkKeyDoc,
  markReady,
  publishAllKeyShares,
  runFullShuffleOnDoc,
  sortedParticipants,
} from "./lib/automerge-harness.mjs";
import { decodeStandardCard } from "mental-poker-toolkit";

const TRIALS = Number(process.argv[2] ?? 20);
const DECK = 52;

let totalCards = 0;
let badCards = 0;
const badValues = [];

for (let trial = 0; trial < TRIALS; trial++) {
  const roster = await createProtocolPlayers(["peer-a", "peer-b"]);

  let doc = initTableAutomergeDoc();
  for (const id of ["peer-a", "peer-b"]) {
    doc = joinParticipant(doc, id);
    doc = markReady(doc, id);
    doc = linkKeyDoc(doc, id, `automerge:keys-${id}`);
  }
  doc = runFullShuffleOnDoc(doc, roster);

  const offsets = Array.from({ length: DECK }, (_, i) => i);
  doc = changeTable(doc, (draft) => {
    publishAllKeyShares(draft, roster, offsets);
  });

  // Reference decrypt every offset; collect raw values.
  const seen = new Set();
  for (let offset = 0; offset < DECK; offset++) {
    let cipher = BigInt(doc.publishedDeck[offset]);
    for (const { player } of roster) {
      cipher = player.getIndividualKey(offset).decrypt(cipher);
    }
    const value = Number(cipher);
    totalCards++;
    if (!Number.isSafeInteger(value) || value < 1 || value > 52) {
      badCards++;
      badValues.push({ trial, offset, value: cipher.toString() });
    } else {
      seen.add(value);
    }
  }
  // Check the deck is a permutation of 1..52
  if (seen.size !== 52) {
    console.log(`trial ${trial}: only ${seen.size} distinct valid cards (expected 52)`);
  }
}

console.log(`\n${totalCards} cards decrypted, ${badCards} bad (out of range)`);
if (badValues.length) {
  console.log("Sample bad values:", badValues.slice(0, 10));
}
