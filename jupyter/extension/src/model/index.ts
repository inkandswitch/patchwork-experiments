export { setAutomerge, automerge } from './automerge';
export { EphemeralAwareness } from './awareness';
export { HandleBackend, MemoryBackend, type DocBackend, type DocChange } from './backend';
export {
  AutomergeCodeCell,
  AutomergeMarkdownCell,
  AutomergeRawCell,
  createStandaloneCell,
  type AutomergeCell
} from './cell';
export { AutomergeNotebook } from './notebook';
export type { CellDoc, NotebookDoc } from './schema';
export { UndoManager } from './undo';
