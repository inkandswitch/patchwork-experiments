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

/** Readonly view of a single input token passed to guard and onTokens. */
export type ReadonlyToken = { readonly id: string; readonly state: TokenState };

/** Map of placeId → ReadonlyToken, one entry per from-place. */
export type ReadonlyTokens = { [placeId: string]: ReadonlyToken };

/**
 * Declarative description of what a transition should do with its input tokens.
 *
 * - `destroy`: placeId keys whose tokens should be consumed (not forwarded).
 * - `produce`: explicit new tokens to emit into output places.
 *   - If `produce` is non-empty: all non-destroyed inputs are also consumed
 *     (not forwarded). Only the listed tokens go to output.
 *   - If `produce` is absent/empty: non-destroyed inputs are forwarded to all
 *     to-places unchanged.
 */
export type TokensResult = {
  destroy?: string[];
  produce?: { state: TokenState; toPlace?: string }[];
};

export type TransitionDef = {
  id: string;
  from: string[];
  to: string[];
  /** Return false (or a Promise resolving to false) to prevent this transition from firing. */
  guard?: (tokens: ReadonlyTokens) => boolean | Promise<boolean>;
  /**
   * Called when the transition fires. Returns a declarative description of
   * what should happen to the tokens. May be async.
   *
   * If omitted, all input tokens are forwarded unchanged to all to-places.
   */
  onTokens?: (tokens: ReadonlyTokens, repo: Repo) => TokensResult | Promise<TokensResult>;
};

export type NetDef = {
  places: string[];
  transitions: TransitionDef[];
  tokenTypes: TokenTypeDef[];
  /** Single colour function for all tokens. Receives the full state. */
  getColor?: (state: TokenState) => string;
};

// ─── Animation + incremental doc-mutation types ───────────────────────────────

/** Info about a single token involved in an animation. */
export type AnimTokenInfo = {
  id: string;
  placeId: string;
  state: TokenState;
};

/** Describes one transition firing — used to drive animation. */
export type TransitionFiring = {
  transitionId: string;
  /** Tokens being consumed (still in doc until removeInputs() is called). */
  inputs: AnimTokenInfo[];
  /** Tokens to produce (pre-generated IDs, not yet in doc). */
  outputs: AnimTokenInfo[];
};

/**
 * Returned by prepareStep(). Holds the animation data and two callbacks that
 * apply the doc mutations incrementally as the animation plays.
 */
export type PendingStep = {
  firings: TransitionFiring[];
  /** Remove all input tokens from the doc. Call at the start of Phase 1. */
  removeInputs(): void;
  /** Add a single output token to the doc. Call as each animated token lands. */
  addOutput(id: string): void;
};

export interface PetriNet {
  readonly def: NetDef;
  /**
   * Compute what the next step would do. Runs guards and onTokens (may be
   * async). Does NOT touch the doc. Returns null if nothing can fire.
   *
   * The caller is responsible for animating the firings and calling
   * removeInputs() / addOutput() at the appropriate animation moments.
   */
  prepareStep(): Promise<PendingStep | null>;
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

    async prepareStep(): Promise<PendingStep | null> {
      const doc = handle.doc();
      if (!doc) return null;

      // ── 1. Snapshot current token positions ──────────────────────────────
      const snapshot: NetState = {};
      for (const placeId of def.places) {
        snapshot[placeId] = (doc.tokens?.[placeId] ?? []).map((t) => ({
          id: t.id,
          state: deepClone(t.state),
        }));
      }

      const reserved = new Set<string>();

      type PreparedFiring = {
        transition: TransitionDef;
        inputs: AnimTokenInfo[];
        outputs: AnimTokenInfo[];
      };

      // ── 2. Find all fireable transitions ─────────────────────────────────
      const prepared: PreparedFiring[] = [];

      for (const transition of def.transitions) {
        const candidates: { [placeId: string]: TokenInstance } = {};
        let canFire = true;

        for (const placeId of transition.from) {
          const available = (snapshot[placeId] ?? []).find((t) => !reserved.has(t.id));
          if (!available) { canFire = false; break; }
          candidates[placeId] = available;
        }
        if (!canFire) continue;

        // Build readonly tokens for guard + onTokens
        const readonlyTokens: ReadonlyTokens = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          readonlyTokens[placeId] = { id: t.id, state: deepClone(t.state) };
        }

        if (transition.guard && !(await transition.guard(readonlyTokens))) continue;

        // Reserve input tokens
        for (const t of Object.values(candidates)) {
          reserved.add(t.id);
        }

        // Build inputs list
        const inputs: AnimTokenInfo[] = Object.entries(candidates).map(([placeId, t]) => ({
          id: t.id,
          placeId,
          state: deepClone(t.state),
        }));

        // ── 3. Call onTokens to get declarative result ──────────────────────
        let result: TokensResult = {};
        if (transition.onTokens) {
          result = (await transition.onTokens(readonlyTokens, repo)) ?? {};
        }

        // ── 4. Pre-generate output tokens ───────────────────────────────────
        const outputs: AnimTokenInfo[] = [];
        const destroySet = new Set(result.destroy ?? []);

        if (result.produce && result.produce.length > 0) {
          // Explicit produce: generate outputs from produce list.
          // All non-destroyed inputs are consumed (not forwarded).
          for (const { state, toPlace } of result.produce) {
            const targets = toPlace ? [toPlace] : transition.to;
            for (const p of targets) {
              outputs.push({ id: makeTokenId(), placeId: p, state: deepClone(state) });
            }
          }
        } else {
          // Default forward: non-destroyed inputs → all to-places
          for (const input of inputs) {
            if (destroySet.has(input.placeId)) continue;
            for (const p of transition.to) {
              outputs.push({ id: makeTokenId(), placeId: p, state: deepClone(input.state) });
            }
          }
        }

        prepared.push({ transition, inputs, outputs });
      }

      if (prepared.length === 0) return null;

      // ── 5. Build PendingStep ──────────────────────────────────────────────
      const firings: TransitionFiring[] = prepared.map(({ transition, inputs, outputs }) => ({
        transitionId: transition.id,
        inputs,
        outputs,
      }));

      // Index for addOutput() lookups
      const outputMap = new Map<string, AnimTokenInfo>();
      for (const { outputs } of prepared) {
        for (const out of outputs) {
          outputMap.set(out.id, out);
        }
      }

      const inputsToRemove = prepared.flatMap(({ inputs }) =>
        inputs.map((inp) => ({ placeId: inp.placeId, tokenId: inp.id })),
      );

      return {
        firings,

        removeInputs() {
          handle.change((d) => {
            for (const { placeId, tokenId } of inputsToRemove) {
              const arr = d.tokens?.[placeId];
              if (!arr) continue;
              const idx = arr.findIndex((t) => t.id === tokenId);
              if (idx !== -1) arr.splice(idx, 1);
            }
          });
        },

        addOutput(id: string) {
          const out = outputMap.get(id);
          if (!out) return;
          handle.change((d) => {
            if (!d.tokens) d.tokens = {} as NetState;
            if (!d.tokens[out.placeId]) d.tokens[out.placeId] = [];
            d.tokens[out.placeId].push({ id: out.id, state: deepClone(out.state) });
          });
        },
      };
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
