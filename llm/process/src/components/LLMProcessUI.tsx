import { useEffect, useState } from 'react';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { toolify } from '@inkandswitch/patchwork-react';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { LLMProcessDoc, WorkspaceDoc } from '../types';
import { AutomergeFS } from '../fs';
import '../styles.css';

type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: any;
};

type Tab = 'chat' | 'files' | 'review' | 'context';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'review', label: 'Review' },
  { id: 'context', label: 'Context' },
];

const LLMProcessEditor = ({ docUrl }: ReactToolProps) => {
  const repo = useRepo();
  const [doc] = useDocument<LLMProcessDoc>(docUrl, { suspense: true });
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // make fs of current llm process available on window
  useEffect(() => {
    let cancelled = false;
    repo.find<WorkspaceDoc>(doc.workspaceUrl).then((wsHandle) => {
      if (cancelled) return;
      (window as any).fs = new AutomergeFS(repo, wsHandle);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, doc.workspaceUrl]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-1.5 text-xs text-base-content/40 bg-base-300">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`px-2 py-0.5 rounded transition-colors ${
              activeTab === tab.id
                ? 'text-base-content/80 bg-base-100/60 dark:bg-base-content/[0.08]'
                : 'hover:text-base-content/60'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === 'chat' && (
          <patchwork-view
            doc-url={docUrl}
            tool-id="llm-process-chat"
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        )}
        {activeTab === 'files' && doc.workspaceUrl && (
          <patchwork-view
            doc-url={doc.workspaceUrl}
            tool-id="workspace-browser"
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        )}
        {activeTab === 'review' && doc.workspaceUrl && (
          <patchwork-view
            doc-url={doc.workspaceUrl}
            tool-id="workspace-review"
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        )}
        {activeTab === 'context' && (
          <patchwork-view
            doc-url={docUrl}
            tool-id="llm-process-context"
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        )}
      </div>
    </div>
  );
};

export const renderLLMProcessEditor: ToolImplementation = toolify(LLMProcessEditor);
