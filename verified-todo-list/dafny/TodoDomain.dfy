// TodoDomain.dfy
//
// Domain-level model of the Verified Todo List Patchwork tool.
//
// This file does NOT specify a CRDT. Automerge (via automerge-repo) is the
// CRDT. We only encode the domain-specific invariants our app needs to
// preserve on top of Automerge's data model, the most important of which is:
//
//   After any legal sequence of AddTodo / ToggleTodo / MoveTodo / DeleteTodo,
//   the rendered list contains no duplicate item ids.
//
// The key design choice: items live in a map<ItemId, Item> keyed by stable
// id; reordering is an LWW update to a numeric `position` field; deletion is
// a soft-delete tombstone. Because Dafny's map and Automerge's map object
// both have unique keys by construction, non-duplication is structural - it
// falls out of the type - and Dafny only has to verify that no domain
// operation accidentally violates it.
//
// The TypeScript runtime (../src/verified/TodoDomain.ts and ../src/bridge.ts)
// mirrors these definitions line-by-line.

module TodoDomain {

  // ==========================================================================
  // Data model. ItemId is an opaque type with decidable equality: we only
  // need to compare ids for equality, not order them. The runtime represents
  // it as a crypto.randomUUID() string, which is globally unique with
  // overwhelming probability and satisfies the "iid !in d.items"
  // precondition of AddTodo.
  // ==========================================================================

  type ItemId(==,!new)

  datatype Item = Item(
    text: string,
    done: bool,
    position: real,
    deleted: bool)

  datatype Doc = Doc(title: string, items: map<ItemId, Item>)

  function EmptyDoc(): Doc { Doc("", map[]) }

  // ==========================================================================
  // Domain operations. Each is a pure function from Doc to Doc, reflecting
  // the intended local mutation that the TypeScript bridge performs inside
  // DocHandle.change(). Automerge observes the mutation and syncs it; we
  // do not model that layer.
  // ==========================================================================

  function SetTitle(d: Doc, title: string): Doc {
    d.(title := title)
  }

  // Precondition: the caller has minted a fresh item id.
  function AddTodo(d: Doc, iid: ItemId, text: string, pos: real): Doc
    requires iid !in d.items
  {
    d.(items := d.items[iid := Item(text, false, pos, false)])
  }

  function ToggleTodo(d: Doc, iid: ItemId, done: bool): Doc {
    if iid !in d.items then d
    else d.(items := d.items[iid := d.items[iid].(done := done)])
  }

  // Reorder: last-writer-wins update to `position` only. Never delete+insert.
  // This is the whole point of storing a map keyed by id instead of a list:
  // reordering cannot duplicate items because the keyset is not touched.
  function MoveTodo(d: Doc, iid: ItemId, pos: real): Doc {
    if iid !in d.items then d
    else d.(items := d.items[iid := d.items[iid].(position := pos)])
  }

  // Soft delete: set deleted := true rather than removing the key. This
  // makes the operation a per-field update, which composes safely with any
  // concurrent Move or Toggle under Automerge's per-field merge.
  function DeleteTodo(d: Doc, iid: ItemId): Doc {
    if iid !in d.items then d
    else d.(items := d.items[iid := d.items[iid].(deleted := true)])
  }

  // ==========================================================================
  // The visible list: live (non-deleted) ids. Sorting is a runtime concern;
  // only the *set* of visible ids matters for non-duplication.
  // ==========================================================================

  ghost function LiveKeys(d: Doc): set<ItemId> {
    set k | k in d.items && !d.items[k].deleted
  }

  ghost predicate NoDuplicates<T>(s: seq<T>) {
    forall i, j :: 0 <= i < j < |s| ==> s[i] != s[j]
  }

  ghost function ToSeq(keys: set<ItemId>): seq<ItemId>
    ensures |ToSeq(keys)| == |keys|
    ensures forall k :: k in ToSeq(keys) <==> k in keys
    ensures NoDuplicates(ToSeq(keys))
    decreases |keys|
  {
    if keys == {} then []
    else
      var k :| k in keys;
      [k] + ToSeq(keys - {k})
  }

  ghost function View(d: Doc): seq<ItemId>
    ensures NoDuplicates(View(d))
    ensures forall k :: k in View(d) <==> k in LiveKeys(d)
  {
    ToSeq(LiveKeys(d))
  }

  // ==========================================================================
  // DOMAIN THEOREMS
  // ==========================================================================

