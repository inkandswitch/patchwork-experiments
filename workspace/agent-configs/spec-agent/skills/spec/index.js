/**
 * Spec skill — manage a SpecDoc: goal, linked Datalog database, and JS verifications.
 *
 * SpecDoc shape:
 *   { title: string, goal: string, datalogUrl?: AutomergeUrl, verifications: Verification[] }
 *
 * Verification:
 *   { name: string, script: string }
 */

/**
 * Get a read/write interface for a SpecDoc.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the SpecDoc
 */
export async function getSpec(repo, url) {
  const handle = await repo.find(url);

  return {
    getGoal() {
      return handle.doc()?.goal ?? '';
    },

    setGoal(goal) {
      handle.change((d) => {
        d.goal = goal;
      });
    },

    getTitle() {
      return handle.doc()?.title ?? '';
    },

    setTitle(title) {
      handle.change((d) => {
        d.title = title;
      });
    },

    getDatalogUrl() {
      return handle.doc()?.datalogUrl;
    },

    setDatalogUrl(datalogUrl) {
      handle.change((d) => {
        d.datalogUrl = datalogUrl;
      });
    },

    getVerifications() {
      return [...(handle.doc()?.verifications ?? [])];
    },

    addVerification(name, script) {
      handle.change((d) => {
        if (!d.verifications) d.verifications = [];
        d.verifications.push({ name, script });
      });
    },

    removeVerification(name) {
      handle.change((d) => {
        const idx = (d.verifications ?? []).findIndex((v) => v.name === name);
        if (idx !== -1) d.verifications.splice(idx, 1);
      });
    },

    async runVerifications(repo) {
      const doc = handle.doc();
      const verifications = doc?.verifications ?? [];
      const specUrl = url;
      const datalogUrl = doc?.datalogUrl;
      const results = [];

      for (const v of verifications) {
        try {
          const fn = new Function(
            'repo',
            'specUrl',
            'datalogUrl',
            `return (async () => {\n${v.script}\n})();`,
          );
          const result = await fn(repo, specUrl, datalogUrl);
          results.push({ name: v.name, passed: result === true, error: undefined });
        } catch (err) {
          results.push({ name: v.name, passed: false, error: err.message || String(err) });
        }
      }

      return results;
    },
  };
}
