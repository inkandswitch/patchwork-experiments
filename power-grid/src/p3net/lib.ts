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
 * create() is called when a token is dragged from the palette — receives repo
 * so it can create automerge documents and return the full initial state.
 * The type identifier is written into state.type automatically.
 */
export type TokenTypeDef = {
  id: string;
  label: string;
  color: string; // palette chip colour only
  create: (repo: Repo) => TokenState;
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
  /** Return false (or a Promise resolving to false) to prevent this transition from firing. */
  guard?: (tokens: Tokens) => boolean | Promise<boolean>;
  /**
   * Called when the transition fires. May be async.
   * Mutate/destroy input tokens and/or call produce() to emit new tokens.
   * If produce() is never called, non-destroyed input tokens are forwarded
   * to all to-places (default single-input behaviour).
   * produce() can be called at any point — including after awaits.
   */
  onTokens?: (tokens: Tokens, produce: ProduceFn, repo: Repo) => void | Promise<void>;
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
   * Advance the net one step. Returns a Promise because onTokens/guard may be async.
   * For each fireable transition (all from-places have ≥1 token, guard passes):
   *   - Awaits onTokens with one token per from-place
   *   - Commits all consumed/produced tokens atomically after all onTokens settle
   * Multi-input transitions use join semantics.
   */
  step(): Promise<void>;
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

function createPetriNet(def: NetDef, handle: DocHandle<P3NetDoc>, repo: Repo): PetriNet {
  return {
    def,

    reset() {
      handle.change((d) => {
        d.tokens = {} as NetState;
        d.canvas = [];
      });
    },

    async step() {
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
        inputTokens: { [placeId: string]: { id: string; state: TokenState; destroyed: boolean } };
        produced: { state: TokenState; toPlace?: string }[];
        tokens: Tokens;
        produce: ProduceFn;
      };

      // ── 2. Find all fireable transitions (sync, guards may be async) ────────
      const toFire: FiredTransition[] = [];

      for (const transition of def.transitions) {
        // Join semantics: every from-place must have ≥1 unreserved token
        const candidates: { [placeId: string]: TokenInstance } = {};
        let canFire = true;

        for (const placeId of transition.from) {
          const available = (snapshot[placeId] ?? []).find((t) => !reserved.has(t.id));
          if (!available) { canFire = false; break; }
          candidates[placeId] = available;
        }
        if (!canFire) continue;

        // Build readonly guard tokens and evaluate guard (may be async)
        const guardTokens: Tokens = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          guardTokens[placeId] = makeToken(t.id, deepClone(t.state));
        }
        if (transition.guard && !(await transition.guard(guardTokens))) continue;

        // Reserve tokens and build mutable input tokens for onTokens
        const inputTokens: FiredTransition['inputTokens'] = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          inputTokens[placeId] = { id: t.id, state: deepClone(t.state), destroyed: false };
          reserved.add(t.id);
        }

        const produced: FiredTransition['produced'] = [];
        const produce: ProduceFn = (state, toPlace) => {
          produced.push({ state: deepClone(state), toPlace });
        };

        const tokens: Tokens = {};
        for (const [placeId, entry] of Object.entries(inputTokens)) {
          tokens[placeId] = {
            get id() { return entry.id; },
            get state() { return entry.state; },
            change(fn) { fn(entry.state); },
            destroy() { entry.destroyed = true; },
          };
        }

        toFire.push({ transition, inputTokens, produced, tokens, produce });
      }

      if (toFire.length === 0) return;

      // ── 3. Call onTokens for all fired transitions (may be async) ──────────
      await Promise.all(
        toFire.map(({ transition, tokens, produce }) =>
          transition.onTokens?.(tokens, produce, repo),
        ),
      );

      // ── 4. Commit atomically ───────────────────────────────────────────────
      handle.change((d) => {
        if (!d.tokens) d.tokens = {} as NetState;
        for (const p of def.places) {
          if (!d.tokens[p]) d.tokens[p] = [];
        }

        for (const { transition, inputTokens, produced } of toFire) {
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
    change(fn) {
      fn(state);
    },
    destroy() {
      /* no-op for guard tokens */
    },
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
export function defineNet(def: NetDef): (handle: DocHandle<P3NetDoc>, repo: Repo) => PetriNet {
  return (handle, repo) => createPetriNet(def, handle, repo);
}
