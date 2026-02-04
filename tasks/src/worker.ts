/* eslint-env worker */

import type { Task, TaskQueue, Worker as TaskWorker } from './datatype';
import type { MessageToWorker, MessageToWorkerChannel, MessageToWorkerPool } from './protocol';
import type { Repo, AutomergeUrl, DocHandle } from '@automerge/vanillajs/slim';

// import 'es-module-shims/wasm';
const shimCodeUrl = 'https://ga.jspm.io/npm:es-module-shims@1.6.2/dist/es-module-shims.wasm.js';
import(shimCodeUrl);

import { getRepo } from './webworker-lib';
import generateName from 'boring-name-generator';

let repo: Repo;
let workerPoolPort: MessagePort;

let workerId: number;
let contactUrl: AutomergeUrl;
let importMap: any;
let baseURI: string;

let workerHandle: DocHandle<TaskWorker>;
let currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null = null;

console.log('I am worker, hear me roar!');

self.addEventListener('connect', (e: any) => {
  console.log('worker: connected to', e);
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorker = e.data;
    console.log('worker: received message', e.data);
    try {
      switch (msg.type) {
        case 'init':
          init(
            msg.repoPort,
            msg.workerPoolPort,
            msg.workerId,
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
  repoPort: MessagePort,
  _workerPoolPort: MessagePort,
  _workerId: number,
  _contactUrl: AutomergeUrl,
  _importMap: any,
  _baseURI: string,
) {
  console.log('worker: Initializing');
  if (!repo) {
    console.log('worker: Really initializing');
    workerId = _workerId;
    contactUrl = _contactUrl;
    importMap = _importMap;
    baseURI = _baseURI;
    repo = await getRepo(repoPort, `task-worker-${Math.round(Math.random() * 10_000)}`);
    workerHandle = repo.create<TaskWorker>({
      name: generateName().dashed,
      contactUrl,
      currentTask: currentTask ?? null,
    });
    workerHandle.on('ephemeral-message', (payload) => {
      const msg: MessageToWorkerChannel = payload.message as any;
      switch (msg.type) {
        case 'work on':
          processTask(msg.taskUrl, msg.taskQueueUrl);
          break;
      }
    });
    setUpImportMap();
  }

  // There is a chance that we're getting an init message because the worker pool's
  // SharedWorker was restarted. Updating our reference to its port below will enable
  // this worker to keep doing its thing.
  workerPoolPort = _workerPoolPort;
  workerPoolPort.postMessage({
    type: 'worker update',
    workerId,
    workerUrl: workerHandle.url,
    currentTask: null,
  } satisfies MessageToWorkerPool);

  console.log('worker: Ready', { workerUrl: workerHandle.url });
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
        console.warn(`worker: Failed to resolve import map entry ${key}: ${value}`, e);
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
        console.warn(`worker: Failed to resolve scope key ${scopeKey}`, e);
        resolvedScopeKey = scopeKey; // Keep original if resolution fails
      }

      // Resolve each entry in the scope's import map
      resolvedImportMap.scopes[resolvedScopeKey] = {};
      for (const [key, value] of Object.entries(scopeMap as any)) {
        try {
          resolvedImportMap.scopes[resolvedScopeKey][key] = new URL(value as any, baseURI).href;
        } catch (e) {
          console.warn(`worker: Failed to resolve scope entry ${scopeKey}[${key}]: ${value}`, e);
          resolvedImportMap.scopes[resolvedScopeKey][key] = value; // Keep original if resolution fails
        }
      }
    }
  }

  (self as any).importShim.addImportMap(resolvedImportMap);
  console.log('worker: Import map configured from main thread', resolvedImportMap);
}

async function processTask(taskUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  currentTask = { taskUrl, taskQueueUrl };
  workerPoolPort.postMessage({
    type: 'worker update',
    workerId,
    workerUrl: workerHandle.url,
    currentTask,
  } satisfies MessageToWorkerPool);

  try {
    // Find the queue document
    console.log('worker: Attempting to find task queue document', { taskQueueUrl });
    const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
    console.log('worker: Found queue document', {
      queueUrl: taskQueueHandle.url,
      hasDoc: !!taskQueueHandle.doc(),
      docKeys: taskQueueHandle.doc() ? Object.keys(taskQueueHandle.doc()) : [],
    });
    await executeCurrentTask(taskQueueHandle);
    moveCurrentTaskToDone(taskQueueHandle);
  } catch (error) {
    console.error('worker: Error while processing task:', error);
  } finally {
    currentTask = null;
    workerPoolPort.postMessage({
      type: 'worker update',
      workerId,
      workerUrl: workerHandle.url,
      currentTask,
    } satisfies MessageToWorkerPool);
  }
}

async function executeCurrentTask(taskQueueHandle: DocHandle<TaskQueue>) {
  if (!currentTask) {
    throw new Error('executeCurrentTask() should never be called with currentTask == null');
  }

  // Update worker status to show current task
  workerHandle.change((doc) => {
    doc.currentTask = currentTask;
  });

  const currentTaskHandle = await repo.find<Task<any, any>>(currentTask.taskUrl);
  const taskDoc = currentTaskHandle.doc();
  if (!taskDoc) {
    throw new Error('Task document not found: ' + currentTask.taskUrl);
  }

  console.log('worker: Executing task:', currentTask.taskUrl);

  const input = taskDoc.input;
  const log: [number, string][] = [];
  const startTime = Date.now();
  let status: 'succeeded' | 'failed' = 'succeeded';
  let result: any;
  try {
    // Dynamic import of the task module using importShim for import map support
    console.log('worker: importing task module via shims', taskDoc.importUrl);
    const module = await (self as any).importShim(taskDoc.importUrl);
    console.log('worker: imported task module via shims', module);
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
    console.error('Worker: Task execution failed:', error);
    log.push([Date.now(), error?.message ?? '' + error]);
    status = 'failed';
  }

  const endTime = Date.now();

  // Update task document with results
  currentTaskHandle.change((doc) => {
    doc.runs.push({
      workerUrl: workerHandle.url,
      status,
      result,
      startTime,
      endTime,
      log,
    });
  });

  // Clear current task from worker
  workerHandle.change((doc) => {
    doc.currentTask = null;
  });
}

function moveCurrentTaskToDone(taskQueueHandle: DocHandle<TaskQueue>) {
  if (!currentTask) {
    throw new Error('moveCurrentTaskToDone() should never be called with currentTask == null');
  }

  const { taskUrl } = currentTask;
  taskQueueHandle.change((doc) => {
    const idx = doc.pending.indexOf(taskUrl);
    doc.pending.splice(idx, 1);
    doc.done.push(taskUrl);
  });
}

export {}; // to ensure this is a module
