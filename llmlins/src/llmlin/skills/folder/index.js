/**
 * Folder skill — list and read files inside a Patchwork folder document.
 */

/**
 * Get an interface for a folder document.
 *
 * @param {object} repo - The automerge Repo (available as global `repo`)
 * @param {string} url - Automerge URL of the folder document
 * @returns {Promise<{ list(): Array, readFile(name: string): Promise<string> }>}
 */
export async function getFolder(repo, url) {
  const handle = await repo.find(url);

  return {
    list() {
      return (handle.doc()?.docs || []).map((d) => ({
        name: d.name,
        type: d.type,
        url: d.url,
      }));
    },

    async readFile(name) {
      const link = (handle.doc()?.docs || []).find((d) => d.name === name);
      if (!link) throw new Error(`Not found: ${name}`);
      const fh = await repo.find(link.url);
      await fh.whenReady();
      const doc = fh.doc();
      if (typeof doc.content === "string") return doc.content;
      if (doc.content instanceof Uint8Array) return new TextDecoder().decode(doc.content);
      return JSON.stringify(doc, null, 2);
    },
  };
}
