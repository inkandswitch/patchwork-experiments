# @tiny-patchwork/verified-todo-list

A Patchwork tool: a collaborative todo list with drag-to-reorder, whose
domain-level invariants are proven in [Dafny](https://dafny.org).

The one property we care about is:

> After any legal sequence of add / toggle / move / delete operations, the
> rendered list contains no duplicate item ids.

## Why this is interesting

The usual hazard with a naive list-CRDT todo app is that reordering
(implemented as delete-from-old-slot + insert-into-new-slot) can *duplicate*
an item under concurrent moves. See
[Kleppmann, "Moving Elements in List CRDTs" (2020)](https://martin.kleppmann.com/2020/04/27/list-move-operation.html).

We avoid that hazard by choosing a different data model: items live in a
`map<ItemId, Item>` and each item carries a `position: number` field.
Reordering is a per-field last-writer-wins update to `position` -- never a
delete+insert. Because Dafny's `map` and Automerge's map object both have
unique keys by construction, the "no duplicate item ids" invariant is
essentially structural -- Dafny just has to verify that no domain operation
accidentally violates it.

## What is NOT in the Dafny proof

Deliberately: no CRDT specification. Automerge-repo is trusted for merging.
There are no Lamport clocks, no LWW merge logic, no merge
commutativity/associativity proofs in Dafny. The proof is small and
entirely about the app's own domain.

## Document shape

```ts
type VerifiedTodoDoc = {
  title: string;
  items: {
    [id: string]: {
      text: string;
      done: boolean;
      position: number;
      deleted: boolean; // soft-delete tombstone
    };
  };
};
```

- `id` is `crypto.randomUUID()`, globally unique with overwhelming
  probability. This satisfies the Dafny precondition
  `requires iid !in d.items` on `AddTodo`.
- `deleted: true` is a soft-delete tombstone. The item leaves the
  `LiveKeys` set (and the rendered view) but stays in `items.Keys` forever,
  so a concurrent update cannot resurrect nor duplicate it.
- `position` is a real number. Drag-to-reorder computes a new position as
  the midpoint between the neighbors at the drop site (fractional
  indexing) and writes it back with one field-level update.

## Theorems proven

See [`dafny/TodoDomain.dfy`](dafny/TodoDomain.dfy). Six core theorems plus a
composite history theorem:

1. `NoDuplicatesInView` -- the rendered id list has no duplicates.
2. `MovePreservesKeys` -- reordering never changes the set of ids.
3. `TogglePreservesKeys` -- toggling done never changes the set of ids.
4. `DeletePreservesKeys` + `DeleteRemovesFromView` -- soft-delete keeps the
   id in the map but hides it from the view.
5. `AddTodoAddsOneKey` -- adding with a fresh id grows the keyset by
   exactly one.
6. `NoDuplicatesAfterAnyMerge` -- for any `Doc`, including Automerge-merged
   ones, the view is duplicate-free. Boundary with Automerge: structural,
   from Dafny's map type.
7. `NoDuplicatesThroughoutHistory` -- invariant holds at every step of any
   legal op history from `EmptyDoc`.

Expected verification output:

```
Dafny program verifier finished with 20 verified, 0 errors
```

## Scripts

```bash
pnpm install      # first time
pnpm build        # produces dist/ for Patchwork to load
pnpm dev          # pushwork watch + rebuild on change
pnpm verify       # re-check all Dafny proofs (requires dafny 4.x)
```

Install Dafny with `brew install dafny` (or `dotnet tool install -g Dafny`)
to re-run `pnpm verify`.

## Files

- [`dafny/TodoDomain.dfy`](dafny/TodoDomain.dfy) -- domain model and proofs.
- [`src/verified/TodoDomain.ts`](src/verified/TodoDomain.ts) -- runtime
  mirror of the Dafny file, function by function.
- [`src/bridge.ts`](src/bridge.ts) -- performs the equivalent in-place
  mutations against the Automerge proxy inside `DocHandle.change()`.
- [`src/VerifiedTodoList.tsx`](src/VerifiedTodoList.tsx) -- React editor
  with `@dnd-kit`-powered drag-to-reorder.
- [`src/actions.ts`](src/actions.ts) -- Patchwork action plugins (add,
  toggle, mark done, delete, move, list, set title, clear completed).
- [`src/datatype.ts`](src/datatype.ts) -- `verified-todo-list` datatype
  definition (`init`, `getTitle`).
- [`src/index.ts`](src/index.ts) -- plugin registration.
