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
  const netHandle = await repo.find(p3netUrl);
  const netDoc = await netHandle.doc();
  const sourceUrl = netDoc?.sourceUrl;
  if (!sourceUrl) throw new Error('P3NetDoc has no sourceUrl');

  const srcHandle = await repo.find(sourceUrl);
  const doc = await srcHandle.doc();
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
  const handleP = repo.find(url);

  async function currentDoc() {
    const handle = await handleP;
    return await handle.doc();
  }

  return {
    async getSourceUrl() {
      const doc = await currentDoc();
      return doc?.sourceUrl;
    },

    async getState() {
      const doc = await currentDoc();
      return doc?.tokens ?? {};
    },

    async getTokens(placeId) {
      const doc = await currentDoc();
      return doc?.tokens?.[placeId] ?? [];
    },

    async getCanvas() {
      const doc = await currentDoc();
      return doc?.canvas ?? [];
    },

    async addToken(placeId, state) {
      const id = crypto.randomUUID();
      const handle = await handleP;
      handle.change((d) => {
        if (!d.tokens[placeId]) d.tokens[placeId] = [];
        d.tokens[placeId].push({ id, state });
      });
      return id;
    },

    async removeToken(placeId, tokenId) {
      const doc = await currentDoc();
      const tokens = doc?.tokens?.[placeId] ?? [];
      const idx = tokens.findIndex((t) => t.id === tokenId);
      if (idx === -1) return false;
      const handle = await handleP;
      handle.change((d) => {
        d.tokens[placeId].splice(idx, 1);
      });
      return true;
    },

    async moveToken(fromPlace, tokenId, toPlace) {
      const doc = await currentDoc();
      const tokens = doc?.tokens?.[fromPlace] ?? [];
      const idx = tokens.findIndex((t) => t.id === tokenId);
      if (idx === -1) return false;
      const token = tokens[idx];
      const handle = await handleP;
      handle.change((d) => {
        d.tokens[fromPlace].splice(idx, 1);
        if (!d.tokens[toPlace]) d.tokens[toPlace] = [];
        d.tokens[toPlace].push({ id: token.id, state: token.state });
      });
      return true;
    },

    async reset() {
      const handle = await handleP;
      handle.change((d) => {
        for (const placeId of Object.keys(d.tokens)) {
          d.tokens[placeId] = [];
        }
        d.canvas.splice(0, d.canvas.length);
      });
    },
  };
}