  // THEOREM 1 (core claim). An item is never duplicated in the rendered
  // view, in any reachable state.
  //
  // This is structural: d.items is a Dafny map, whose keys are unique by
  // definition; LiveKeys is a subset of those keys; View is a duplicate-free
  // enumeration of that subset (by construction of ToSeq). The entire proof
  // is handled by Dafny's type system plus the postconditions of ToSeq.
  lemma NoDuplicatesInView(d: Doc)
    ensures NoDuplicates(View(d))
  {}

  // THEOREM 2. Reordering preserves the keyset. This is the *domain* reason
  // we picked the map+position design over a native list: concurrent moves
  // cannot introduce duplicates because the keyset is never touched.
  lemma MovePreservesKeys(d: Doc, iid: ItemId, pos: real)
    ensures MoveTodo(d, iid, pos).items.Keys == d.items.Keys
  {}

  // THEOREM 3. Toggle preserves the keyset.
  lemma TogglePreservesKeys(d: Doc, iid: ItemId, done: bool)
    ensures ToggleTodo(d, iid, done).items.Keys == d.items.Keys
  {}

  // THEOREM 4. Soft-delete preserves the keyset. (The item leaves LiveKeys
  // but stays in items.Keys, so concurrent updates cannot resurrect nor
  // duplicate it.)
  lemma DeletePreservesKeys(d: Doc, iid: ItemId)
    ensures DeleteTodo(d, iid).items.Keys == d.items.Keys
  {}

  // Soft-delete really does hide the item from the view.
  lemma DeleteRemovesFromView(d: Doc, iid: ItemId)
    requires iid in d.items
    ensures iid !in LiveKeys(DeleteTodo(d, iid))
  {}

  // THEOREM 5. Adding a todo with a fresh id grows the keyset by exactly
  // that one id.
  lemma AddTodoAddsOneKey(d: Doc, iid: ItemId, text: string, pos: real)
    requires iid !in d.items
    ensures AddTodo(d, iid, text, pos).items.Keys == d.items.Keys + {iid}
    ensures |AddTodo(d, iid, text, pos).items.Keys| == |d.items.Keys| + 1
  {}

  // THEOREM 6 (the Automerge-merge boundary). For ANY Doc - including those
  // produced by Automerge's merge - the visible id set contains no
  // duplicates. Because the merged state is a map, uniqueness holds
  // automatically. No CRDT-level proof needed on our side.
  lemma NoDuplicatesAfterAnyMerge(merged: Doc)
    ensures NoDuplicates(View(merged))
  {
    NoDuplicatesInView(merged);
  }

  // ==========================================================================
  // COMPOSITE THEOREM: the invariant holds throughout any sequence of domain
  // operations starting from EmptyDoc.
  //
  // Ops carry their item id as a parameter. The Add case requires the id
  // to be fresh; other ops are no-ops on unknown ids.
  // ==========================================================================

  datatype Op =
    | SetTitleOp(title: string)
    | Add(iid: ItemId, text: string, pos: real)
    | Toggle(iid: ItemId, done: bool)
    | Move(iid: ItemId, pos: real)
    | Delete(iid: ItemId)

  predicate LegalStep(d: Doc, op: Op) {
    match op
    case Add(iid, _, _) => iid !in d.items
    case _ => true
  }

  function Step(d: Doc, op: Op): Doc
    requires LegalStep(d, op)
  {
    match op
    case SetTitleOp(title) => SetTitle(d, title)
    case Add(iid, text, pos) => AddTodo(d, iid, text, pos)
    case Toggle(iid, done) => ToggleTodo(d, iid, done)
    case Move(iid, pos) => MoveTodo(d, iid, pos)
    case Delete(iid) => DeleteTodo(d, iid)
  }

  predicate LegalHistory(d: Doc, ops: seq<Op>)
    decreases |ops|
  {
    if |ops| == 0 then true
    else LegalStep(d, ops[0]) && LegalHistory(Step(d, ops[0]), ops[1..])
  }

  function RunHistory(d: Doc, ops: seq<Op>): Doc
    requires LegalHistory(d, ops)
    decreases |ops|
  {
    if |ops| == 0 then d
    else RunHistory(Step(d, ops[0]), ops[1..])
  }

  lemma NoDuplicatesThroughoutHistory(ops: seq<Op>)
    requires LegalHistory(EmptyDoc(), ops)
    ensures NoDuplicates(View(RunHistory(EmptyDoc(), ops)))
  {
    NoDuplicatesInView(RunHistory(EmptyDoc(), ops));
  }
}
