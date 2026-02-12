/* eslint-env worker */

import type { Task, TaskQueue, Worker } from './datatype';
import type { MessageToWorker, MessageToWorkerChannel, MessageToWorkerPool } from './protocol';
import type { Repo, AutomergeUrl, DocHandle } from '@automerge/vanillajs/slim';

import generateName from 'boring-name-generator';
import { getRepo } from './webworker-lib';

// import 'es-module-shims/wasm';
const shimCodeUrl = 'https://ga.jspm.io/npm:es-module-shims@1.6.2/dist/es-module-shims.wasm.js';
import(shimCodeUrl);

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';

let repo: Repo;
let importMap: any;
let baseURI: string;

let workerHandle: DocHandle<Worker>;

console.log('I am worker, hear me roar!');

self.addEventListener('connect', (e: any) => {
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorker = e.data;
    console.log('received message', e.data);
    try {
      switch (msg.type) {
        case 'init':
          init(
            port,
            msg.repoPort,
            msg.contactUrl,
            msg.importMap,
            msg.baseURI,
          );
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker', { msg, error });
    }
  };
});

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

  importMap = _importMap;
  baseURI = _baseURI;
  setUpImportMap();

  repo = await getRepo(repoPort, `task-worker-${Math.round(Math.random() * 10_000)}`);

  // create the worker document
  workerHandle = repo.create<Worker>({
    name: generateName().dashed,
    contactUrl: _contactUrl,
    currentTask: null,
  });

  // tell the worker pool proxy that I exist
  workerPoolProxyPort.postMessage({
    type: 'add worker',
    sharedWorkerName: self.name,
    workerUrl: workerHandle.url,
  } satisfies MessageToWorkerPool);

  // listen to messages on my channel
  workerHandle.on('ephemeral-message', (payload) => {
    const msg: MessageToWorkerChannel = payload.message as any;
    switch (msg.type) {
      case 'work on':
        processTask(msg.taskUrl, msg.taskQueueUrl);
        break;
    }
  });

  workerHandle.change((doc) => { doc.currentTask = null; });

  console.log('ready', { workerUrl: workerHandle.url });
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
  console.log('worker: Import map configured from main thread', resolvedImportMap);
}

async function processTask(taskUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  console.log('executing task:', taskUrl);
  workerHandle.change((doc) => {
    doc.currentTask = { taskUrl, taskQueueUrl };
  });

  try {
    await execute(taskUrl);
    await moveToDone(taskUrl, taskQueueUrl);
  } catch (error) {
    console.error('error while processing task:', error);
  } finally {
    workerHandle.change((doc) => {
      doc.currentTask = null;
    });
  }
}

async function execute(taskUrl: AutomergeUrl) {
  const taskHandle = await repo.find<Task<any, any>>(taskUrl);
  const { importUrl, input } = taskHandle.doc();

  const log: [number, string][] = [];
  const startTime = Date.now();
  let status: 'succeeded' | 'failed' = 'succeeded';
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
          log.push([timestamp, message]);
          console.log('Task log:', message);
        },
      },
      input,
    );
  } catch (error: any) {
    console.error('task execution failed:', error);
    log.push([Date.now(), error?.message ?? '' + error]);
    status = 'failed';
  }

  const endTime = Date.now();

  // Update task document with results
  taskHandle.change((doc) => {
    doc.runs.push({
      workerUrl: workerHandle.url,
      status,
      result: result ?? null,
      startTime,
      endTime,
      log,
    });
  });
}

async function moveToDone(taskUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
  taskQueueHandle.change((doc) => {
    const idx = doc.pending.indexOf(taskUrl);
    doc.pending.splice(idx, 1);
    doc.done.push(taskUrl);
  });
}

export { }; // to ensure this is a module
