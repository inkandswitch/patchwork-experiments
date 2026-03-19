/**
 * P3Net skill — create and manipulate Petri net documents (P3NetDoc).
 *
 * P3NetDoc shape:
 *   { '@patchwork': { type: 'p3net' }, sourceUrl: AutomergeUrl, tokens: NetState, canvas: CanvasToken[] }
 *
 * sourceUrl points to a FolderDoc containing:
 *   - net.js  — the JS source (default-exports a (repo, api) => NetDef factory)
 *   - package.json — { "name": "net", "main": "net.js" }
 *
 * NetState:
 *   { [placeId: string]: TokenInstance[] }
 *
 * TokenInstance:
 *   { id: string, state: { type: string, documentUrl: string } }
 */

function makeTokenId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeSourceFolder(repo, netSource) {
  const jsHandle = repo.create();
  jsHandle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = 'net.js';
    d.extension = 'js';
    d.mimeType = 'application/javascript';
    d.content = netSource;
  });

  const pkgHandle = repo.create();
  pkgHandle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = 'package.json';
    d.extension = 'json';
    d.mimeType = 'application/json';
    d.content = JSON.stringify({ name: 'net', main: 'net.js' });
  });

  const folderHandle = repo.create();
  folderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'net';
    d.docs = [
      { name: 'net.js', type: 'file', url: jsHandle.url },
      { name: 'package.json', type: 'file', url: pkgHandle.url },
    ];
  });

  return { folderHandle, jsHandle };
}

/**
 * Create a new P3NetDoc from a JS source string.
 * Returns the AutomergeUrl of the new P3NetDoc.
 *
 * repo.create() is synchronous — do NOT await this function.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} netSource - JS module source string (must default-export a factory)
 * @returns {string} AutomergeUrl of the new P3NetDoc
 */
export function createDoc(repo, netSource) {
  const { folderHandle } = makeSourceFolder(repo, netSource);

  const netHandle = repo.create();
  netHandle.change((d) => {
    d['@patchwork'] = { type: 'p3net' };
    d.sourceUrl = folderHandle.url;
    d.tokens = {};
    d.canvas = [];
  });

  return netHandle.url;
}

/**
 * Find the net.js handle inside a source folder.
 *
 * @param {object} repo
 * @param {string} folderUrl - AutomergeUrl of the FolderDoc
 * @returns {Promise<object>} DocHandle for net.js
 */
async function findNetJsHandle(repo, folderUrl) {
  const folderHandle = await repo.find(folderUrl);
  const folder = folderHandle.doc();
  if (!folder) throw new Error('[p3net] Source folder not found: ' + folderUrl);
  const link = (folder.docs ?? []).find((d) => d.name === 'net.js');
  if (!link) throw new Error('[p3net] net.js not found in source folder: ' + folderUrl);
  return repo.find(link.url);
}

/**
 * Read the JS source from an existing P3NetDoc.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} url - AutomergeUrl of the P3NetDoc
 * @returns {Promise<{ source: string, sourceUrl: string }>}
 */
export async function readSource(repo, url) {
  const netHandle = await repo.find(url);
  const netDoc = netHandle.doc();
  if (!netDoc) throw new Error('[p3net] Net document not found: ' + url);
  if (!netDoc.sourceUrl) throw new Error('[p3net] Net document has no sourceUrl: ' + url);

  const jsHandle = await findNetJsHandle(repo, netDoc.sourceUrl);
  const jsDoc = jsHandle.doc();
  if (!jsDoc) throw new Error('[p3net] net.js document not found in folder: ' + netDoc.sourceUrl);

  return { source: jsDoc.content ?? '', sourceUrl: netDoc.sourceUrl };
}

/**
 * Replace the JS source of an existing P3NetDoc.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} url - AutomergeUrl of the P3NetDoc
 * @param {string} newSource - New JS module source string
 * @returns {Promise<void>}
 */
export async function writeSource(repo, url, newSource) {
  const netHandle = await repo.find(url);
  const netDoc = netHandle.doc();
  if (!netDoc) throw new Error('[p3net] Net document not found: ' + url);
  if (!netDoc.sourceUrl) throw new Error('[p3net] Net document has no sourceUrl: ' + url);

  const jsHandle = await findNetJsHandle(repo, netDoc.sourceUrl);
  jsHandle.change((d) => {
    d.content = newSource;
  });
}

/**
 * Return all tokens across all places, or only tokens in the given place.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} url - AutomergeUrl of the P3NetDoc
 * @param {string} [placeId] - Optional place ID to filter by
 * @returns {Promise<{ id: string, placeId: string, state: Record<string, unknown> }[]>}
 */
export async function getTokens(repo, url, placeId) {
  const netHandle = await repo.find(url);
  const doc = netHandle.doc();
  if (!doc) throw new Error('[p3net] Net document not found: ' + url);

  const tokens = doc.tokens ?? {};

  if (placeId !== undefined) {
    return (tokens[placeId] ?? []).map((t) => ({
      id: t.id,
      placeId,
      state: JSON.parse(JSON.stringify(t.state)),
    }));
  }

  const result = [];
  for (const [pid, placeTokens] of Object.entries(tokens)) {
    for (const t of placeTokens) {
      result.push({ id: t.id, placeId: pid, state: JSON.parse(JSON.stringify(t.state)) });
    }
  }
  return result;
}

/**
 * Add a token with the given state to a place.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} url - AutomergeUrl of the P3NetDoc
 * @param {string} placeId - Place to add the token to
 * @param {Record<string, unknown>} state - Initial token state
 * @returns {Promise<string>} The new token's ID
 */
export async function addToken(repo, url, placeId, state) {
  const netHandle = await repo.find(url);
  const id = makeTokenId();
  netHandle.change((d) => {
    if (!d.tokens) d.tokens = {};
    if (!d.tokens[placeId]) d.tokens[placeId] = [];
    d.tokens[placeId].push({ id, state: JSON.parse(JSON.stringify(state)) });
  });
  return id;
}

/**
 * Remove a token by ID from a place.
 *
 * @param {object} repo - The automerge Repo
 * @param {string} url - AutomergeUrl of the P3NetDoc
 * @param {string} placeId - Place containing the token
 * @param {string} tokenId - ID of the token to remove
 * @returns {Promise<void>}
 */
export async function removeToken(repo, url, placeId, tokenId) {
  const netHandle = await repo.find(url);
  netHandle.change((d) => {
    const arr = d.tokens?.[placeId];
    if (!arr) return;
    const idx = arr.findIndex((t) => t.id === tokenId);
    if (idx !== -1) arr.splice(idx, 1);
  });
}
