/**
 * Automerge integration tests for card-table crypto.
 * Reproduces CardTableDoc structure and change() patterns from production.
 *
 * Run: node scripts/test-crypto-automerge.mjs
 */

import * as Automerge from "@automerge/automerge";
import {
  changeTable,
  completeVerifiedShuffle,
  createProtocolPlayers,
  decryptionMaterial,
  initKeyDocs,
  initTableAutomergeDoc,
  joinParticipant,
  linkKeyDoc,
  markReady,
  mergePeerDocs,
  publishAllKeyShares,
  referenceDecrypt,
  runFullShuffleOnDoc,
  runOneShuffleStep,
  startShuffle,
  tryDecryptFromDoc,
  verifyShuffledDeck,
  advancePastCompletedTurns,
} from "./lib/automerge-harness.mjs";

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

async function testParticipantReorderRequiresClone() {
  section("Automerge participant reorder");

  let doc = initTableAutomergeDoc();
  doc = joinParticipant(doc, "peer-z");
  doc = joinParticipant(doc, "peer-a");

  let badError = null;
  try {
    Automerge.change(doc, (draft) => {
      const sorted = [...draft.shuffleParticipants].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      draft.shuffleParticipants.splice(
        0,
        draft.shuffleParticipants.length,
        ...sorted,
      );
    });
  } catch (error) {
    badError = error;
  }
  ok(
    "re-splicing existing participant objects throws",
    badError?.message?.includes("Cannot create a reference"),
    badError?.message ?? "expected Automerge reference error",
  );

  doc = initTableAutomergeDoc();
  doc = joinParticipant(doc, "peer-z");
  doc = joinParticipant(doc, "peer-a");
  doc = changeTable(doc, (draft) => {
    const sorted = [...draft.shuffleParticipants]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => ({
        id: p.id,
        readyToStart: p.readyToStart,
        keygenReady: p.keygenReady,
        shuffleDone: p.shuffleDone,
        keyDocUrl: p.keyDocUrl,
        exchangePublicKey: null,
      }));
    draft.shuffleParticipants.splice(
      0,
      draft.shuffleParticipants.length,
      ...sorted,
    );
  });
  ok(
    "cloned participant reorder succeeds",
    doc.shuffleParticipants.map((p) => p.id).join(",") === "peer-a,peer-z",
  );
}

async function testKeyShareMustBeFreshObject() {
  section("Automerge key share storage");

  let doc = initTableAutomergeDoc();
  doc = changeTable(doc, (draft) => {
    draft.shuffleId = 1;
    draft.keyShares["0"] = {};
    draft.keyShares["0"]["peer-a"] = { d: "1", n: "999", shuffleId: 1 };
  });

  let badError = null;
  try {
    Automerge.change(doc, (draft) => {
      const share = draft.keyShares["0"]["peer-a"];
      draft.keyShares["0"]["peer-z"] = share;
    });
  } catch (error) {
    badError = error;
  }
  ok(
    "assigning existing key share object throws",
    badError?.message?.includes("Cannot create a reference"),
    badError?.message,
  );
}

async function testWorkingDeckCopyPattern() {
  section("workingDeck / publishedDeck string copies");

  let doc = initTableAutomergeDoc();
  doc = changeTable(doc, (draft) => {
    draft.workingDeck = ["111", "222", "333"];
    draft.publishedDeck = draft.workingDeck.map((value) => String(value));
  });
  ok(
    "publishedDeck is independent copy",
    doc.publishedDeck.join(",") === "111,222,333",
  );

  doc = changeTable(doc, (draft) => {
    draft.workingDeck[0] = "999";
  });
  ok(
    "mutating workingDeck does not mutate publishedDeck",
    doc.publishedDeck[0] === "111",
    `published[0]=${doc.publishedDeck[0]}`,
  );
}

async function testFullShuffleAndDecryptOnAutomergeDoc() {
  section("Full shuffle + decrypt on Automerge CardTableDoc");

  const roster = await createProtocolPlayers(["peer-a", "peer-b"]);
  const playersById = new Map(roster.map((r) => [r.id, r.player]));
  initKeyDocs(roster);

  let doc = initTableAutomergeDoc();
  doc = joinParticipant(doc, "peer-b");
  doc = joinParticipant(doc, "peer-a");
  doc = markReady(doc, "peer-a");
  doc = markReady(doc, "peer-b");
  for (const { id } of roster) {
    doc = linkKeyDoc(doc, id, `automerge:keys-${id}`);
  }

  doc = runFullShuffleOnDoc(doc, roster);
  ok("shuffle ends in shuffle-verify phase", doc.phase === "shuffle-verify");
  ok(
    "publishedDeck has 52 entries",
    doc.publishedDeck?.length === 52,
    `got ${doc.publishedDeck?.length}`,
  );
  ok(
    "verifyShuffledDeck passes on Automerge doc",
    verifyShuffledDeck(doc, playersById),
  );

  doc = changeTable(doc, (draft) => {
    publishAllKeyShares(draft, roster, [0, 3, 7, 15, 31, 51]);
  });

  for (const offset of [0, 3, 7, 15, 31, 51]) {
    const expected = referenceDecrypt(doc.publishedDeck, offset, roster);
    for (const { id, player } of roster) {
      const card = tryDecryptFromDoc(doc, player, id, offset);
      ok(
        `peer ${id} decrypts offset ${offset} (${expected.rank} of ${expected.suit})`,
        card?.rank === expected.rank && card?.suit === expected.suit,
        card ? `${card.rank} of ${card.suit}` : "null",
      );
    }
  }

  doc = changeTable(doc, (draft) => {
    completeVerifiedShuffle(draft);
  });
  ok("completeVerifiedShuffle moves to ready", doc.phase === "ready");
}

