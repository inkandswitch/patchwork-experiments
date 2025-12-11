import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import "@inkandswitch/patchwork-elements";
import { AgentDoc, buildSystemPrompt } from "./agent";
import { toolify } from "../chat/utils";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { useEffect, useState } from "react";

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
        <pre className="text-xs bg-base-200 p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
          {systemPrompt}
        </pre>
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
          <FolderView docUrl={agentDoc.contextFolderUrl} />
        )}
      </section>
    </div>
  );
};

export const renderAgentView = toolify(AgentView);

const FolderView = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [folderDoc] = useDocument<FolderDoc>(docUrl, {
    suspense: true,
  });

  return (
    <div className="flex flex-col gap-2">
      {folderDoc.docs.map((doc, index) => (
        <div key={index}>
          <h4 className="text-sm font-medium text-base-content/70 mb-2">
            {doc.name}
          </h4>
          <div className="border border-base-300 rounded-md overflow-auto max-h-[500px]">
            <patchwork-view key={doc.url} doc-url={doc.url} />
          </div>
        </div>
      ))}
    </div>
  );
};

function useSystemPrompt(agentDocUrl: AutomergeUrl) {
  const [prompt, setPrompt] = useState<string>("");
  const repo = useRepo();

  useEffect(() => {
    buildSystemPrompt(agentDocUrl, repo).then(setPrompt);
  }, [agentDocUrl, repo]);

  return prompt;
}
