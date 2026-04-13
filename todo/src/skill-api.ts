import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Workspace } from "@patchwork/llm";

type Todo = {
  id: string;
  description: string;
  done: boolean;
};

type TodoDoc = {
  "@patchwork": { type: "todo" };
  title: string;
  todos: Todo[];
};

export default function (workspace: Workspace) {
  return {
    async createTodo(title: string) {
      const handle = await workspace.create<TodoDoc>({ name: title, type: "todo" });
      handle.change((doc) => {
        doc["@patchwork"] = { type: "todo" };
        doc.title = title;
        doc.todos = [];
      });
      return { handle, url: handle.url };
    },

    async getTodo(url: AutomergeUrl) {
      const handle = await workspace.find<TodoDoc>(url);

      return {
        addItem(description: string) {
          handle.change((doc) => {
            doc.todos.push({
              id: crypto.randomUUID(),
              description,
              done: false,
            });
          });
        },

        toggleItem(id: string) {
          handle.change((doc) => {
            const item = doc.todos.find((t) => t.id === id);
            if (item) item.done = !item.done;
          });
        },

        removeItem(id: string) {
          handle.change((doc) => {
            const idx = doc.todos.findIndex((t) => t.id === id);
            if (idx !== -1) doc.todos.splice(idx, 1);
          });
        },

        getItems() {
          return handle.doc()?.todos ?? [];
        },

        getTitle() {
          return handle.doc()?.title ?? "";
        },

        setTitle(title: string) {
          handle.change((doc) => {
            doc.title = title;
          });
        },
      };
    },
  };
}
