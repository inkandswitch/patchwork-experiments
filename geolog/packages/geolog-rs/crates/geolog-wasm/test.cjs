// Test using the Node.js CJS entrypoint
const geolog = require("./dist/cjs/node.cjs");

let theory = geolog.parseTheory(`theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    // Unique weight: each edge (v1, v2) has at most one weight
    ax/unique_weight : forall v1 : V, v2 : V.
        [src: v1, tgt: v2, weight: n1] E /\\ [src: v1, tgt: v2, weight: n2] E
        |- n1 = n2;
}`);

console.log("Theory name:", theory.name);

let db = geolog.createDatabase(theory);

let e1 = db.addEntity("V");
console.log("Entity e1:", e1);

let e2 = db.addEntity("V");
console.log("Entity e2:", e2);

let edge = db.addRelation("E", [
  { entity: e1.entityId },
  { entity: e2.entityId },
  { int: 5 },
]);
console.log("Edge:", edge);

console.log("JSON:", db.toJson());

// Test ParseError has line/column attributes and extends Error
console.log("\nTesting ParseError attributes...");
try {
  geolog.parseTheory(`theory Bad {
    V : Sort;
    E : ???;
  }`);
  console.log("ERROR: Should have thrown parse error!");
  process.exit(1);
} catch (e) {
  // Must be an instance of Error
  if (!(e instanceof Error)) {
    console.log("ERROR: ParseError should be instanceof Error");
    process.exit(1);
  }
  if (e.name !== "ParseError") {
    console.log("ERROR: Expected error name 'ParseError', got", e.name);
    process.exit(1);
  }
  if (typeof e.line !== "number" || typeof e.column !== "number") {
    console.log("ERROR: ParseError should have numeric line and column");
    console.log("  got:", { line: e.line, column: e.column, offset: e.offset, endOffset: e.endOffset, message: e.message });
    process.exit(1);
  }
  if (e.line !== 3) {
    console.log("ERROR: Expected error on line 3, got", e.line);
    process.exit(1);
  }
  if (typeof e.offset !== "number" || typeof e.endOffset !== "number") {
    console.log("ERROR: ParseError should have numeric offset and endOffset");
    process.exit(1);
  }
  console.log("ParseError attributes:", { name: e.name, line: e.line, column: e.column, offset: e.offset, endOffset: e.endOffset, message: e.message });
}

// Test axiom violation
console.log("\nTesting axiom violation...");
try {
  db.addRelation("E", [
    { entity: e1.entityId },
    { entity: e2.entityId },
    { int: 10 }, // Different weight - should fail!
  ]);
  console.log("ERROR: Should have thrown axiom violation!");
  process.exit(1);
} catch (e) {
  console.log("Correctly caught axiom violation:", e.message);
}

// Test heads and patches
console.log("\nTesting heads and patches...");

// Get current heads
const heads = db.getHeads();
console.log("Current heads:", heads);
if (!Array.isArray(heads) || heads.length === 0) {
  console.log("ERROR: Expected non-empty heads array");
  process.exit(1);
}

// Create a second database and sync via patches
const db2 = geolog.createDatabase(theory);

// Get patch from db to sync to db2 (db2 has no heads yet)
const patch = db.createPatch([]);
console.log("Patch ops count:", patch.ops.length);
console.log("Patch heads:", patch.heads);

// Apply the patch to db2
db2.applyPatch(patch);

// Verify db2 now has the same state
const db2Json = db2.toJson();
console.log("db2 JSON after patch:", db2Json);

if (!db2Json.includes(e1.entityId)) {
  console.log("ERROR: db2 should contain e1 after patch");
  process.exit(1);
}

// Verify heads match
const heads2 = db2.getHeads();
console.log("db2 heads:", heads2);

// Test theory export/import for collaboration
console.log("\nTesting theory export/import...");

// Export the theory
const exportedTheory = theory.export();
console.log("Exported theory name:", exportedTheory.name);
console.log("Exported sorts:", exportedTheory.signature.sorts.map((s) => s.name));
console.log(
  "Exported relations:",
  exportedTheory.signature.relations.map((r) => r.name)
);
console.log("Exported axioms count:", exportedTheory.axioms.length);

// Import the theory on a "different peer"
const importedTheory = geolog.importTheory(exportedTheory);
console.log("Imported theory name:", importedTheory.name);

// Verify the imported theory has the same sorts/relations
if (!importedTheory.hasSort("V")) {
  console.log("ERROR: Imported theory should have sort V");
  process.exit(1);
}
if (!importedTheory.hasRelation("E")) {
  console.log("ERROR: Imported theory should have relation E");
  process.exit(1);
}

// Critical test: operations should be compatible between databases
// using the same imported theory
const db3 = geolog.createDatabase(importedTheory);

// Apply the same patch - this should work because UUIDs match
db3.applyPatch(patch);

const db3Json = db3.toJson();
console.log("db3 JSON after patch (using imported theory):", db3Json);

if (!db3Json.includes(e1.entityId)) {
  console.log("ERROR: db3 should contain e1 after patch");
  process.exit(1);
}

// Verify that parsing the same source creates DIFFERENT UUIDs
// (demonstrating why export/import is needed)
console.log("\nVerifying parsing creates different UUIDs...");
const theory2 = geolog.parseTheory(`theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
}`);

const exported1 = theory.export();
const exported2 = theory2.export();

