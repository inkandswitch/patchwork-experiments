import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import "@inkandswitch/patchwork-elements";
import { AgentDoc, buildSystemPromptParts, PromptPart } from "./agent";
import { toolify } from "../chat/utils";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import "./markdown.css";

const AgentView = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [agentDoc] = useDocument<AgentDoc>(docUrl, {
    suspense: true,
  });

  const promptParts = usePromptParts(docUrl);

  return (
    <div className="w-full h-full overflow-auto p-4 flex flex-col gap-6">
      <patchwork-view doc-url={agentDoc.contactUrl} tool-id="contact-avatar" />

      <section>
        <h3 className="text-sm font-medium text-base-content/70 mb-2">
          Prompt
        </h3>
        <div className="flex flex-col gap-4">
          {promptParts.map((part) => (
            <PromptPartBox key={part.pluginId} part={part} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-base-content/70 mb-2">
          Context
        </h3>
        {!agentDoc.contextFolderUrl ? (
          <div className="py-8 flex items-center justify-center text-base-content/50 text-sm">
            No context folder configured
          </div>
        ) : (
          <patchwork-view
            doc-url={agentDoc.contextFolderUrl}
            tool-id="folder-viewer"
          />
        )}
      </section>
    </div>
  );
};

const PromptPartBox = ({ part }: { part: PromptPart }) => {
  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-base-200 border-b border-base-300">
        <span className="text-xs font-medium text-base-content/70">
          {part.pluginName}
        </span>
      </div>
      <div className="p-3">
        <Markdown className="markdown">{part.content}</Markdown>
      </div>
    </div>
  );
};

export const renderAgentView = toolify(AgentView);

function usePromptParts(agentDocUrl: AutomergeUrl): PromptPart[] {
  const [parts, setParts] = useState<PromptPart[]>([]);
  const repo = useRepo();

  useEffect(() => {
    buildSystemPromptParts(agentDocUrl, repo).then(setParts);
  }, [agentDocUrl, repo]);

  return parts;
}
