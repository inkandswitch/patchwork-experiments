// The page-url card package: ./card is the behavior module the card shell
// loads — it shows the web page currently open in the browser, reported by
// the patchwork-cards browser extension. The package registers no plugins of
// its own (see ./plugins); card docs point straight at `dist/card.js`.
export { plugins } from "./plugins";
export type { PageUrlCardDoc } from "./card";
