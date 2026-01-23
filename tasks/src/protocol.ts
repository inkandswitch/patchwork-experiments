// The following import is only here for the `ImportMap` type.
// This is bad b/c we only want the shims in the worker and this
// file is used by the client, too.
// TODO: consider using `any` instead of `ImportMap`.
import 'es-module-shims';

import { AutomergeUrl } from '@automerge/automerge-repo';

export type MessageToWorkerPool =
  // sent by the app
  | {
      type: 'init';
      contactUrl: AutomergeUrl;
      port: MessagePort;
      workerPorts: MessagePort[];
      importMap: ImportMap;
      baseURI: string;
    }
  | { type: 'join task queue'; url: AutomergeUrl; port: MessagePort }
  | { type: 'leave task queue'; url: AutomergeUrl }
  // sent by workers
  // TODO: consider having the worker pool subscribe to changes in the worker docs, then this is not needed
  | {
      type: 'update worker state';
      workerUrl: AutomergeUrl;
      currentTask: { url: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
    };

export type MessageToRouter =
  // sent by the worker pool
  { type: 'init'; port: MessagePort; contactUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl };

export type MessageToRouterChannel =
  // sent by worker pools (one per worker) to the active router of each task queue
  {
    type: 'worker heartbeat';
    workerUrl: AutomergeUrl;
    currentTaskUrl: AutomergeUrl | null;
  };

export type MessageToTaskQueueChannel =
  // sent by the active router
  { type: 'router heartbeat'; routerUrl: AutomergeUrl; workerUrls: AutomergeUrl[] };

export type MessageToWorker =
  // sent by the worker pool
  {
    type: 'init';
    port: MessagePort;
    contactUrl: AutomergeUrl;
    importMap: ImportMap;
    baseURI: string;
  };

export type MessageToWorkerChannel =
  // sent by an active router
  { type: 'work on'; taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl };
