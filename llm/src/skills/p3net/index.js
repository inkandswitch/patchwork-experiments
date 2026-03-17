/**
 * P3Net skill — inspect and manipulate tokens in a Petri net simulation document.
 *
 * P3NetDoc shape:
 *   { sourceUrl: AutomergeUrl, tokens: { [placeId]: TokenInstance[] }, canvas: CanvasToken[] }
 *
 * TokenInstance: { id: string, state: Record<string, unknown> }
 * CanvasToken:   { id: string, state: Record<string, unknown>, x: number, y: number }
 *
 * SourceDoc shape (the JS file that defines the net):
 *   { '@patchwork': { type: 'file' }, name: string, extension: string, mimeType: string, content: string }
 */

/**
 * Read the JS source text of a P3Net's net definition.
 *
 * Use this to inspect or clone the net logic of an existing P3Net, and to
 * extract the `defineNet` import URL needed when creating a new net.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} p3netUrl - Automerge URL of the P3NetDoc
 * @returns {Promise<{ sourceUrl: string, source: string }>}
 */
export async function readSource(repo, p3netUrl) {
  const netHandle = repo.find(p3netUrl);
  await netHandle.whenReady();
  const sourceUrl = netHandle.doc()?.sourceUrl;
  if (!sourceUrl) throw new Error('P3NetDoc has no sourceUrl');

  const srcHandle = repo.find(sourceUrl);
  await srcHandle.whenReady();
  const doc = srcHandle.doc();
  const source =
    typeof doc?.content === 'string'
      ? doc.content
      : doc?.content instanceof Uint8Array
        ? new TextDecoder().decode(doc.content)
        : '';

  return { sourceUrl, source };
}

/**
 * Create a new P3Net document from a JS source string.
 *
 * Steps:
 *   1. Creates a SourceDoc (JS file) with the given source content.
 *   2. Creates a P3NetDoc pointing to that source.
 *   3. Optionally seeds `initialTokens`.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} jsSource - Full JS source for the net definition (see SKILL.md for format)
 * @param {object} [initialTokens] - Optional initial token state: { [placeId]: { state }[] }
 * @returns {string} The AutomergeUrl of the new P3NetDoc
 */
export function createDoc(repo, jsSource, initialTokens = {}) {
  const sourceHandle = repo.create();
  sourceHandle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = 'net.js';
    d.extension = 'js';
    d.mimeType = 'application/javascript';
    d.content = jsSource;
  });

  const netHandle = repo.create();
  netHandle.change((d) => {
    d['@patchwork'] = { type: 'p3net' };
    d.sourceUrl = sourceHandle.url;
    d.tokens = {};
    d.canvas = [];

    for (const [placeId, tokens] of Object.entries(initialTokens)) {
      d.tokens[placeId] = tokens.map((t) => ({
        id: crypto.randomUUID(),
        state: t.state ?? t,
      }));
    }
  });

  return netHandle.url;
}

/**
 * Get a read/write interface for a P3Net simulation document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the P3NetDoc
 */
export function getP3Net(repo, url) {
  const handle = repo.find(url);

  return {
    /**
     * Return the URL of the JS source document that defines the net
     * (places, transitions, token types).
     */
    async getSourceUrl() {
      await handle.whenReady();
      return handle.doc()?.sourceUrl;
    },

    /**
     * Return the full token state: a map of placeId → TokenInstance[].
     * Each token has an `id` string and a `state` object.
     * The `state.type` field identifies the token type (from the net's palette).
     */
    async getState() {
      await handle.whenReady();
      return handle.doc()?.tokens ?? {};
    },

    /**
     * Return tokens currently in a specific place.
     * Returns an empty array if the place has no tokens or does not exist.
     */
    async getTokens(placeId) {
      await handle.whenReady();
      return handle.doc()?.tokens?.[placeId] ?? [];
    },

    /**
     * Return all canvas (floating) tokens — tokens dragged off the net
     * that do not participate in transitions.
     */
    async getCanvas() {
      await handle.whenReady();
      return handle.doc()?.canvas ?? [];
    },

    /**
     * Add a new token with the given state to a place.
     * Returns the new token's ID.
     * @param {string} placeId - The destination place ID
     * @param {object} state - The token's initial state (include `type` to match a palette type)
     * @returns {string} The new token's UUID
     */
    addToken(placeId, state) {
      const id = crypto.randomUUID();
      handle.change((d) => {
        if (!d.tokens[placeId]) d.tokens[placeId] = [];
        d.tokens[placeId].push({ id, state });
      });
      return id;
    },

    /**
     * Remove a token by ID from a place.
     * Returns true if the token was found and removed, false otherwise.
     */
    removeToken(placeId, tokenId) {
      const doc = handle.doc();
      const tokens = doc?.tokens?.[placeId] ?? [];
      const idx = tokens.findIndex((t) => t.id === tokenId);
      if (idx === -1) return false;
      handle.change((d) => {
        d.tokens[placeId].splice(idx, 1);
      });
      return true;
    },

    /**
     * Move a token from one place to another.
     * Returns true if the token was found and moved, false otherwise.
     */
    moveToken(fromPlace, tokenId, toPlace) {
      const doc = handle.doc();
      const tokens = doc?.tokens?.[fromPlace] ?? [];
      const idx = tokens.findIndex((t) => t.id === tokenId);
      if (idx === -1) return false;
      const token = tokens[idx];
      handle.change((d) => {
        d.tokens[fromPlace].splice(idx, 1);
        if (!d.tokens[toPlace]) d.tokens[toPlace] = [];
        d.tokens[toPlace].push({ id: token.id, state: token.state });
      });
      return true;
    },

    /**
     * Clear all tokens from all places and the canvas.
     * Does not affect the net definition (source document).
     */
    reset() {
      handle.change((d) => {
        for (const placeId of Object.keys(d.tokens)) {
          d.tokens[placeId] = [];
        }
        d.canvas.splice(0, d.canvas.length);
      });
    },
  };
}
