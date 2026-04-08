/* eslint-env worker */

console.log('task worker script starting; self.name =', (self as any).name);

import type { TaskQueueDoc, TaskDoc, RunStatus, WorkerDoc, RunLogEntry } from './datatype';
import type { MessageToWorker, MessageToWorkerChannel, MessageToWorkerPoolProxy } from './protocol';
import type { Repo, AutomergeUrl, DocHandle } from '@automerge/vanillajs/slim';

import generateName from 'boring-name-generator';
import { getRepo } from './webworker-lib';

const shimCodeUrl = 'https://ga.jspm.io/npm:es-module-shims@1.6.2/dist/es-module-shims.wasm.js';

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';

declare global {
  // Declare `repo` like this to prevent its name from getting mangled by the TS compiler.
  // This makes it possible for the task code to access this variable by name.
  var repo: Repo;
}

let importMap: any;
let baseURI: string;

let workerHandle: DocHandle<WorkerDoc>;

function handleConnect(e: any) {
  console.log('got a connection!');
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorker = e.data;
    console.log('received message', e.data);
    try {
      switch (msg.type) {
        case 'init':
          init(port, msg.repoPort, msg.contactUrl, msg.importMap, msg.baseURI);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message', { msg, error });
    }
  };
  (port as any).start?.();
}

(self as any).onconnect = handleConnect;
self.addEventListener('connect', handleConnect as any);

async function init(
  workerPoolProxyPort: MessagePort,
  repoPort: MessagePort,
  _contactUrl: AutomergeUrl,
  _importMap: any,
  _baseURI: string,
) {
  if (status !== 'not initialized') {
    return;
  }

  console.log('initializing...');
  status = 'initializing';

  try {
    console.log('importing es-module-shims...');
    await import(shimCodeUrl);
    console.log('done');
  } catch (error) {
    console.error('failed to import es-module-shims:', error);
  }

  importMap = _importMap;
  baseURI = _baseURI;
  setUpImportMap();

  // Important: if I take out the `globalThis.` from the assignment below, it doesn't work.
  // I get "ReferenceError: repo is not defined." This is probably b/c that variable only
  // counts as declared once it exists as a property in globalThis.
  globalThis.repo = await getRepo(repoPort, `task-worker-${Math.round(Math.random() * 1_000_000)}`);

  // create the worker document
  workerHandle = repo.create<WorkerDoc>({
    name: generateName().dashed,
    contactUrl: _contactUrl,
    currentTask: null,
  });

  // tell the worker pool proxy that I exist
  workerPoolProxyPort.postMessage({
    type: 'register worker',
    sharedWorkerName: self.name,
    workerUrl: workerHandle.url,
  } satisfies MessageToWorkerPoolProxy);

  // listen to messages on my channel
  workerHandle.on('ephemeral-message', (payload) => {
    const msg: MessageToWorkerChannel = payload.message as any;
    switch (msg.type) {
      case 'work on':
        processTask(msg.taskUrl, msg.taskQueueUrl);
        break;
    }
  });

  workerHandle.change((doc) => {
    doc.currentTask = null;
  });

  console.log('ready', { workerUrl: workerHandle.url });
  console.log('hola, me llamo', workerHandle.doc().name);
}

function setUpImportMap() {
  // Convert relative URLs in import map to absolute URLs
  const resolvedImportMap: any = {};

  // Handle imports
  if (importMap.imports) {
    resolvedImportMap.imports = {};
    for (const [key, value] of Object.entries(importMap.imports)) {
      // Resolve relative URLs to absolute URLs using the base URI from main thread
      try {
        resolvedImportMap.imports[key] = new URL(value as any, baseURI).href;
      } catch (e) {
        console.warn(`failed to resolve import map entry ${key}: ${value}`, e);
        resolvedImportMap.imports[key] = value; // Keep original if resolution fails
      }
    }
  }

  // Handle scopes
  if (importMap.scopes) {
    resolvedImportMap.scopes = {};
    for (const [scopeKey, scopeMap] of Object.entries(importMap.scopes)) {
      // Resolve the scope key itself to absolute URL
      let resolvedScopeKey;
      try {
        resolvedScopeKey = new URL(scopeKey, baseURI).href;
      } catch (e) {
        console.warn(`failed to resolve scope key ${scopeKey}`, e);
        resolvedScopeKey = scopeKey; // Keep original if resolution fails
      }

      // Resolve each entry in the scope's import map
      resolvedImportMap.scopes[resolvedScopeKey] = {};
      for (const [key, value] of Object.entries(scopeMap as any)) {
        try {
          resolvedImportMap.scopes[resolvedScopeKey][key] = new URL(value as any, baseURI).href;
        } catch (e) {
          console.warn(`failed to resolve scope entry ${scopeKey}[${key}]: ${value}`, e);
          resolvedImportMap.scopes[resolvedScopeKey][key] = value; // Keep original if resolution fails
        }
      }
    }
  }

  (self as any).importShim.addImportMap(resolvedImportMap);
  console.log('Import map configured from main thread', resolvedImportMap);
}

