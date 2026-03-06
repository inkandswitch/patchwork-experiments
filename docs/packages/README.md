# Shared packages

The `packages/` directory contains libraries used by tools and by each other. They do not register plugins themselves — they provide the infrastructure that tool authors build on.

```
packages/
├── react/               @inkandswitch/patchwork-react
├── solid/               @patchwork/solid
├── subscribables/
│   ├── core/            @inkandswitch/subscribables
│   ├── frameworks/
│   │   ├── react/       @inkandswitch/subscribables-react
│   │   └── solid/       @inkandswitch/subscribables-solid
└── util/                @patchwork/util
```

## At a glance

| Package | When to use |
|---|---|
| `@inkandswitch/patchwork-react` | Building tools with React. Provides hooks over the plugin registry and `toolify()`. |
| `@patchwork/solid` | Building tools with Solid JS. Same hooks as the React package but Solid-flavored. |
| `@inkandswitch/subscribables` | Framework-agnostic reactive primitives. Used to build the Solid/React adapters. |
| `@inkandswitch/subscribables-react` | `useSubscribe(subscribable)` hook for React. |
| `@inkandswitch/subscribables-solid` | `useSubscribe(subscribable)` for Solid. |
| `@patchwork/util` | Tiny utilities: `classNames`, `relativeTime`. |

## Detailed docs

- [subscribables.md](./subscribables.md) — `Subscribable<T>`, `SubscribableValue`, `computed`, framework adapters
- [framework-bindings.md](./framework-bindings.md) — React and Solid hooks for the plugin registry; `toolify()`