async function testJoinOrderReverseThenSort() {
  section("Reverse join order (z before a) still decrypts");

  const roster = await createProtocolPlayers(["peer-a", "peer-z"]);
  initKeyDocs(roster);

  let doc = initTableAutomergeDoc();
  doc = joinParticipant(doc, "peer-z");
  doc = joinParticipant(doc, "peer-a");
  doc = markReady(doc, "peer-a");
  doc = markReady(doc, "peer-z");
  for (const { id } of roster) {
    doc = linkKeyDoc(doc, id, `automerge:keys-${id}`);
  }

  doc = runFullShuffleOnDoc(doc, roster);
  ok(
    "participants sorted lexicographically after shuffle",
    doc.shuffleParticipants[0].id === "peer-a",
    doc.shuffleParticipants.map((p) => p.id).join(","),
  );

  doc = changeTable(doc, (draft) => {
    publishAllKeyShares(draft, roster, [0, 1, 2]);
  });

  for (const offset of [0, 1, 2]) {
    const expected = referenceDecrypt(doc.publishedDeck, offset, roster);
    const card = tryDecryptFromDoc(doc, roster[0].player, "peer-a", offset);
    ok(
      `reverse-join decrypt offset ${offset}`,
      card?.rank === expected.rank && card?.suit === expected.suit,
      card ? `${card.rank} of ${card.suit}` : "null",
    );
  }
}

async function testTwoPeerMergeDuringShuffle() {
  section("Two-peer merge after shuffle");

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

  ok("merged peer receives shuffle-verify state", peerB.phase === "shuffle-verify");
  ok(
    "merged peer sees full publishedDeck",
    peerB.publishedDeck?.length === 52,
    `got ${peerB.publishedDeck?.length}`,
  );
  ok(
    "publishedDeck matches after merge",
    peerB.publishedDeck?.join(",") === peerA.publishedDeck?.join(","),
  );

  peerB = changeTable(peerB, (draft) => {
    publishAllKeyShares(draft, roster, [0, 5, 10]);
  });

  for (const offset of [0, 5, 10]) {
    const expected = referenceDecrypt(peerB.publishedDeck, offset, roster);
    const card = tryDecryptFromDoc(peerB, roster[1].player, "peer-b", offset);
    ok(
      `merged peer-b decrypts offset ${offset}`,
      card?.rank === expected.rank && card?.suit === expected.suit,
      card ? `${card.rank} of ${card.suit}` : "null",
    );
  }
}

async function testStaleShuffleIdRejected() {
  section("Stale shuffleId on key share rejected");

  const roster = await createProtocolPlayers(["peer-a", "peer-b"]);
  initKeyDocs(roster);

  let doc = initTableAutomergeDoc();
  for (const id of ["peer-a", "peer-b"]) {
    doc = joinParticipant(doc, id);
    doc = markReady(doc, id);
    doc = linkKeyDoc(doc, id, `automerge:keys-${id}`);
  }

  doc = runFullShuffleOnDoc(doc, roster);

  doc = changeTable(doc, (draft) => {
    draft.shuffleId = 2;
    draft.keyShares["0"] = {};
    const material = decryptionMaterial(
      roster[1].player.getIndividualKey(0),
    );
    draft.keyShares["0"]["peer-b"] = {
      d: material.d,
      n: material.n,
      shuffleId: 1,
    };
  });

  const card = tryDecryptFromDoc(doc, roster[0].player, "peer-a", 0);
  ok("stale shuffleId share does not decrypt", card === null);
}

async function testShuffleBackNotSkippedByAdvancePast() {
  section("shuffle-back runs after forward (advancePastCompletedTurns)");

  const roster = await createProtocolPlayers(["peer-a", "peer-b"]);
  const playersById = new Map(roster.map((r) => [r.id, r.player]));

  let doc = initTableAutomergeDoc();
  for (const id of ["peer-a", "peer-b"]) {
    doc = joinParticipant(doc, id);
    doc = markReady(doc, id);
    doc = linkKeyDoc(doc, id, `automerge:keys-${id}`);
  }

  doc = changeTable(doc, (draft) => {
    startShuffle(draft);
  });
  doc = runOneShuffleStep(doc, roster);
  doc = runOneShuffleStep(doc, roster);
  ok(
    "forward pass ends in shuffle-back with cleared shuffleDone",
    doc.phase === "shuffle-back" &&
      doc.shuffleParticipants.every((p) => !p.shuffleDone),
    `${doc.phase} done=${doc.shuffleParticipants.map((p) => p.shuffleDone).join(",")}`,
  );

  doc = changeTable(doc, (draft) => {
    advancePastCompletedTurns(draft);
  });
  ok(
    "advancePastCompletedTurns does not skip shuffle-back",
    doc.phase === "shuffle-back",
    doc.phase,
  );

  doc = runOneShuffleStep(doc, roster);
  doc = runOneShuffleStep(doc, roster);
  ok("shuffle-back completes to shuffle-verify", doc.phase === "shuffle-verify");
  ok(
    "verify passes after full shuffle",
    verifyShuffledDeck(doc, playersById),
  );
}

async function main() {
  console.log("card-table Automerge crypto integration tests\n");

  await testParticipantReorderRequiresClone();
  await testKeyShareMustBeFreshObject();
  await testWorkingDeckCopyPattern();
  await testShuffleBackNotSkippedByAdvancePast();
  await testFullShuffleAndDecryptOnAutomergeDoc();
  await testJoinOrderReverseThenSort();
  await testTwoPeerMergeDuringShuffle();
  await testStaleShuffleIdRejected();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
