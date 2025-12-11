import { DocHandle, Repo } from "@automerge/automerge-repo";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import outdent from "outdent";
import { createDocOfDatatype } from "../../lib";
import { AgentDoc } from "../Agent";

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

export async function getTodoContextPrompt(
  agentDocHandle: DocHandle<AgentDoc>,
  repo: Repo
): Promise<string> {
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return "";
  }

  const todoDocHandle = await findOrCreateAgentTodoDocHandle(
    folderHandle,
    repo
  );

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

async function findOrCreateAgentTodoDocHandle(
  folderHandle: DocHandle<FolderDoc>,
  repo: Repo
): Promise<DocHandle<TodoDoc>> {
  const folderDoc = folderHandle.doc();
  for (const docRef of folderDoc.docs) {
    if (docRef.type === "todo" && docRef.name === AGENT_TODO_LIST_NAME) {
      return repo.find<TodoDoc>(docRef.url);
    }
  }

  const handle = await createDocOfDatatype<TodoDoc>("todo", repo);
  handle.change((doc) => {
    doc.title = AGENT_TODO_LIST_NAME;
  });

  folderHandle.change((doc) => {
    doc.docs.push({
      url: handle.url,
      name: AGENT_TODO_LIST_NAME,
      type: "todo",
    });
  });

  return handle as DocHandle<TodoDoc>;
}
