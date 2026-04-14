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
 * Create a DatalogDoc artifact, wrap it in a workflow-artifact doc, and add it
 * to the execution's artifacts folder — all in one step.
 *
 * @param {string} artifactsFolderUrl - Automerge URL of the artifacts folder
 * @param {string} name - Display name for the artifact
 * @param {string} specDocUrl - Automerge URL of the owning leaf spec
 * @param {{ pred: string, args: (string|number)[] }[]} facts - Array of solution facts
 * @returns {Promise<{ artifactUrl: string, workflowArtifactUrl: string }>}
 */
export async function createArtifact(artifactsFolderUrl, name, specDocUrl, facts) {
  const artifactHandle = await repo.create2({
    '@patchwork': { type: 'datalog' },
    title: name,
    facts: facts.map((f) => ({ pred: f.pred, args: [...f.args] })),
    rules: [],
    constraints: [],
    draftText: buildDraftText(name, facts),
    mapStyle: { lines: {}, properties: {} },
  });

  const workflowArtifactHandle = await repo.create2({
    '@patchwork': { type: 'workflow-artifact' },
    name: name || '',
    artifactDocUrl: artifactHandle.url,
    specDocUrl: specDocUrl,
  });

  const folderHandle = await repo.find(artifactsFolderUrl);
  folderHandle.change((d) => {
    if (!d.docs) d.docs = [];
    d.docs.push({
      type: 'workflow-artifact',
      name: name || '',
      url: workflowArtifactHandle.url,
    });
  });

  return { artifactUrl: artifactHandle.url, workflowArtifactUrl: workflowArtifactHandle.url };
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
