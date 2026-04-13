/**
 * Execution skill — manage TaskListExecutionDoc, create artifacts, update task statuses.
 */

/**
 * Get a read/write interface for a TaskListExecutionDoc.
 *
 * @param {string} url - Automerge URL of the execution doc
 * @returns {Promise<object>} Execution handle
 */
export async function getExecution(url) {
  const handle = await repo.find(url);

  return {
    getTaskUrls() {
      return [...(handle.doc()?.taskUrls ?? [])];
    },

    getArtifactsFolderUrl() {
      return handle.doc()?.artifactsFolderUrl ?? '';
    },

    getStatus() {
      return handle.doc()?.status ?? 'in-progress';
    },

    setStatus(status) {
      handle.change((d) => {
        d.status = status;
      });
    },
  };
}

/**
 * Create a new DatalogDoc artifact with the given title and facts.
 *
 * repo.create() is SYNCHRONOUS — do NOT await this function.
 *
 * @param {string} title - Document title
 * @param {{ pred: string, args: (string|number)[] }[]} facts - Array of facts
 * @returns {{ url: string }} The artifact URL
 */
export function createArtifact(title, facts) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = title;
    d.facts = facts.map((f) => ({ pred: f.pred, args: [...f.args] }));
    d.rules = [];
    d.constraints = [];
    d.draftText = buildDraftText(title, facts);
    d.mapStyle = { lines: {}, properties: {} };
  });
  return { url: handle.url };
}

/**
 * Add an ArtifactFolderEntry to the artifacts folder.
 *
 * @param {string} folderUrl - Automerge URL of the folder doc
 * @param {{ type: string, name: string, url: string, specDocUrls?: string[] }} entry
 */
export async function addToArtifactsFolder(folderUrl, entry) {
  const handle = await repo.find(folderUrl);
  handle.change((d) => {
    if (!d.docs) d.docs = [];
    const newEntry = {
      type: entry.type,
      name: entry.name,
      url: entry.url,
    };
    if (entry.specDocUrls) {
      newEntry.specDocUrls = [...entry.specDocUrls];
    }
    d.docs.push(newEntry);
  });
}

/**
 * Update a TaskDoc's status.
 *
 * @param {string} taskUrl - Automerge URL of the task doc
 * @param {'pending' | 'in-progress' | 'completed' | 'failed'} status
 */
export async function updateTaskStatus(taskUrl, status) {
  const handle = await repo.find(taskUrl);
  handle.change((d) => {
    d.status = status;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDraftText(title, facts) {
  const lines = [`% ${title}`];
  for (const f of facts) {
    if (f.args.length === 0) {
      lines.push(`${f.pred}.`);
    } else {
      lines.push(`${f.pred}(${f.args.join(', ')}).`);
    }
  }
  return lines.join('\n');
}
