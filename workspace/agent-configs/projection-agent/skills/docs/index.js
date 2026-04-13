/**
 * Docs skill — read any Automerge document by URL.
 *
 * Returns the full document content as a plain JSON object
 * (Automerge proxy stripped via JSON round-trip).
 */

/**
 * Read a document by Automerge URL.
 *
 * @param {string} url - Automerge URL of the document
 * @returns {Promise<object>} The document content as a plain object
 */
export async function readDoc(url) {
  const handle = await repo.find(url);
  const doc = handle.doc();
  if (!doc) throw new Error(`Document not found: ${url}`);
  return JSON.parse(JSON.stringify(doc));
}
