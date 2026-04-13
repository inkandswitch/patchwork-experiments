/**
 * Spec skill — create and manage tree-structured SpecDoc documents.
 *
 * SpecDoc shape (standalone Automerge document):
 *   {
 *     '@patchwork': { type: 'spec' },
 *     spec: {
 *       goal: string,
 *       verificationUrls: AutomergeUrl[],  // Datalog constraint docs
 *       subSpecUrls?: AutomergeUrl[],       // child SpecDoc URLs (root only)
 *       filesFolderUrl?: AutomergeUrl,      // folder of solution artifact files
 *     }
 *   }
 *
 * FolderDoc shape:
 *   { '@patchwork': { type: 'folder' }, docs: [{ name, url, type }] }
 */

/**
 * Create a new SpecDoc.
 *
 * repo.create() is SYNCHRONOUS — do NOT await this function.
 *
 * @param {string} goal - The goal string for this spec
 * @returns {{ handle: object, url: string }}
 */
export function createSpec(goal) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: goal || '',
      verificationUrls: [],
      subSpecUrls: [],
    };
  });
  return { handle, url: handle.url };
}

/**
 * Get a read/write handle for an existing SpecDoc.
 *
 * @param {string} url - Automerge URL of the SpecDoc
 * @returns {Promise<object>} Spec handle with mutation methods
 */
export async function getSpec(url) {
  const handle = await repo.find(url);

  return {
    getGoal() {
      return handle.doc()?.spec?.goal ?? '';
    },

    setGoal(goal) {
      handle.change((d) => {
        if (d.spec) d.spec.goal = goal;
      });
    },

    /** Add a Datalog constraint doc as a verification. Creates a VerificationDoc wrapper. */
    addVerificationDoc(docUrl, options) {
      const verificationHandle = repo.create();
      verificationHandle.change((d) => {
        d['@patchwork'] = { type: 'verification' };
        d.docUrl = docUrl;
        d.script = '';
        if (options?.title) d.title = options.title;
        if (options?.description) d.description = options.description;
      });
      handle.change((d) => {
        if (!d.spec) return;
        if (!d.spec.verificationUrls) d.spec.verificationUrls = [];
        d.spec.verificationUrls.push(verificationHandle.url);
      });
      return verificationHandle.url;
    },

    removeVerificationDoc(verificationUrl) {
      handle.change((d) => {
        if (!d.spec?.verificationUrls) return;
        const idx = d.spec.verificationUrls.indexOf(verificationUrl);
        if (idx !== -1) d.spec.verificationUrls.splice(idx, 1);
      });
    },

    /** Add a child SpecDoc URL to subSpecUrls (root spec only) */
    addSubSpec(specUrl) {
      handle.change((d) => {
        if (!d.spec) return;
        if (!d.spec.subSpecUrls) d.spec.subSpecUrls = [];
        d.spec.subSpecUrls.push(specUrl);
      });
    },

    removeSubSpec(specUrl) {
      handle.change((d) => {
        if (!d.spec?.subSpecUrls) return;
        const idx = d.spec.subSpecUrls.indexOf(specUrl);
        if (idx !== -1) d.spec.subSpecUrls.splice(idx, 1);
      });
    },

    /** Set the files folder URL (for solution artifact files) */
    setFilesFolder(folderUrl) {
      handle.change((d) => {
        if (d.spec) d.spec.filesFolderUrl = folderUrl;
      });
    },

    getUrl() {
      return handle.url;
    },
  };
}

/**
 * Create a new folder doc (for holding solution artifact files).
 *
 * repo.create() is SYNCHRONOUS — do NOT await this function.
 *
 * @returns {{ handle: object, url: string }}
 */
export function createFolder() {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.docs = [];
  });
  return { handle, url: handle.url };
}

/**
 * Add a file entry to a folder doc.
 *
 * @param {string} folderUrl - Automerge URL of the folder doc
 * @param {string} name - Display name for the file
 * @param {string} docUrl - Automerge URL of the document
 * @param {string} type - Document type (e.g. 'datalog', 'text')
 */
export async function addFileToFolder(folderUrl, name, docUrl, type) {
  const handle = await repo.find(folderUrl);
  handle.change((d) => {
    if (!d.docs) d.docs = [];
    d.docs.push({ name, url: docUrl, type: type || 'doc' });
  });
}
