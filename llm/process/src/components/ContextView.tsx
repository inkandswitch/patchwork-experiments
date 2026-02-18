import { useState, useEffect } from 'react';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { toolify } from '@inkandswitch/patchwork-react';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { LLMProcessDoc, WorkspaceDoc } from '../types';
import { AutomergeFS } from '../fs';
import { buildLLMMessages, buildFullSystemPrompt, type ChatMessage } from '../llm-process';

const ROLE_STYLES: Record<ChatMessage['role'], string> = {
  system: 'bg-info/[0.06] border-info/20 text-info/80',
  user: 'bg-base-200/60 dark:bg-base-content/[0.04] border-base-content/[0.06] text-base-content/80',
  assistant: 'bg-success/[0.04] border-success/20 text-base-content/70',
};

const ROLE_LABELS: Record<ChatMessage['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
};

const ContextView = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const repo = useRepo();
  const [doc] = useDocument<LLMProcessDoc>(docUrl, { suspense: true });
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo.find<WorkspaceDoc>(doc.workspaceUrl).then((wsHandle) => {
      if (cancelled) return;
      const fs = new AutomergeFS(repo, wsHandle);
      buildFullSystemPrompt(fs).then((prompt) => {
        if (!cancelled) setSystemPrompt(prompt);
      });
    });
    return () => { cancelled = true; };
  }, [repo, doc.workspaceUrl]);

  if (!systemPrompt) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
        Loading…
      </div>
    );
  }

  const messages: ChatMessage[] =
    doc.runs.length > 0
      ? buildLLMMessages(doc)
      : [{ role: 'system', content: systemPrompt }];

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-4 max-w-[1024px] mx-auto w-full">
      {messages.map((msg, i) => (
        <div key={i} className="mb-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-base-content/30 mb-1">
            {ROLE_LABELS[msg.role]}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto ${ROLE_STYLES[msg.role]}`}
          >
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  );
};

export const renderProcessContext: ToolImplementation = toolify(ContextView);
