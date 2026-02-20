export const ChatDatatype = {
  init(doc) {
    doc.title = "Chat";
    doc.messages = [];
    doc.docs = [];
  },
  getTitle(doc) { return doc.title || "Chat"; },
  setTitle(doc, title) { doc.title = title; },
  markCopy(doc) { doc.title = "Copy of " + this.getTitle(doc); },
};
