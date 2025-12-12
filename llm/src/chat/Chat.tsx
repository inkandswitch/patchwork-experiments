import { AutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import "@inkandswitch/patchwork-elements";
import {
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { AgentDoc, step } from "../agent/agent";
import "./styles.css";
import {
  ActionBlock,
  ChatDoc,
  ChatMessage,
  EmbedBlock,
  ThinkingBlock,
} from "./types";
import {
  extractAutomergeUrls,
  formatTimestamp,
  toolify,
  useCurrentContactUrl,
} from "./utils";

const FIVE_MINUTES_MS = 1000 * 60 * 5;

const Chat = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const repo = useRepo();
  const [chatDoc, changeChatDoc] = useDocument<ChatDoc>(docUrl, {
    suspense: true,
  });
  const [agentDoc, changeAgentDoc] = useDocument<AgentDoc>(
    chatDoc.agentDocUrl,
    {
      suspense: true,
    }
  );
  const [pendingMessage, setPendingMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const contactUrl = useCurrentContactUrl();

  // link agent doc to chat
  // we can't do that in init because we don't know the url of the chat doc in that method
  useEffect(() => {
    if (agentDoc.chatDocUrl !== docUrl) {
      changeAgentDoc((doc: AgentDoc) => {
        doc.chatDocUrl = docUrl;
      });
    }
  }, [agentDoc]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView();
  }, [chatDoc?.messages]);

  // Handle sending message
  const handleUserMessage = async () => {
    if (!pendingMessage.trim()) {
      return;
    }

    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      author: contactUrl,
      content: {
        type: "text",
        text: pendingMessage,
      },
      timestamp: Date.now(),
    };

    changeChatDoc((doc: ChatDoc) => {
      if (!doc.messages) doc.messages = [];
      doc.messages.push(message);
    });

    step(chatDoc.agentDocUrl, repo);

    const urls = extractAutomergeUrls(pendingMessage);
    const datatypes = getRegistry("patchwork:datatype");

    // add new docs to context folder

    for (const url of urls) {
      const contextFolderHandle = await repo.find<FolderDoc>(
        agentDoc.contextFolderUrl
      );
      const contextFolderDoc = contextFolderHandle.doc();

      if (contextFolderDoc.docs.some((doc) => doc.url === url)) {
        continue;
      }

      const newDoc = (await repo.find<HasPatchworkMetadata>(url)).doc();
      const type = newDoc["@patchwork"].type;
      const datatype = await datatypes.load(type);
      const title = datatype?.module.getTitle(newDoc) ?? "Unknown";

      contextFolderHandle.change((doc) => {
        doc.docs.push({
          url,
          name: title,
          type,
        });
      });
    }

    setPendingMessage("");
  };

  if (!chatDoc) {
    return (
      <div className="flex justify-center items-center h-full p-4">
        <div className="alert">
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  const messageGroups = groupMessages(chatDoc.messages || []);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Attached Agents Section */}
      {chatDoc.agentDocUrl && (
        <div className="px-4 py-2 border-b bg-base-200">
          <div className="flex items-center gap-2 text-sm">
            <BotIcon size={14} />
            <span className="font-medium">Attached agent:</span>
            <div className="flex gap-2 flex-wrap">
              <a
                key={chatDoc.agentDocUrl}
                className="badge badge-sm p-2 cursor-pointer"
                title={chatDoc.agentDocUrl}
                href={`#doc=${
                  parseAutomergeUrl(chatDoc.agentDocUrl).documentId
                }&tool=agent`}
              >
                Agent
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4 min-h-0">
        {messageGroups.map((group, index) => (
          <MessageGroupRenderer
            key={`group-${index}-${group.timestamp}`}
            group={group}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex flex-col gap-2 p-2">
        <div className="relative">
          <textarea
            value={pendingMessage}
            className="textarea textarea-bordered w-full h-20 resize-none"
            onChange={(e) => setPendingMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (pendingMessage.trim()) {
                  handleUserMessage();
                }
              }
            }}
            placeholder="Type your message..."
          />
          <button
            onClick={handleUserMessage}
            className="btn btn-ghost btn-sm absolute bottom-2 right-2 h-8 w-8 min-h-0 p-0"
            disabled={!pendingMessage.trim()}
          >
            <SendIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export const renderChat = toolify(Chat);

// Group messages by author and time proximity
type MessageGroup = {
  author: AutomergeUrl;
  messages: ChatMessage[];
  timestamp: number;
};

const groupMessages = (messages: ChatMessage[]): MessageGroup[] => {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    const timeSinceLastGroup = lastGroup
      ? message.timestamp - lastGroup.timestamp
      : Infinity;

    const shouldStartNewGroup =
      !lastGroup ||
      lastGroup.author !== message.author ||
      timeSinceLastGroup > FIVE_MINUTES_MS;

    if (shouldStartNewGroup) {
      groups.push({
        author: message.author,
        messages: [message],
        timestamp: message.timestamp,
      });
    } else {
      lastGroup.messages.push(message);
    }
  }

  return groups;
};

// Render a group of messages from the same author
const MessageGroupRenderer = ({ group }: { group: MessageGroup }) => {
  const [contactDoc] = useDocument<{ name?: string }>(group.author, {
    suspense: true,
  });

  return (
    <div className="flex gap-2">
      <div className="w-fit">
        <patchwork-view doc-url={group.author} tool-id="contact-avatar" />
      </div>
      <div className="flex flex-col gap-2 rounded-md p-2 flex-1">
        <div className="flex items-center gap-2 ">
          <span className="text-sm font-medium">
            {contactDoc.name ?? "Anonymous"}
          </span>
          <span className="opacity-50 text-xs whitespace-nowrap">
            {formatTimestamp(group.timestamp)}
          </span>
        </div>

        {/* Messages and timestamp */}
        {group.messages.map((message, idx) => (
          <MessageView key={message.id || idx} message={message} />
        ))}
      </div>
    </div>
  );
};

// Render a single message content
const MessageView = ({ message }: { message: ChatMessage }) => {
  const content = message.content;

  if (content.type === "text") {
    if (!content.text || !content.text.trim()) {
      return null;
    }
    return <Markdown>{content.text}</Markdown>;
  }

  if (content.type === "thinking") {
    return <ThinkingBlockView value={content} />;
  }

  if (content.type === "action") {
    return <ActionBlockView value={content} />;
  }

  if (content.type === "embed") {
    return <EmbedBlockView value={content} />;
  }
};

// Render a thinking block (collapsible)
const ThinkingBlockView = ({ value }: { value: ThinkingBlock }) => {
  return (
    <details className="group rounded-lg border border-base-300 bg-base-200/50">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          size={14}
          className="text-base-content/50 transition-transform group-open:rotate-90"
        />
        <span className="text-xs font-medium text-base-content/70">
          Thinking
        </span>
        <span className="text-sm text-base-content/80 truncate">
          {value.description}
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 text-sm text-base-content/90 border-t border-base-300">
        <Markdown>{value.text}</Markdown>
      </div>
    </details>
  );
};

// Render an action block (collapsible with status indicator)
const ActionBlockView = ({ value }: { value: ActionBlock }) => {
  const isSuccess = value.action?.result?.type === "success";
  const isError = value.action?.result?.type === "error";
  const isPending = !value.action?.result;

  return (
    <details className="group rounded-lg border border-base-300 bg-base-200/50">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-center w-4 h-4">
          {isPending && (
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
          )}
          {isSuccess && <CheckIcon size={14} className="text-success" />}
          {isError && <XIcon size={14} className="text-error" />}
        </span>
        <span className="text-sm text-base-content/80">
          {value.description}
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-base-300">
        {value.action && <pre>{JSON.stringify(value.action, null, 2)}</pre>}
      </div>
    </details>
  );
};

// Render an embedded document view
const EmbedBlockView = ({ value }: { value: EmbedBlock }) => {
  const [doc] = useDocument<HasPatchworkMetadata>(value.documentUrl, {
    suspense: true,
  });
  const [title, setTitle] = useState<string>("Loading...");

  useEffect(() => {
    const loadTitle = async () => {
      const type = doc?.["@patchwork"]?.type;
      if (!type) {
        setTitle("Unknown Document");
        return;
      }

      try {
        const datatype = await getRegistry("patchwork:datatype").load(type);
        if (datatype?.module?.getTitle) {
          setTitle(datatype.module.getTitle(doc) || "Untitled");
        } else {
          setTitle("Untitled");
        }
      } catch {
        setTitle("Unknown Document");
      }
    };

    loadTitle();
  }, [doc]);

  const documentId = parseAutomergeUrl(value.documentUrl).documentId;
  const openUrl = `#doc=${documentId}&tool=${value.toolId}`;

  return (
    <div className="rounded-lg border border-base-300 overflow-hidden">
      <div className="h-64 overflow-auto">
        <patchwork-view doc-url={value.documentUrl} tool-id={value.toolId} />
      </div>
    </div>
  );
};
