# Subscribables

**Packages:**
- `@inkandswitch/subscribables` — core primitives
- `@inkandswitch/subscribables-react` — React adapter
- `@inkandswitch/subscribables-solid` — Solid adapter

**Source:** `packages/subscribables/`

Subscribables are a lightweight, framework-agnostic reactive primitive. They are used throughout Patchwork wherever a value needs to be observed across modules that may not share a framework (e.g. the selection state published by the frame and consumed by an editor tool).

## Core types

```ts
// A subscribable wrapping a primitive value
type SubscribableValue<T> = {
  subscribe: (callback: (value: T) => void) => () => void;
  value: T;
};

// A subscribable that IS the object (no .value indirection)
type SubscribableObject<T> = T & {
  subscribe: (callback: (value: T) => void) => () => void;
};

// Union
type Subscribable<T = unknown> = SubscribableValue<T> | SubscribableObject<T>;
```

`SubscribableValue` wraps a primitive or array under a `.value` property. `SubscribableObject` is the object itself with a `.subscribe` method mixed in — useful when the entire object needs to be reactive (e.g. a mutable selection set).

`subscribe` returns an unsubscribe function. Subscribers are called with the current value immediately on subscription (for `Computed`).

## `computed`

Derives a new `SubscribableValue` from one or more source subscribables. Recomputes whenever any source changes, but only notifies subscribers if the result value actually changed (strict equality check).

```ts
import { computed } from "@inkandswitch/subscribables";

const fullName = computed(firstName, lastName, (first, last) => `${first} ${last}`);
console.log(fullName.value); // "John Doe"

const unsub = fullName.subscribe((name) => console.log(name));
```

The variadic signature accepts any number of source subscribables as leading arguments, with the compute function as the last argument:

```ts
computed(sourceA, sourceB, sourceC, (a, b, c) => /* ... */)
```

## Framework adapters

### React — `useSubscribe`

```ts
import { useSubscribe } from "@inkandswitch/subscribables-react";

function MyComponent({ selection }: { selection: Subscribable<string[]> }) {
  const selected = useSubscribe(selection);
  return <div>{selected.join(", ")}</div>;
}
```

`useSubscribe(subscribable)` subscribes on mount, unsubscribes on unmount, and calls `forceUpdate` on every change. It returns `valueOfSubscribable(subscribable)` — for `SubscribableValue` this is `.value`, for `SubscribableObject` it returns the object itself.

`useSyncExternalStore` is intentionally **not** used here: React's implementation skips updates when `getSnapshot()` returns the same reference, which breaks `SubscribableObject` (the object reference is stable even when its contents change).

### Solid — `useSubscribe`

```ts
import { useSubscribe } from "@inkandswitch/subscribables-solid";
```

The Solid adapter uses `createStore + reconcile` for `SubscribableValue` (enabling granular property-level reactivity) and Solid's `from()` for `SubscribableObject`. The API is identical to the React version.

## `valueOfSubscribable`

```ts
function valueOfSubscribable<T>(subscribable: Subscribable<T>): T
```

Reads the current value of any subscribable, handling both `SubscribableValue` (reads `.value`) and `SubscribableObject` (returns the object itself). Use this when you need a one-time read without subscribing.
