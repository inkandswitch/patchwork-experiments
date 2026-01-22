/* eslint-env worker */

import generateName from 'boring-name-generator';
import { Repo } from '@automerge/automerge-repo/slim';
import { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { Task, TaskQueue, Worker as TaskWorker } from './datatype';
import { MessageToWorker, MessageToWorkerChannel, MessageToWorkerPool } from './protocol';
import { getRepo } from './webworker-lib';

let repo: Repo;
let contactUrl: AutomergeUrl;
let importMap: ImportMap;
let baseURI: string;

let workerHandle: DocHandle<TaskWorker>;
let currentTask: { url: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null = null;

console.log('I am worker, hear me roar!'); // TODO: remove this

self.onmessage = (e) => {
  const msg: MessageToWorker = e.data;
  switch (msg.type) {
    case 'init':
      try {
        init(msg.port, msg.contactUrl, msg.importMap, msg.baseURI);
      } catch (error) {
        console.error('worker: Failed to start:', error);
      }
      break;
  }
};

async function init(
  port: MessagePort,
  _contactUrl: AutomergeUrl,
  _importMap: ImportMap,
  _baseURI: string
) {
  if (repo) {
    const msg = 'router: Received two init messages!';
    console.error(msg);
    throw new Error(msg);
  }

  console.log('router: Initializing');
  repo = await getRepo(port, `task-worker-${Math.round(Math.random() * 10_000)}`);
  contactUrl = _contactUrl;
  importMap = _importMap;
  baseURI = _baseURI;

  // Add diagnostic listeners to the port
  // port.addEventListener('message', (e) => {
  //   console.log('worker: Port received message', e.data);
  // });
  // port.addEventListener('messageerror', (e) => {
  //   console.error('worker: Port message error', e);
  // });

  setUpImportMap();

  workerHandle = repo.create<TaskWorker>({
    name: generateName().dashed,
    contactUrl,
    currentTask,
  });
  workerHandle.on('ephemeral-message', (payload) => {
    const msg: MessageToWorkerChannel = payload.message as any;
    switch (msg.type) {
      case 'work on':
        processTask(msg.taskUrl, msg.taskQueueUrl);
        break;
    }
  });

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
        resolvedImportMap.imports[key] = new URL(value, baseURI).href;
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
      for (const [key, value] of Object.entries(scopeMap)) {
        try {
          resolvedImportMap.scopes[resolvedScopeKey][key] = new URL(value, baseURI).href;
        } catch (e) {
          console.warn(`worker: Failed to resolve scope entry ${scopeKey}[${key}]: ${value}`, e);
          resolvedImportMap.scopes[resolvedScopeKey][key] = value; // Keep original if resolution fails
        }
      }
    }
  }

  self.importShim.addImportMap(resolvedImportMap);
  console.log('worker: Import map configured from main thread', resolvedImportMap);
}

async function processTask(url: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  currentTask = { url, taskQueueUrl };
  self.postMessage({
    type: 'update worker state',
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
    self.postMessage({
      type: 'update worker state',
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

  const currentTaskHandle = await repo.find<Task<any, any>>(currentTask.url);
  const taskDoc = currentTaskHandle.doc();
  if (!taskDoc) {
    throw new Error('Task document not found: ' + currentTask.url);
  }

  console.log('worker: Executing task:', currentTask.url);

  const input = taskDoc.input;
  const log: [number, string][] = [];
  const startTime = Date.now();
  let status: 'succeeded' | 'failed' = 'succeeded';
  let result: any;
  try {
    // Dynamic import of the task module using importShim for import map support
    console.log('worker: importing task module via shims', taskDoc.importUrl);
    const module = await self.importShim(taskDoc.importUrl);
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
      input
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

  const taskUrl = currentTask.url;
  taskQueueHandle.change((doc) => {
    const idx = doc.pending.indexOf(taskUrl);
    doc.pending.splice(idx, 1);
    doc.done.push(taskUrl);
  });
}
