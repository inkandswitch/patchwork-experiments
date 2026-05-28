export type MapItem = {
  id: string;
  label: string;
};

/**
 * Document shape used to reproduce the bug.
 *
 * `items` is a map keyed by string id (a UUID), NOT a list. Deleting a key
 * from this map emits an automerge `del` patch whose `prop` is a string,
 * which crashes `applyPatches` inside `automerge-repo-solid-primitives`
 * with `RangeError: index is not a number for patch`.
 */
export type MapDeleteBugDoc = {
  '@patchwork': { type: 'solid-map-delete-bug' };
  title: string;
  items: Record<string, MapItem>;
};
