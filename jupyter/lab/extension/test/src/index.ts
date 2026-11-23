// The upstream @jupyter/ydoc specs in ../ydoc import from '../src'; this
// module stands in for it, exposing the Automerge models under the Yjs names.
import * as Automerge from '@automerge/automerge';
import { setAutomerge } from '../../src/model';

setAutomerge(Automerge);

export {
  AutomergeCodeCell as YCodeCell,
  AutomergeNotebook as YNotebook,
  createStandaloneCell
} from '../../src/model';
export type { IMapChange, NotebookChange } from '@jupyter/ydoc';