const tally = { numSuccesses: 0, numFailures: 0, numBails: 0 };

function logTally() {
  const { numSuccesses, numFailures, numBails } = tally;
  const total = numSuccesses + numFailures + numBails;
  console.log('');
  console.log(`Processed ${total} tasks so far.`);
  console.log(`  ${numSuccesses} successes (${(numSuccesses / total) * 100 || 100}%)`);
  console.log(`  ${numFailures} failures (${(numFailures / total) * 100 || 0}%)`);
  console.log(`  ${numBails} bails (${(numBails / total) * 100 || 0}%)`);
  console.log('');
}

const MAX_TRIES = 3;

async function processTask(taskUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  console.log('executing task', taskUrl);

  workerHandle.change((doc) => {
    doc.currentTask = { taskUrl, taskQueueUrl };
  });

  let ok = true;

  let taskHandle: DocHandle<TaskDoc<any, any>>;
  try {
    taskHandle = await repo.find<TaskDoc<any, any>>(taskUrl);
  } catch (error) {
    console.error('unable to get doc handle for task', { taskUrl, error });
    ok = false;
  }

  let taskQueueHandle: DocHandle<TaskQueueDoc>;
  if (ok) {
    try {
      taskQueueHandle = await getTaskQueueHandle(taskQueueUrl);
    } catch (error) {
      console.error('unable to get doc handle for task queue', { taskQueueUrl, error });
      ok = false;
    }
  }

  if (!ok) {
    console.log('bailing on task', taskUrl);
    tally.numBails++;
    workerHandle.change((doc) => {
      doc.currentTask = null;
    });
    logTally();
    return;
  }

  taskHandle = taskHandle!;
  taskQueueHandle = taskQueueHandle!;

  try {
    const status = await execute(taskHandle);
    if (status === 'succeeded') {
      console.log('task succeeded!');
      tally.numSuccesses++;
    } else {
      console.error('task failed');
      tally.numFailures++;
    }
    if (status === 'succeeded' || failedTooManyTimes(taskHandle)) {
      moveToDone(taskUrl, taskQueueHandle);
    }
  } catch (error) {
    console.error('impossible error:', error);
  } finally {
    workerHandle.change((doc) => {
      doc.currentTask = null;
    });
  }
  logTally();
}

function failedTooManyTimes(taskHandle: DocHandle<TaskDoc<any, any>>) {
  return taskHandle.doc().runs.filter(({ status }) => status === 'failed').length >= MAX_TRIES;
}

async function execute(taskHandle: DocHandle<TaskDoc<any, any>>) {
  const { importUrl, input } = taskHandle.doc();

  const logs: RunLogEntry[] = [];
  const startTimeMillis = Date.now();
  let status: RunStatus = 'succeeded';
  let result: any;
  try {
    // Dynamic import of the task module using importShim for import map support
    const module = await (self as any).importShim(importUrl);
    const taskFunction = module.default as any;

    // Execute the task with logging context
    result = await taskFunction.call(
      {
        log(...args: any) {
          const timestamp = Date.now();
          const message = args
            .map((arg: any) => '' + arg)
            .reduce((acc: string, m: string) => `${acc} ${m}`);
          logs.push({ timestampMillis: timestamp, message });
          console.log('Task log:', message);
        },
      },
      input,
    );
  } catch (error: any) {
    console.error('task execution failed:', error);
    logs.push({ timestampMillis: Date.now(), message: error?.message ?? '' + error });
    status = 'failed';
  }

  const endTimeMillis = Date.now();

  // Update task document with results
  taskHandle.change((doc) => {
    doc.runs.push({
      workerUrl: workerHandle.url,
      status,
      result: result ?? null,
      startTimeMillis,
      endTimeMillis,
      logs,
    });
  });

  return status;
}

function moveToDone(taskUrl: AutomergeUrl, taskQueueHandle: DocHandle<TaskQueueDoc>) {
  taskQueueHandle.change((doc) => {
    const idx = doc.pending.indexOf(taskUrl);
    doc.pending.splice(idx, 1);
    doc.done.push(taskUrl);
  });
}

const taskQueueHandles = new Map<AutomergeUrl, DocHandle<TaskQueueDoc>>();

async function getTaskQueueHandle(taskQueueUrl: AutomergeUrl) {
  if (taskQueueHandles.has(taskQueueUrl)) {
    return taskQueueHandles.get(taskQueueUrl)!;
  }

  const handle = await repo.find<TaskQueueDoc>(taskQueueUrl);
  taskQueueHandles.set(taskQueueUrl, handle);
  return handle;
}

export { }; // to ensure this is a module
