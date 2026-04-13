/**
 * Plan skill — manage a PlanDoc containing references to separate TaskDoc documents.
 *
 * PlanDoc shape:
 *   { tasks: AutomergeUrl[] }
 *
 * TaskDoc shape (separate document):
 *   { goal: string, dependsOn: AutomergeUrl[], artifacts: Record<string, AutomergeUrl>, specDocUrl: AutomergeUrl }
 */

/**
 * Create a new PlanDoc.
 *
 * repo.create() is SYNCHRONOUS — do NOT await this function.
 *
 * @returns {{ handle: object, url: string }} The new doc handle and its URL
 */
export function createPlan() {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'plan' };
    d.tasks = [];
  });
  return { handle, url: handle.url };
}

/**
 * Get a read/write interface for a PlanDoc.
 *
 * @param {string} url - Automerge URL of the PlanDoc
 */
export async function getPlan(url) {
  const handle = await repo.find(url);

  return {
    getTasks() {
      return [...(handle.doc()?.tasks ?? [])];
    },

    addTask(goal, specDocUrl) {
      const taskHandle = repo.create();
      taskHandle.change((d) => {
        d['@patchwork'] = { type: 'task' };
        d.goal = goal || '';
        d.dependsOn = [];
        d.artifacts = {};
        d.specDocUrl = specDocUrl || '';
      });

      handle.change((d) => {
        if (!d.tasks) d.tasks = [];
        d.tasks.push(taskHandle.url);
      });

      return createTaskHandle(taskHandle);
    },

    async getTask(taskUrl) {
      const taskHandle = await repo.find(taskUrl);
      return createTaskHandle(taskHandle);
    },

    removeTask(taskUrl) {
      handle.change((d) => {
        if (!d.tasks) return;
        const idx = d.tasks.indexOf(taskUrl);
        if (idx !== -1) d.tasks.splice(idx, 1);
      });
    },
  };
}

function createTaskHandle(taskHandle) {
  return {
    url: taskHandle.url,

    getGoal() {
      return taskHandle.doc()?.goal ?? '';
    },

    setGoal(goal) {
      taskHandle.change((d) => {
        d.goal = goal;
      });
    },

    getSpecDocUrl() {
      return taskHandle.doc()?.specDocUrl ?? '';
    },

    setSpecDocUrl(url) {
      taskHandle.change((d) => {
        d.specDocUrl = url;
      });
    },

    getDependsOn() {
      return [...(taskHandle.doc()?.dependsOn ?? [])];
    },

    addDependency(taskUrl) {
      taskHandle.change((d) => {
        if (!d.dependsOn) d.dependsOn = [];
        if (!d.dependsOn.includes(taskUrl)) {
          d.dependsOn.push(taskUrl);
        }
      });
    },

    removeDependency(taskUrl) {
      taskHandle.change((d) => {
        if (!d.dependsOn) return;
        const idx = d.dependsOn.indexOf(taskUrl);
        if (idx !== -1) d.dependsOn.splice(idx, 1);
      });
    },

    getArtifacts() {
      return { ...(taskHandle.doc()?.artifacts ?? {}) };
    },

    setArtifact(name, url) {
      taskHandle.change((d) => {
        if (!d.artifacts) d.artifacts = {};
        d.artifacts[name] = url;
      });
    },

    removeArtifact(name) {
      taskHandle.change((d) => {
        if (d.artifacts && d.artifacts[name] !== undefined) {
          delete d.artifacts[name];
        }
      });
    },
  };
}
