/**
 * Spec skill — manage a SpecCollectionDoc containing embedded specs.
 *
 * SpecCollectionDoc shape:
 *   { specs: SpecDoc[] }
 *
 * SpecDoc shape (embedded):
 *   { goal: string, docs: Record<string, AutomergeUrl>, verifications: Verification[] }
 *
 * Verification:
 *   { name: string, script: string, documentUrls: Record<string, AutomergeUrl> }
 */

/**
 * Create a new SpecCollectionDoc.
 *
 * workspace.createDoc() is SYNCHRONOUS — do NOT await this function.
 *
 * @param {object} workspace - The workspace object (global `workspace`)
 * @returns {{ handle: object, url: string }} The new doc handle and its URL
 */
export function createSpecCollection(workspace) {
  const handle = workspace.createDoc();
  handle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.specs = [];
  });
  return { handle, url: handle.url };
}

/**
 * Get a read/write interface for a SpecCollectionDoc.
 *
 * @param {object} workspace - The workspace object (global `workspace`)
 * @param {string} url - Automerge URL of the SpecCollectionDoc
 */
export async function getSpecCollection(workspace, url) {
  const handle = await workspace.find(url);

  return {
    getSpecs() {
      return [...(handle.doc()?.specs ?? [])];
    },

    addSpec(goal) {
      let index;
      handle.change((d) => {
        if (!d.specs) d.specs = [];
        index = d.specs.length;
        d.specs.push({ goal: goal || '', docs: {}, verifications: [] });
      });
      return createSpecHandle(handle, index);
    },

    getSpec(index) {
      return createSpecHandle(handle, index);
    },

    removeSpec(index) {
      handle.change((d) => {
        if (d.specs && index >= 0 && index < d.specs.length) {
          d.specs.splice(index, 1);
        }
      });
    },

    async runAllVerifications(workspace) {
      const specs = handle.doc()?.specs ?? [];
      const results = [];
      for (let i = 0; i < specs.length; i++) {
        const specResults = await runSpecVerifications(workspace, specs[i], i);
        results.push(...specResults);
      }
      return results;
    },
  };
}

function createSpecHandle(handle, index) {
  return {
    getGoal() {
      return handle.doc()?.specs?.[index]?.goal ?? '';
    },

    setGoal(goal) {
      handle.change((d) => {
        if (d.specs?.[index]) d.specs[index].goal = goal;
      });
    },

    getDocs() {
      return { ...(handle.doc()?.specs?.[index]?.docs ?? {}) };
    },

    setDoc(name, docUrl) {
      handle.change((d) => {
        const spec = d.specs?.[index];
        if (!spec) return;
        if (!spec.docs) spec.docs = {};
        spec.docs[name] = docUrl;
      });
    },

    removeDoc(name) {
      handle.change((d) => {
        const docs = d.specs?.[index]?.docs;
        if (docs && docs[name] !== undefined) {
          delete docs[name];
        }
      });
    },

    getVerifications() {
      return [...(handle.doc()?.specs?.[index]?.verifications ?? [])];
    },

    addVerification(name, script, documentUrls) {
      handle.change((d) => {
        const spec = d.specs?.[index];
        if (!spec) return;
        if (!spec.verifications) spec.verifications = [];
        const v = { name, script };
        if (documentUrls) v.documentUrls = documentUrls;
        spec.verifications.push(v);
      });
    },

    removeVerification(name) {
      handle.change((d) => {
        const vs = d.specs?.[index]?.verifications;
        if (!vs) return;
        const idx = vs.findIndex((v) => v.name === name);
        if (idx !== -1) vs.splice(idx, 1);
      });
    },

    async runVerifications(workspace) {
      const spec = handle.doc()?.specs?.[index];
      if (!spec) return [];
      return runSpecVerifications(workspace, spec, index);
    },
  };
}

async function runSpecVerifications(workspace, spec, specIndex) {
  const verifications = spec.verifications ?? [];
  const results = [];

  for (const v of verifications) {
    try {
      const docUrlEntries = Object.entries(v.documentUrls ?? {});
      const paramNames = ['workspace', ...docUrlEntries.map(([k]) => k)];
      const paramValues = [workspace, ...docUrlEntries.map(([, u]) => u)];
      const fn = new Function(...paramNames, `return (async () => {\n${v.script}\n})();`);
      const result = await fn(...paramValues);
      results.push({ specIndex, name: v.name, passed: result === true, error: undefined });
    } catch (err) {
      results.push({ specIndex, name: v.name, passed: false, error: err.message || String(err) });
    }
  }

  return results;
}
