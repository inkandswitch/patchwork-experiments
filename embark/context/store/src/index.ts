// The shared-context substrate: a store of named channels (pure JSON state any
// component can read the merged value of, or write its own scoped slice into),
// plus the discovery custom element and thin Solid bindings. Domain channels
// (selection, search, schema, …) live in their own packages and are defined
// against `defineChannel` from here.

export * from "./context";
export * from "./context-solid";
