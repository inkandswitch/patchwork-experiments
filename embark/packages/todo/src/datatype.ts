import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A todo list whose items double as sticker targets. Each item carries a stable
// `id` so a sticker can address it by pattern match (`sub("items", { id })`)
// and survive reordering, plus a `text` string a sticker can address a
// sub-range of (`sub("items", { id }, "text", cursor(from, to))`). The todo
// tool is a sticker *surface*: it renders whatever stickers target this
// document, around or inside the matching item.
export type TodoDoc = {
  "@patchwork": { type: "todo" };
  items: TodoItem[];
};

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

export const TodoDatatype: DatatypeImplementation<TodoDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "todo" };
    doc.items = [];
  },
  getTitle(doc) {
    const first = doc.items?.find((item) => item.text.trim());
    return first ? first.text : "Todo";
  },
};
