import * as Automerge from "@automerge/automerge/slim";
import type { DocHandle } from "../DocHandle.js";
import { decodeHeads } from "../AutomergeUrl.js";
import type { Ref, AnyPathInput } from "./types.js";
import { RefImpl } from "./ref.js";

/**
 * Create a ref from a sub-object of an Automerge document.
 *
 * This lets you take a value read out of the document (a map or list) and
 * recover a {@link Ref} pointing at that location, without having to know or
 * re-construct the path by hand.
 *
 * ```ts
 * const doc = handle.doc()
 * const foo = doc.bar.foo
 * const ref = refFromObject(handle, foo)
 * ref.value()          // same object
 * ref.change(f => { f.x = 42 })
 * ```
 *
 * Works on the materialized document returned by `handle.doc()`, the live
 * proxy passed into `handle.change(d => ...)` callbacks, and objects read
 * from any view of the same document.
 *
 * Limitations:
 * - The value must be a map or list sub-object of the document. Primitives
 *   (numbers, booleans), text strings, {@link Counter}s,
 *   {@link ImmutableString}s, and {@link Date} values do not carry path
 *   information and cannot be used. For those, use `handle.ref(...)` or
 *   {@link refFromString} with an explicit path.
 * - Array element refs are position-based, just like `handle.ref('list', 0)`.
 *   If you need stability across concurrent inserts, build a pattern ref
 *   instead: `handle.ref('list', { id })`.
 * - The object must exist in the current state of `handle`'s document.
 *   Objects from a different document, or objects that have been deleted,
 *   will throw.
 *
 * @experimental This API is experimental and may change in future versions.
 *
 * @throws Error if `value` is not an Automerge map or list sub-object.
 * @throws Error if the object does not exist in `handle`'s current document.
 */
export function refFromObject<TValue = unknown>(
  handle: DocHandle<any>,
  value: TValue,
): Ref<TValue> {
  if (value === null || typeof value !== "object") {
    throw new Error(
      "refFromObject: value is not an Automerge document sub-object. " +
        "Primitives, text strings, Counter, ImmutableString, and Date " +
        "values do not carry path information. " +
        "Use handle.ref(...) with an explicit path instead.",
    );
  }

  const objectId = Automerge.getObjectId(value as any) as string | null;
  if (objectId == null) {
    throw new Error(
      "refFromObject: value is not an Automerge document sub-object. " +
        "Only map and list sub-objects of a doc are supported. " +
        "Use handle.ref(...) with an explicit path instead.",
    );
  }

  // Object IDs are stable across clones and history, so an object looked up
  // from a view (or any past state) of the same document will still resolve
  // against the current backend. We only care whether the object exists at
  // the handle's heads and is reachable from root there.
  const docBackend = Automerge.getBackend(handle.doc());

  if (objectId === "_root") {
    return new RefImpl(handle, [] as unknown as AnyPathInput[]) as Ref<TValue>;
  }

  // Look up the path at the handle's heads so the ref's path is consistent
  // with what `ref.value()` will read through `handle.doc()`. For a live
  // handle this is the current heads; for a view handle it's the fixed heads.
  const heads = decodeHeads(handle.heads());

  let info: { path?: Automerge.Prop[] };
  try {
    info = docBackend.objInfo(objectId, heads);
  } catch (err) {
    throw new Error(
      "refFromObject: object is not present in the document at the " +
        "handle's heads. It may belong to a different document or did " +
        "not exist yet at those heads. " +
        `(underlying error: ${(err as Error).message})`,
    );
  }

  if (!info.path) {
    throw new Error(
      `refFromObject: object ${objectId} has no path in the document at ` +
        "the handle's heads. It may have been deleted.",
    );
  }

  return new RefImpl(
    handle,
    info.path as unknown as AnyPathInput[],
  ) as Ref<TValue>;
}
