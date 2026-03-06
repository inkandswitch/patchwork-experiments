/**
 * Search skill — recursively search document contents for a text or regex pattern.
 */

/**
 * Recursively search for a pattern across all documents under a folder URL.
 *
 * @param {object} repo - The automerge Repo (available as global `repo`)
 * @param {string | RegExp} pattern - Text (case-insensitive) or RegExp to search for
 * @param {string} startUrl - Automerge URL of the folder to start from
 * @returns {Promise<Array<{ url: string, name: string, line: string, lineNumber: number }>>}
 */
export async function search(repo, pattern, startUrl) {
  const results = [];
  const matcher =
    pattern instanceof RegExp
      ? (line) => pattern.test(line)
      : (line) => line.toLowerCase().includes(pattern.toLowerCase());

  async function walk(url, name) {
    const handle = await repo.find(url);
    await handle.whenReady();
    const doc = handle.doc();
    if (!doc) return;

    if (Array.isArray(doc.docs)) {
      for (const entry of doc.docs) {
        await walk(entry.url, entry.name);
      }
    } else {
      let content;
      if (typeof doc.content === "string") {
        content = doc.content;
      } else if (doc.content instanceof Uint8Array) {
        content = new TextDecoder().decode(doc.content);
      } else {
        return;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matcher(lines[i])) {
          results.push({ url, name: name || url, line: lines[i], lineNumber: i + 1 });
        }
      }
    }
  }

  await walk(startUrl, "");
  return results;
}
