import { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import outdent from "outdent";
import { createDocOfDatatype } from "../lib";
import { AgentDoc } from "../agent/agent";
import type { LLMContextPlugin } from "./types";

const AGENT_TODO_LIST_NAME = "agent todo list";

type Todo = {
  id: string;
  description: string;
  done: boolean;
};

type TodoDoc = {
  title: string;
  todos: Todo[];
  "@patchwork"?: { type: string };
};

async function getTodoContextPrompt(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return "";
  }

  const todoDocHandle = await findAgentTodoDocHandle(folderHandle, repo);

  if (!todoDocHandle) {
    return ""; // Todo list not initialized yet
  }

  // Get open todos (not done)
  const openTodos = todoDocHandle.doc().todos.filter((todo) => !todo.done);

  const openTodosList =
    openTodos.length > 0
      ? openTodos
          .map((todo) => `  - [${todo.id}] ${todo.description}`)
          .join("\n")
      : "  (no open todos)";

  return outdent`
    ## Task Tracking

    You have a todo list document called "${AGENT_TODO_LIST_NAME}" to track your work.
    url: "${todoDocHandle.url}"
    type: "todo"

    **Important:** Use this todo list to:
    - Break down complex tasks into smaller steps before starting
    - Track progress on multi-step tasks
    - Mark items as done when completed
    - Add new items as you discover additional work needed

    ### Current Open Todos

${openTodosList}

    When working on tasks:
    1. First, add todo items for the steps you plan to take
    2. Work through each item systematically
    3. Mark items as done as you complete them
    4. Add new items if you discover additional work needed
  `;
}

async function findAgentTodoDocHandle(
  folderHandle: DocHandle<FolderDoc>,
  repo: Repo
): Promise<DocHandle<TodoDoc> | null> {
  const folderDoc = folderHandle.doc();
  for (const docRef of folderDoc.docs) {
    if (docRef.type === "todo" && docRef.name === AGENT_TODO_LIST_NAME) {
      return repo.find<TodoDoc>(docRef.url);
    }
  }
  return null;
}

async function initTodoContext(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<void> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return;
  }

  // Check if todo list already exists
  const existingTodo = folderDoc.docs.find(
    (doc) => doc.type === "todo" && doc.name === AGENT_TODO_LIST_NAME
  );

  if (existingTodo) {
    return; // Already exists
  }

  // Create the todo list document
  const handle = await createDocOfDatatype<TodoDoc>("todo", repo);
  handle.change((doc) => {
    doc.title = AGENT_TODO_LIST_NAME;
  });

  // Add to folder
  folderHandle.change((doc) => {
    doc.docs.push({
      url: handle.url,
      name: AGENT_TODO_LIST_NAME,
      type: "todo",
    });
  });
}

async function getTodoRerunReason(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string | null> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return null;
  }

  // Find the agent todo list (don't create if it doesn't exist)
  let todoDocUrl: AutomergeUrl | null = null;
  for (const docRef of folderDoc.docs) {
    if (docRef.type === "todo" && docRef.name === AGENT_TODO_LIST_NAME) {
      todoDocUrl = docRef.url;
      break;
    }
  }

  // No todo list exists yet - done
  if (!todoDocUrl) {
    return null;
  }

  const todoDocHandle = await repo.find<TodoDoc>(todoDocUrl);
  const todoDoc = todoDocHandle.doc();

  // Get open todos
  const openTodos = todoDoc.todos.filter((todo) => !todo.done);

  if (openTodos.length === 0) {
    return null;
  }

  // Return a reason with the list of open todos
  const todoList = openTodos.map((todo) => `- ${todo.description}`).join("\n");

  return `You still have ${openTodos.length} open todo item(s) to complete:\n${todoList}\n\nPlease continue working on these tasks.`;
}

export const todoContextPlugin: LLMContextPlugin = {
  id: "llm-context:todo",
  name: "Todo Context",
  type: "patchwork:llm-context",
  module: {
    prompt: getTodoContextPrompt,
    getRerunReason: getTodoRerunReason,
    init: initTodoContext,
  },
};
