import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo";

export function getEditableModule(repo, url) {
  const automergePrefix = url.match(/^automerge:[^/\s#]+/)?.[0];
  if (!automergePrefix) throw new Error(`Invalid automerge URL: ${url}`);
  const { documentId } = parseAutomergeUrl(automergePrefix);
  const folderUrl = stringifyAutomergeUrl({ documentId });
  const folderHandle = repo.find(folderUrl);

  function getFolderDoc() {
    const doc = folderHandle.doc();
    if (!doc) throw new Error("Folder document not loaded");
    return doc;
  }

  function stripHeads(automergeUrl) {
    const { documentId } = parseAutomergeUrl(automergeUrl);
    return stringifyAutomergeUrl({ documentId });
  }

  function withHeads(handle) {
    const { documentId } = parseAutomergeUrl(handle.url);
    return stringifyAutomergeUrl({ documentId, heads: handle.heads() });
  }

  return {
    folderUrl,
    folderHandle,

    listFiles() {
      return (getFolderDoc().docs || []).map((d) => ({
        name: d.name,
        type: d.type,
        url: d.url,
      }));
    },

    async readFile(name) {
      const link = getFolderDoc().docs?.find((d) => d.name === name);
      if (!link) throw new Error(`File not found: ${name}`);
      const handle = repo.find(stripHeads(link.url));
      await handle.whenReady();
      const doc = handle.doc();
      if (typeof doc.content === "string") return doc.content;
      return JSON.stringify(doc, null, 2);
    },

    async addFile(name, content) {
      const fileHandle = repo.create();
      fileHandle.change((d) => {
        d.content = content;
      });
      folderHandle.change((d) => {
        if (!d.docs) d.docs = [];
        d.docs.push({ name, type: "file", url: withHeads(fileHandle) });
      });
      return fileHandle;
    },

    async updateFile(name, content) {
      const link = getFolderDoc().docs?.find((d) => d.name === name);
      if (!link) throw new Error(`File not found: ${name}`);
      const handle = repo.find(stripHeads(link.url));
      await handle.whenReady();
      handle.change((d) => {
        d.content = content;
      });
      folderHandle.change((d) => {
        const idx = d.docs.findIndex((e) => e.name === name);
        if (idx !== -1) d.docs[idx].url = withHeads(handle);
      });
      return handle;
    },

    async getDocHandle(name) {
      const link = getFolderDoc().docs?.find((d) => d.name === name);
      if (!link) throw new Error(`File not found: ${name}`);
      const handle = repo.find(stripHeads(link.url));
      await handle.whenReady();
      return handle;
    },
  };
}
