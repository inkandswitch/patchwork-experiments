// The game-library datatype: a folder-shaped doc, `{ title, docs }`, made
// holding two plain folder docs, Games and Sessions, linked as folders
// (`type: "folder"`), so the sidebar shows them as folders and the folder
// tool can show the library itself (model.js has the shape). The host calls
// init inside the new doc's first change, with its repo: the two folders are
// made there, before anyone can know of the library.

import { FOLDER_TYPE, GAMES, SESSIONS } from "./model.js";

const DEFAULT_TITLE = "Game library";

export const GameLibraryDatatype = {
  init(doc, repo) {
    doc.title = DEFAULT_TITLE;
    const folder = (name) => ({ name, type: FOLDER_TYPE, url: repo.create({ "@patchwork": { type: FOLDER_TYPE }, title: name, docs: [] }).url });
    doc.docs = [folder(GAMES), folder(SESSIONS)];
  },
  getTitle(doc) {
    return (typeof doc?.title === "string" && doc.title) || DEFAULT_TITLE;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
