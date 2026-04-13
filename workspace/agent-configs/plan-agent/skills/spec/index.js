/**
 * Spec skill — read SpecDoc trees.
 *
 * SpecDoc shape (standalone Automerge document):
 *   {
 *     '@patchwork': { type: 'spec' },
 *     spec: {
 *       goal: string,
 *       verificationUrls: AutomergeUrl[],
 *       subSpecUrls?: AutomergeUrl[],
 *       filesFolderUrl?: AutomergeUrl,
 *     }
 *   }
 */

/**
 * Get a read-only handle for a SpecDoc.
 *
 * @param {string} url - Automerge URL of the SpecDoc
 * @returns {Promise<object>} Spec handle with accessor methods
 */
export async function getSpec(url) {
  const handle = await repo.find(url);
  return createSpecHandle(handle, url);
}

function createSpecHandle(handle, url) {
  return {
    url,

    getGoal() {
      return handle.doc()?.spec?.goal ?? '';
    },

    getVerificationUrls() {
      return [...(handle.doc()?.spec?.verificationUrls ?? [])];
    },

    getSubSpecUrls() {
      return [...(handle.doc()?.spec?.subSpecUrls ?? [])];
    },

    getFilesFolderUrl() {
      return handle.doc()?.spec?.filesFolderUrl ?? null;
    },
  };
}

/**
 * Recursively collect all leaf specs from a SpecDoc tree.
 *
 * A leaf spec is one with no subSpecUrls. If the root has no children,
 * the root itself is the leaf.
 *
 * @param {string} rootUrl - Automerge URL of the root SpecDoc
 * @returns {Promise<object[]>} Array of spec handles for each leaf
 */
export async function getLeafSpecs(rootUrl) {
  const visited = new Set();
  const leaves = [];

  async function traverse(url) {
    if (visited.has(url)) return;
    visited.add(url);

    const spec = await getSpec(url);
    const subSpecUrls = spec.getSubSpecUrls();

    if (subSpecUrls.length === 0) {
      leaves.push(spec);
    } else {
      for (const childUrl of subSpecUrls) {
        await traverse(childUrl);
      }
    }
  }

  await traverse(rootUrl);
  return leaves;
}