const sortId1 = exported1.signature.sorts.find((s) => s.name === "V").id;
const sortId2 = exported2.signature.sorts.find((s) => s.name === "V").id;

console.log("Theory 1 sort V id:", sortId1);
console.log("Theory 2 sort V id:", sortId2);

if (sortId1 === sortId2) {
  console.log("ERROR: Parsed theories should have different UUIDs");
  process.exit(1);
}
console.log("Confirmed: parsed theories have different UUIDs (as expected)");

// ============================================================================
// Test: Concurrent conflicting edges must converge via applyOp
// ============================================================================
// This tests the bug where applyOp fabricated causal parents from local heads
// instead of using the real parents from the originating peer. Two peers that
// each add a conflicting edge concurrently must converge to the same winner
// after syncing via applyOp.

console.log("\nTesting concurrent conflicting edges converge via applyOp...");

{
  const theory = geolog.parseTheory(`theory WeightedGraph {
      V : Sort;
      E : [src: V, tgt: V, weight: Int] -> Prop;
      ax/unique_weight : forall v1 : V, v2 : V.
          [src: v1, tgt: v2, weight: n1] E /\\ [src: v1, tgt: v2, weight: n2] E
          |- n1 = n2;
  }`);

  // Create two databases (simulating two peers)
  const db1 = geolog.createDatabase(theory);
  const db2 = geolog.createDatabase(theory);

  // Peer 1 adds two vertices
  const v0 = db1.addEntity("V");
  const v1 = db1.addEntity("V");

  // Verify addEntity now returns parents
  if (!Array.isArray(v0.parents)) {
    console.log("ERROR: addEntity should return parents array");
    process.exit(1);
  }

  // Sync vertices to peer 2 via applyOp (with real parents)
  db2.applyOp(v0);
  db2.applyOp(v1);

  // Verify both peers have the same vertices
  const db1JsonAfterVertices = JSON.parse(db1.toJson());
  const db2JsonAfterVertices = JSON.parse(db2.toJson());
  if (db1JsonAfterVertices.entities.V.length !== 2 || db2JsonAfterVertices.entities.V.length !== 2) {
    console.log("ERROR: Both peers should have 2 vertices after sync");
    process.exit(1);
  }

  // Save shared heads before concurrent edits
  const sharedHeads1 = db1.getHeads();
  const sharedHeads2 = db2.getHeads();

  // Both peers should have the same heads at this point
  if (JSON.stringify(sharedHeads1.sort()) !== JSON.stringify(sharedHeads2.sort())) {
    console.log("ERROR: Peers should have same heads after initial sync");
    console.log("  db1 heads:", sharedHeads1);
    console.log("  db2 heads:", sharedHeads2);
    process.exit(1);
  }

  // Concurrent: peer 1 adds edge with weight=1
  const edge1 = db1.addRelation("E", [
    { entity: v0.entityId },
    { entity: v1.entityId },
    { int: 1 },
  ]);

  // Concurrent: peer 2 adds edge with weight=2
  const edge2 = db2.addRelation("E", [
    { entity: v0.entityId },
    { entity: v1.entityId },
    { int: 2 },
  ]);

  // Verify addRelation now returns parents
  if (!Array.isArray(edge1.parents)) {
    console.log("ERROR: addRelation should return parents array");
    process.exit(1);
  }

  // The parents of both edges should be the shared heads (not each other)
  if (JSON.stringify(edge1.parents.sort()) !== JSON.stringify(sharedHeads1.sort())) {
    console.log("ERROR: edge1 parents should be the shared heads");
    console.log("  edge1.parents:", edge1.parents);
    console.log("  sharedHeads:", sharedHeads1);
    process.exit(1);
  }
  if (JSON.stringify(edge2.parents.sort()) !== JSON.stringify(sharedHeads2.sort())) {
    console.log("ERROR: edge2 parents should be the shared heads");
    console.log("  edge2.parents:", edge2.parents);
    console.log("  sharedHeads:", sharedHeads2);
    process.exit(1);
  }

  // Cross-sync: each peer receives the other's edge via applyOp
  // The ops include the real causal parents from the originating peer
  db1.applyOp(edge2);
  db2.applyOp(edge1);

  // Critical: both peers must converge to the SAME state
  const json1 = db1.toJson();
  const json2 = db2.toJson();

  const parsed1 = JSON.parse(json1);
  const parsed2 = JSON.parse(json2);

  const edges1 = parsed1.relations.E;
  const edges2 = parsed2.relations.E;

  // Both should have exactly 1 edge (unique_weight axiom means the loser is skipped)
  if (edges1.length !== 1) {
    console.log("ERROR: db1 should have exactly 1 edge, got", edges1.length);
    process.exit(1);
  }
  if (edges2.length !== 1) {
    console.log("ERROR: db2 should have exactly 1 edge, got", edges2.length);
    process.exit(1);
  }

  // The winning edge must be the same on both peers
  if (JSON.stringify(edges1[0]) !== JSON.stringify(edges2[0])) {
    console.log("ERROR: Both peers must converge to the same winning edge");
    console.log("  db1 edge:", JSON.stringify(edges1[0]));
    console.log("  db2 edge:", JSON.stringify(edges2[0]));
    process.exit(1);
  }

  console.log("Concurrent edges converged correctly. Winner weight:", edges1[0][2]);
}

console.log("\nAll tests passed!");
