import type { DocHandle } from '@automerge/automerge-repo';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TokenState = Record<string, unknown>;

export type NetState = {
  [placeId: string]: { id: string; state: TokenState }[];
};

/**
 * Imperative handle scoped to a single token during a transition.
 * Call change() to mutate the token's state, or destroy() to consume
 * the token without producing output for this transition.
 */
export interface Token {
  readonly id: string;
  readonly state: TokenState;
  change(fn: (state: TokenState) => void): void;
  destroy(): void;
}

export type TransitionDef = {
  id: string;
  from: string[];
  to: string[];
  /** Return false to skip this transition for this token. */
  guard?: (token: Token) => boolean;
  /** Called after guard passes. Mutate or destroy the token. */
  onToken?: (token: Token) => void;
};

export type NetDef = {
  places: string[];
  transitions: TransitionDef[];
  initial?: NetState;
};

export interface PetriNet {
  readonly def: NetDef;
  /**
   * Advance all tokens one step.
   * For each token, find all eligible transitions (guard passes).
   *   0 eligible → token stays
   *   1 eligible → token moves through it (onToken called)
   *   N eligible → token duplicated, one copy per eligible transition
   * Multiple to-places also duplicate the output token.
   */
  step(): void;
}

// ─── P3NetDoc shape (minimal, matches the Patchwork doc) ─────────────────────

export type P3NetDoc = {
  '@patchwork': { type: 'p3net'; suggestedImportUrl?: string };
  tokens: NetState;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeTokenId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function deepCloneState(s: TokenState): TokenState {
  return JSON.parse(JSON.stringify(s));
}

// ─── Runtime implementation ───────────────────────────────────────────────────

function createPetriNet(def: NetDef, handle: DocHandle<P3NetDoc>): PetriNet {
  // Seed initial token state if the doc is empty
  const currentDoc = handle.docSync();
  if (currentDoc && def.initial) {
    const hasTokens = Object.values(currentDoc.tokens ?? {}).some(
      (ts) => ts.length > 0,
    );
    if (!hasTokens) {
      handle.change((d) => {
        d.tokens = {};
        for (const [placeId, tokens] of Object.entries(def.initial!)) {
          d.tokens[placeId] = tokens.map((t) => ({
            id: t.id,
            state: deepCloneState(t.state),
          }));
        }
      });
    }
  }

  return {
    def,

    step() {
      const doc = handle.docSync();
      if (!doc) return;

      const current: NetState = doc.tokens ?? {};

      // Collect all (placeId, tokenEntry) pairs
      const tokenEntries: { placeId: string; id: string; state: TokenState }[] =
        [];
      for (const placeId of def.places) {
        for (const t of current[placeId] ?? []) {
          tokenEntries.push({ placeId, id: t.id, state: deepCloneState(t.state) });
        }
      }

      // For each token, determine which transitions it can take
      type Move = {
        sourcePlace: string;
        sourceId: string;
        transition: TransitionDef;
        outputState: TokenState | null; // null means destroyed
      };

      const moves: Move[] = [];

      for (const entry of tokenEntries) {
        const eligible = def.transitions.filter(
          (t) =>
            t.from.includes(entry.placeId) &&
            (t.guard == null ||
              t.guard(makeReadonlyToken(entry.id, entry.state))),
        );

        if (eligible.length === 0) continue; // token stays

        for (const transition of eligible) {
          // Clone state for each branch
          const branchState = deepCloneState(entry.state);
          let destroyed = false;

          const token: Token = {
            get id() { return entry.id; },
            get state() { return branchState; },
            change(fn) { fn(branchState); },
            destroy() { destroyed = true; },
          };

          transition.onToken?.(token);

          moves.push({
            sourcePlace: entry.placeId,
            sourceId: entry.id,
            transition,
            outputState: destroyed ? null : branchState,
          });
        }
      }

      if (moves.length === 0) return;

      // Apply all moves atomically via a single handle.change
      handle.change((d) => {
        // Initialise missing place arrays
        for (const p of def.places) {
          if (!d.tokens[p]) d.tokens[p] = [];
        }

        // Remove consumed source tokens (each unique source token consumed once)
        const consumed = new Set<string>(); // `${placeId}:${tokenId}`
        for (const mv of moves) {
          const key = `${mv.sourcePlace}:${mv.sourceId}`;
          if (!consumed.has(key)) {
            consumed.add(key);
            const arr = d.tokens[mv.sourcePlace];
            const idx = arr.findIndex((t) => t.id === mv.sourceId);
            if (idx !== -1) arr.splice(idx, 1);
          }
        }

        // Deposit output tokens
        for (const mv of moves) {
          if (mv.outputState === null) continue;
          for (const toPlace of mv.transition.to) {
            d.tokens[toPlace].push({
              id: makeTokenId(),
              state: mv.outputState,
            });
          }
        }
      });
    },
  };
}

function makeReadonlyToken(id: string, state: TokenState): Token {
  return {
    id,
    state,
    change() { /* no-op for guard */ },
    destroy() { /* no-op for guard */ },
  };
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * defineNet(def) returns a factory.
 * Call the factory with a DocHandle<P3NetDoc> to get a bound PetriNet instance.
 *
 * @example
 * export default defineNet({ places, transitions, initial })
 * // In tool: const net = factory(handle)
 */
export function defineNet(
  def: NetDef,
): (handle: DocHandle<P3NetDoc>) => PetriNet {
  return (handle) => createPetriNet(def, handle);
}
