import { AutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { BotIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import "./styles.css";
import { ChatDoc, ChatMessage } from "./types";
import "@inkandswitch/patchwork-elements";
import { formatTimestamp, toolify, useCurrentContactUrl } from "./utils";

const FIVE_MINUTES_MS = 1000 * 60 * 5;

const Chat = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [chatDoc, changeChatDoc] = useDocument<ChatDoc>(docUrl, {
    suspense: true,
  });
  const [pendingMessage, setPendingMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const contactUrl = useCurrentContactUrl();

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
        content: pendingMessage,
      },
      timestamp: Date.now(),
    };

    changeChatDoc((doc: ChatDoc) => {
      if (!doc.messages) doc.messages = [];
      doc.messages.push(message);
    });

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
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <MessageSquareIcon size={16} />
        <span className="font-semibold">Chat</span>
      </div>

      {/* Attached Agents Section */}
      {chatDoc.agentDocUrls && chatDoc.agentDocUrls.length > 0 && (
        <div className="px-4 py-2 border-b bg-base-200">
          <div className="flex items-center gap-2 text-sm">
            <BotIcon size={14} />
            <span className="font-medium">Attached agents:</span>
            <div className="flex gap-2 flex-wrap">
              {chatDoc.agentDocUrls.map((agentUrl, idx) => {
                const { documentId } = parseAutomergeUrl(agentUrl);

                return (
                  <a
                    key={agentUrl}
                    className="badge badge-sm badge-primary cursor-pointer"
                    title={agentUrl}
                    href={`#doc=${documentId}&tool=agent`}
                  >
                    Agent {idx + 1}
                  </a>
                );
              })}
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

// Render a single message content
const MessageRenderer = ({ message }: { message: ChatMessage }) => {
  if (message.content.type === "text") {
    const content = message.content.content;
    if (!content || !content.trim()) {
      return null;
    }

    return <Markdown>{content}</Markdown>;
  }

  // For now, throw for other message types
  throw new Error(`Unsupported message type: ${message.content.type}`);
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
      <div className="flex flex-col gap-2 bg-neutral-100 rounded-md p-2 flex-1">
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
          <MessageRenderer key={message.id || idx} message={message} />
        ))}
      </div>
    </div>
  );
};
