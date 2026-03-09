import { useEffect, useMemo, useState } from 'react';
import { useDocuments } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';

export interface NodeInfo {
  url: AutomergeUrl;
  copyOf?: AutomergeUrl;
  copies: AutomergeUrl[];
  title: string;
  type: string;
}

export interface NodeTree {
  nodes: Map<AutomergeUrl, NodeInfo>;
  rootUrl: AutomergeUrl | null;
}

interface AnyDoc {
  '@patchwork'?: {
    type?: string;
    copies?: AutomergeUrl[];
    copyOf?: AutomergeUrl;
  };
  title?: string;
}

export function useNodeTree(initialUrl: AutomergeUrl): NodeTree {
  const [knownUrls, setKnownUrls] = useState<AutomergeUrl[]>([initialUrl]);

  const [docs] = useDocuments<AnyDoc>(knownUrls);

  // Discover new URLs from loaded docs and expand knownUrls
  useEffect(() => {
    const newUrls: AutomergeUrl[] = [];
    const knownSet = new Set(knownUrls);

    for (const doc of docs.values()) {
      if (!doc) continue;
      const pm = doc['@patchwork'];
      if (pm?.copyOf && !knownSet.has(pm.copyOf)) {
        newUrls.push(pm.copyOf);
      }
      for (const copyUrl of pm?.copies ?? []) {
        if (!knownSet.has(copyUrl)) {
          newUrls.push(copyUrl);
        }
      }
    }

    if (newUrls.length > 0) {
      setKnownUrls((prev) => [...new Set([...prev, ...newUrls])]);
    }
  }, [docs, knownUrls]);

  const tree = useMemo<NodeTree>(() => {
    const nodes = new Map<AutomergeUrl, NodeInfo>();

    for (const [url, doc] of docs.entries()) {
      if (!doc) continue;
      const pm = doc['@patchwork'];
      nodes.set(url, {
        url,
        copyOf: pm?.copyOf,
        copies: (pm?.copies ?? []) as AutomergeUrl[],
        title: doc.title ?? pm?.type ?? url.slice(-8),
        type: pm?.type ?? 'unknown',
      });
    }

    // Find root: walk copyOf from initialUrl until we reach a node with no parent
    let rootUrl: AutomergeUrl | null = null;
    let current: AutomergeUrl = initialUrl;
    const visited = new Set<AutomergeUrl>();
    while (!visited.has(current)) {
      visited.add(current);
      const node = nodes.get(current);
      if (!node?.copyOf) {
        rootUrl = current;
        break;
      }
      current = node.copyOf;
    }

    return { nodes, rootUrl };
  }, [docs, initialUrl]);

  return tree;
}
