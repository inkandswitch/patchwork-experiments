import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TokenState = {
  type: string;
  documentUrl: string;
  [key: string]: string;
};

export type TokenInstance = {
  id: string;
  state: TokenState;
};

export type NetState = {
  [placeId: string]: TokenInstance[];
};

export type TokenTypeDef = {
  id: string;
  label: string;
  color: string;
  create: () => TokenState | Promise<TokenState>;
};

export type ReadonlyToken = { readonly id: string; readonly state: TokenState };

export type ReadonlyTokens = { [placeId: string]: ReadonlyToken };

export type TokensResult = {
  destroy?: string[];
  produce?: { state: TokenState; toPlace?: string }[];
};

export type TransitionDef = {
  id: string;
  /** Consume ONE token from each of these places. */
  from: string[];
  /** Consume ALL tokens from each of these places. */
  fromAll?: string[];
  to: string[];
  guard?: (
    tokens: ReadonlyTokens,
    allTokens: { [placeId: string]: ReadonlyToken[] },
    repo: Repo,
  ) => boolean | Promise<boolean>;
  onConsumedTokens?: (
    tokens: ReadonlyTokens,
    allTokens: { [placeId: string]: ReadonlyToken[] },
    repo: Repo,
  ) => TokensResult | Promise<TokensResult>;
  onProducedToken?: (
    token: AnimTokenInfo,
    handle: DocHandle<NetDoc>,
    repo: Repo,
  ) => void | Promise<void>;
};

export type NetDef = {
  places: string[];
  transitions: TransitionDef[];
  tokenTypes: TokenTypeDef[];
  getColor?: (state: TokenState) => string;
};

// ─── Animation + incremental doc-mutation types ───────────────────────────────

export type AnimTokenInfo = {
  id: string;
  placeId: string;
  state: TokenState;
};

export type TransitionFiring = {
  transitionId: string;
  inputs: AnimTokenInfo[];
  outputs: AnimTokenInfo[];
};

export type PendingStep = {
  firings: TransitionFiring[];
  removeInputs(): void;
  addOutput(id: string): void;
  runSideEffects(): void;
};

export interface PetriNet {
  readonly def: NetDef;
  prepareStep(): Promise<PendingStep | null>;
  reset(): void;
}

// ─── Minimal doc shape ────────────────────────────────────────────────────────

export type NetDoc = {
  tokens: NetState;
  [key: string]: unknown;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeTokenId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function deepClone(s: TokenState): TokenState {
  return JSON.parse(JSON.stringify(s));
}

// ─── Runtime implementation ───────────────────────────────────────────────────

function createPetriNet(def: NetDef, handle: DocHandle<NetDoc>, repo: Repo): PetriNet {
  return {
    def,

    reset() {
      handle.change((d) => {
        d.tokens = {} as NetState;
      });
    },

    async prepareStep(): Promise<PendingStep | null> {
      const doc = handle.doc();
      if (!doc) return null;

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

      const prepared: PreparedFiring[] = [];

      for (const transition of def.transitions) {
        // ── Check 'from' places (one token each) ─────────────────────────────
        const candidates: { [placeId: string]: TokenInstance } = {};
        let canFire = true;

        for (const placeId of transition.from) {
          const available = (snapshot[placeId] ?? []).find((t) => !reserved.has(t.id));
          if (!available) { canFire = false; break; }
          candidates[placeId] = available;
        }
        if (!canFire) continue;

        // ── Check 'fromAll' places (all tokens, ≥1 required) ─────────────────
        const allCandidates: { [placeId: string]: TokenInstance[] } = {};
        if (transition.fromAll) {
          for (const placeId of transition.fromAll) {
            const available = (snapshot[placeId] ?? []).filter((t) => !reserved.has(t.id));
            if (available.length === 0) { canFire = false; break; }
            allCandidates[placeId] = available;
          }
        }
        if (!canFire) continue;

        // ── Build readonly views ──────────────────────────────────────────────
        const readonlyTokens: ReadonlyTokens = {};
        for (const [placeId, t] of Object.entries(candidates)) {
          readonlyTokens[placeId] = { id: t.id, state: deepClone(t.state) };
        }

        const allReadonlyTokens: { [placeId: string]: ReadonlyToken[] } = {};
        for (const [placeId, tokens] of Object.entries(allCandidates)) {
          allReadonlyTokens[placeId] = tokens.map((t) => ({ id: t.id, state: deepClone(t.state) }));
        }

        if (transition.guard && !(await transition.guard(readonlyTokens, allReadonlyTokens, repo))) continue;

        // ── Reserve all tokens ────────────────────────────────────────────────
        for (const t of Object.values(candidates)) reserved.add(t.id);
        for (const tokens of Object.values(allCandidates)) {
          for (const t of tokens) reserved.add(t.id);
        }

        // ── Build inputs list ─────────────────────────────────────────────────
        const inputs: AnimTokenInfo[] = [
          ...Object.entries(candidates).map(([placeId, t]) => ({
            id: t.id,
            placeId,
            state: deepClone(t.state),
          })),
          ...Object.entries(allCandidates).flatMap(([placeId, tokens]) =>
            tokens.map((t) => ({ id: t.id, placeId, state: deepClone(t.state) })),
          ),
        ];

        // ── Call onConsumedTokens ─────────────────────────────────────────────
        let result: TokensResult = {};
        if (transition.onConsumedTokens) {
          result = (await transition.onConsumedTokens(readonlyTokens, allReadonlyTokens, repo)) ?? {};
        }

        // ── Pre-generate output tokens ────────────────────────────────────────
        const outputs: AnimTokenInfo[] = [];
        const destroySet = new Set(result.destroy ?? []);

        if (result.produce && result.produce.length > 0) {
          for (const { state, toPlace } of result.produce) {
            const targets = toPlace ? [toPlace] : transition.to;
            for (const p of targets) {
              outputs.push({ id: makeTokenId(), placeId: p, state: deepClone(state) });
            }
          }
        } else {
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

      const firings: TransitionFiring[] = prepared.map(({ transition, inputs, outputs }) => ({
        transitionId: transition.id,
        inputs,
        outputs,
      }));

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
              const idx = (arr as TokenInstance[]).findIndex((t) => t.id === tokenId);
              if (idx !== -1) (arr as TokenInstance[]).splice(idx, 1);
            }
          });
        },

        addOutput(id: string) {
          const out = outputMap.get(id);
          if (!out) return;
          handle.change((d) => {
            if (!d.tokens) d.tokens = {} as NetState;
            if (!d.tokens[out.placeId]) d.tokens[out.placeId] = [];
            (d.tokens[out.placeId] as TokenInstance[]).push({ id: out.id, state: deepClone(out.state) });
          });
        },

        runSideEffects() {
          for (const { transition, outputs } of prepared) {
            if (!transition.onProducedToken) continue;
            for (const token of outputs) {
              Promise.resolve(
                transition.onProducedToken(token, handle, repo),
              ).catch((err) =>
                console.error(`[llm-petrinet] onProducedToken error in "${transition.id}":`, err),
              );
            }
          }
        },
      };
    },
  };
}

// ─── Public factory ───────────────────────────────────────────────────────────

export function defineNet(def: NetDef): (handle: DocHandle<NetDoc>, repo: Repo) => PetriNet {
  return (handle, repo) => createPetriNet(def, handle, repo);
}
