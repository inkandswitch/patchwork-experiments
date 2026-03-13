import { useState, useEffect } from 'react';
import { useDocuments } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';

type AnyDoc = Record<string, unknown>;

/**
 * Re-export of useDocuments from automerge-repo-react-hooks.
 * Takes a list of AutomergeUrls and returns a live Map of url -> document.
 * Automatically subscribes to changes on each document.
 */
export { useDocuments };

export interface TreeEdge {
  source: AutomergeUrl;
  target: AutomergeUrl;
}

export interface DocumentTree {
  /** Live map of all discovered documents in the copy lineage */
  docs: Map<AutomergeUrl, AnyDoc>;
  /** Parent -> child edges derived from copies/copyOf relationships */
  edges: TreeEdge[];
}

function getPatchworkMeta(doc: AnyDoc): { copies?: AutomergeUrl[]; copyOf?: AutomergeUrl } {
  const meta = doc['@patchwork'];
  if (!meta || typeof meta !== 'object') return {};
  const m = meta as Record<string, unknown>;
  return {
    copies: Array.isArray(m['copies']) ? (m['copies'] as AutomergeUrl[]) : undefined,
    copyOf: typeof m['copyOf'] === 'string' ? (m['copyOf'] as AutomergeUrl) : undefined,
  };
}

/**
 * Recursively discovers all documents in the copy lineage of a root document.
 * Traverses both upward (via copyOf) and downward (via copies), subscribing
 * to each discovered document live.
 */
export function useDocumentTree(rootUrl: AutomergeUrl): DocumentTree {
  const [knownUrls, setKnownUrls] = useState<AutomergeUrl[]>([rootUrl]);

  // useDocuments suspense:false so we get undefined docs while loading (no Suspense boundary needed)
  const [docs] = useDocuments<AnyDoc>(knownUrls, { suspense: false });

  // Expand the known URL set as documents load and reveal their relationships
  useEffect(() => {
    const discovered: AutomergeUrl[] = [];

    for (const [, doc] of docs) {
      if (!doc) continue;
      const { copies, copyOf } = getPatchworkMeta(doc as AnyDoc);
      if (copies) {
        for (const url of copies) discovered.push(url);
      }
      if (copyOf) {
        discovered.push(copyOf);
      }
    }

    if (discovered.length === 0) return;

    setKnownUrls((prev) => {
      const prevSet = new Set(prev);
      const next = [...prev];
      let changed = false;
      for (const url of discovered) {
        if (!prevSet.has(url)) {
          next.push(url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [docs]);

  // Build edges from the loaded documents
  const edges: TreeEdge[] = [];
  const seen = new Set<string>();

  const addEdge = (source: AutomergeUrl, target: AutomergeUrl) => {
    const key = `${source}->${target}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ source, target });
    }
  };

  for (const [url, doc] of docs) {
    if (!doc) continue;
    const { copies, copyOf } = getPatchworkMeta(doc as AnyDoc);
    if (copies) {
      for (const childUrl of copies) addEdge(url, childUrl);
    }
    if (copyOf) {
      addEdge(copyOf, url);
    }
  }

  // Cast docs to the correct type (useDocuments returns Map<url, Doc<T>>, Doc<T> ~= T)
  return { docs: docs as unknown as Map<AutomergeUrl, AnyDoc>, edges };
}
