import type { DocHandle, Repo } from '@automerge/automerge-repo';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TokenState = Record<string, unknown>;

/** A single token instance stored in the doc. Type is encoded in state.type. */
export type TokenInstance = {
  id: string;
  state: TokenState;
};

export type NetState = {
  [placeId: string]: TokenInstance[];
};

/**
 * A token type definition used for the palette.
 * The type identifier is written into state.type when creating from the palette.
 */
export type TokenTypeDef = {
  id: string;
  label: string;
  color: string; // palette chip colour only
  initialState?: TokenState | (() => TokenState);
};

/**
 * Imperative handle scoped to a single token during a transition.
 * Call change() to mutate the token's state, or destroy() to consume
 * the token without forwarding it to output places.
 */
export interface Token {
  readonly id: string;
  readonly state: TokenState;
  change(fn: (state: TokenState) => void): void;
  destroy(): void;
}

/** Map of placeId → Token, one entry per from-place. */
export type Tokens = { [placeId: string]: Token };

/**
 * Produce a new token into the output.
 * If `toPlace` is given, deposits only into that specific output place.
 * If omitted, deposits into all `to` places of the transition.
 */
export type ProduceFn = (state: TokenState, toPlace?: string) => void;

export type TransitionDef = {
  id: string;
  from: string[];
  to: string[];
  /** Return false to prevent this transition from firing for these tokens. */
  guard?: (tokens: Tokens) => boolean;
  /**
   * Called when the transition fires.
   * Mutate/destroy input tokens and/or call produce() to emit new tokens.
   * If produce() is never called, non-destroyed input tokens are forwarded
   * to all to-places (default single-input behaviour).
   */
  onTokens?: (tokens: Tokens, produce: ProduceFn, repo: Repo) => void;
};

export type NetDef = {
  places: string[];
  transitions: TransitionDef[];
  tokenTypes: TokenTypeDef[];
  /** Single colour function for all tokens. Receives the full state. */
  getColor?: (state: TokenState) => string;
};

export interface PetriNet {
  readonly def: NetDef;
  /**
   * Advance the net one step (synchronous).
   * For each fireable transition (all from-places have ≥1 token, guard passes):
   *   - Calls onTokens with one token per from-place
   *   - Commits all consumed/produced tokens atomically
   * Multi-input transitions use join semantics.
   */
  step(): void;
  /** Clear all tokens from places and canvas. */
  reset(): void;
}

// ─── P3NetDoc shape (minimal, matches the Patchwork doc) ─────────────────────

export type P3NetDoc = {
  '@patchwork': { type: 'p3net'; suggestedImportUrl?: string };
  tokens: NetState;
  canvas: { id: string; state: TokenState; x: number; y: number }[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeTokenId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function deepClone(s: TokenState): TokenState {
  return JSON.parse(JSON.stringify(s));
}

// ─── Runtime implementation ───────────────────────────────────────────────────

function createPetriNet(
  def: NetDef,
  handle: DocHandle<P3NetDoc>,
  repo: Repo,
): PetriNet {
  return {
    def,

    reset() {
      handle.change((d) => {
        d.tokens = {} as NetState;
        d.canvas = [];
      });
    },

    step() {
      const doc = handle.doc();
      if (!doc) return;

      // ── 1. Snapshot current token positions ────────────────────────────────
      const snapshot: NetState = {};
      for (const placeId of def.places) {
        snapshot[placeId] = (doc.tokens?.[placeId] ?? []).map((t) => ({
          id: t.id,
          state: deepClone(t.state),
        }));
      }

      // Track which token IDs have already been reserved by an earlier transition
      const reserved = new Set<string>();

      type FiredTransition = {
        transition: TransitionDef;
        // placeId → mutable snapshot token
        inputTokens: { [placeId: string]: { id: string; state: TokenState; destroyed: boolean } };
        produced: { state: TokenState; toPlace?: string }[];
      };

      const fired: FiredTransition[] = [];

      // ── 2. Find all fireable transitions ───────────────────────────────────
      for (const transition of def.transitions) {
        // Join semantics: every from-place must have ≥1 unreserved token
        const candidates: { [placeId: string]: TokenInstance } = {};
        let canFire = true;

        for (const placeId of transition.from) {
          const available = (snapshot[placeId] ?? []).find(
            (t) => !reserved.has(t.id),
          );
          if (!available) { canFire = false; break; }
          candidates[placeId] = available;
        }
        if (!canFire) continue;

        // Build readonly guard tokens
        const guardTokens: Tokens = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          guardTokens[placeId] = makeToken(t.id, deepClone(t.state));
        }

        if (transition.guard && !transition.guard(guardTokens)) continue;

        // Build mutable input tokens for onTokens
        const inputTokens: FiredTransition['inputTokens'] = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          inputTokens[placeId] = { id: t.id, state: deepClone(t.state), destroyed: false };
          reserved.add(t.id);
        }

        const produced: { state: TokenState; toPlace?: string }[] = [];

        const tokens: Tokens = {};
        for (const [placeId, entry] of Object.entries(inputTokens)) {
          tokens[placeId] = {
            get id() { return entry.id; },
            get state() { return entry.state; },
            change(fn) { fn(entry.state); },
            destroy() { entry.destroyed = true; },
          };
        }

        const produce: ProduceFn = (state, toPlace) => {
          produced.push({ state: deepClone(state), toPlace });
        };

        transition.onTokens?.(tokens, produce, repo);

        fired.push({ transition, inputTokens, produced });
      }

      if (fired.length === 0) return;

      // ── 3. Commit atomically ───────────────────────────────────────────────
      handle.change((d) => {
        if (!d.tokens) d.tokens = {} as NetState;
        for (const p of def.places) {
          if (!d.tokens[p]) d.tokens[p] = [];
        }

        for (const { transition, inputTokens, produced } of fired) {
          // Remove consumed tokens from their source places
          for (const [placeId, entry] of Object.entries(inputTokens)) {
            const arr = d.tokens[placeId];
            const idx = arr.findIndex((t) => t.id === entry.id);
            if (idx !== -1) arr.splice(idx, 1);
          }

          if (produced.length > 0) {
            // Explicit produce() calls determine output
            for (const { state, toPlace } of produced) {
              const targets = toPlace ? [toPlace] : transition.to;
              for (const p of targets) {
                if (!d.tokens[p]) d.tokens[p] = [];
                d.tokens[p].push({ id: makeTokenId(), state });
              }
            }
          } else {
            // Default: forward non-destroyed input tokens to all to-places
            for (const entry of Object.values(inputTokens)) {
              if (entry.destroyed) continue;
              for (const p of transition.to) {
                if (!d.tokens[p]) d.tokens[p] = [];
                d.tokens[p].push({ id: makeTokenId(), state: entry.state });
              }
            }
          }
        }
      });
    },
  };
}

function makeToken(id: string, state: TokenState): Token {
  return {
    id,
    state,
    change(fn) { fn(state); },
    destroy() { /* no-op for guard tokens */ },
  };
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * defineNet(def) returns a factory.
 * Call the factory with a DocHandle and Repo to get a bound PetriNet instance.
 *
 * @example
 * export default defineNet({ places, transitions, tokenTypes, getColor })
 * // In tool: const net = factory(handle, repo)
 */
export function defineNet(
  def: NetDef,
): (handle: DocHandle<P3NetDoc>, repo: Repo) => PetriNet {
  return (handle, repo) => createPetriNet(def, handle, repo);
}
