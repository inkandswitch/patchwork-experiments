import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import "@inkandswitch/patchwork-elements";
import { AgentDoc, buildSystemPrompt } from "./agent";
import { toolify } from "../chat/utils";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import "./markdown.css";

const AgentView = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [agentDoc] = useDocument<AgentDoc>(docUrl, {
    suspense: true,
  });

  const systemPrompt = useSystemPrompt(docUrl);

  return (
    <div className="w-full h-full overflow-auto p-4 flex flex-col gap-6">
      <patchwork-view doc-url={agentDoc.contactUrl} tool-id="contact-avatar" />

      <section>
        <h3 className="text-sm font-medium text-base-content/70 mb-2">
          Prompt
        </h3>
        <Markdown className="markdown">{systemPrompt}</Markdown>
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

export const renderAgentView = toolify(AgentView);

function useSystemPrompt(agentDocUrl: AutomergeUrl) {
  const [prompt, setPrompt] = useState<string>("");
  const repo = useRepo();

  useEffect(() => {
    buildSystemPrompt(agentDocUrl, repo).then(setPrompt);
  }, [agentDocUrl, repo]);

  return prompt;
}
