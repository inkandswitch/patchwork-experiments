/**
 * Markdown file skill — read and write a single markdown document.
 */

/**
 * Get a read/write interface for a markdown document.
 *
 * @param {object} repo - The automerge Repo (available as global `repo`)
 * @param {string} url - Automerge URL of the markdown document
 * @returns {Promise<{ read(): Promise<string>, write(content: string): void }>}
 */
export async function getMarkdown(repo, url) {
  const handle = await repo.find(url);

  return {
    async read() {
      await handle.whenReady();
      const doc = handle.doc();
      if (!doc) return "";
      if (typeof doc.content === "string") return doc.content;
      if (doc.content instanceof Uint8Array) return new TextDecoder().decode(doc.content);
      return "";
    },

    write(content) {
      handle.change((doc) => {
        doc.content = content;
      });
    },
  };
}
