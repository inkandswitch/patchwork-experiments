/* eslint-env worker */

// Import es-module-shims for import map support
import 'https://ga.jspm.io/npm:es-module-shims@1.10.0/dist/es-module-shims.js';

// Import Automerge dependencies from esm.sh CDN
import { automergeWasmBase64 } from 'https://esm.sh/@automerge/automerge@3.1.2/automerge.wasm.base64';
import {
  Repo,
  initializeBase64Wasm,
} from 'https://esm.sh/@automerge/automerge-repo@2.3.0/slim?bundle-deps';
import { MessageChannelNetworkAdapter } from 'https://esm.sh/@automerge/automerge-repo-network-messagechannel@2.3.0?bundle-deps';
import generateName from 'https://esm.sh/boring-name-generator@1.0.3';

let repo = null;
let queueHandle = null;
let activeRouterHandle = null;
let workerHandle = null;
let currentTaskUrl: string | null = null;

console.log('i am worker, hear me roar');

// Worker initialization - wait for SharedWorker port, queue URL, contact URL, and import map
self.onmessage = async (event) => {
  const { port, queueUrl, contactUrl, importMap, baseURI } = event.data;

  console.log('worker: Received message', {
    hasPort: !!port,
    queueUrl,
    portType: port?.constructor?.name,
  });

  if (!port || !queueUrl) {
    console.error('worker: Missing port or queueUrl', { port: !!port, queueUrl: !!queueUrl });
    return;
  }

  // Add diagnostic listeners to the port
  port.addEventListener('message', (e) => {
    console.log('worker: Port received message', e.data);
  });
  port.addEventListener('messageerror', (e) => {
    console.error('worker: Port message error', e);
  });

  try {
    // Initialize Automerge WASM
    await initializeBase64Wasm(automergeWasmBase64);
    console.log('worker: Automerge WASM initialized');

    // Create repo with MessageChannel network adapter
    // The port comes from the main thread's SharedWorker connection
    // Don't start the port yet - MessageChannelNetworkAdapter will start it when connect() is called
    // This ensures both sides are set up before messages start flowing
    const networkAdapter = new MessageChannelNetworkAdapter(port);
    console.log('worker: Created MessageChannelNetworkAdapter', {
      adapterType: networkAdapter.constructor.name,
      hasPort: !!networkAdapter.messagePortRef?.port,
    });

    repo = new Repo({
      network: [networkAdapter],
      peerId: `worker-${Math.round(Math.random() * 10_000)}`,
    });
    self.repo = repo;
    console.log('worker: Repo created', { peerId: repo.peerId });

    // Set up import map if provided from main thread
    if (importMap) {
      // Convert relative URLs in import map to absolute URLs
      const resolvedImportMap = {};

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
              console.warn(
                `worker: Failed to resolve scope entry ${scopeKey}[${key}]: ${value}`,
                e
              );
              resolvedImportMap.scopes[resolvedScopeKey][key] = value; // Keep original if resolution fails
            }
          }
        }
      }

      self.importShim.addImportMap(resolvedImportMap);
      console.log('worker: Import map configured from main thread', resolvedImportMap);
    }

    // Find the queue document
    console.log('worker: Attempting to find queue document', { queueUrl });
    try {
      queueHandle = await repo.find(queueUrl);
      console.log('worker: Found queue document', {
        queueUrl: queueHandle.url,
        hasDoc: !!queueHandle.doc(),
        docKeys: queueHandle.doc() ? Object.keys(queueHandle.doc()) : [],
      });
      queueHandle.on('change', (payload) => updateActiveRouter(payload.doc));
      updateActiveRouter(queueHandle.doc());
    } catch (findError) {
      console.error('worker: Failed to find queue document', { queueUrl, error: findError });
      throw findError;
    }

    // Create our own worker document for announcement
    workerHandle = repo.create({
      name: generateName().dashed,
      contactUrl: contactUrl ?? null,
      currentTask: null,
    });
    workerHandle.on('ephemeral-message', (payload) => processMessageFromRouter(payload.message));

    pHeartbeat();

    console.log('worker: Ready and running autonomously', {
      queueUrl,
      workerUrl: workerHandle.url,
    });
  } catch (error) {
    console.error('worker: Failed to start:', error);
  }
};

async function pHeartbeat() {
  while (true) {
    await seconds(1);

    if (activeRouterHandle == null) {
      // console.log('worker: not sending heartbeat b/c no active router!');
      continue;
    }

    const status = {
      worker: workerHandle.url,
      currentTask: currentTaskUrl,
    };
    // console.log('worker: sending heartbeat to', activeRouterHandle.url, status);
    activeRouterHandle.broadcast(status);
  }
}

async function updateActiveRouter(taskQueue) {
  if (
    (taskQueue.router == null && activeRouterHandle == null) ||
    taskQueue.router === activeRouterHandle?.url
  ) {
    return;
  }

  // console.log('worker: active router is now', taskQueue.router);

  activeRouterHandle?.off('ephemeral-message');

  if (taskQueue.router == null) {
    activeRouterHandle = null;
  } else {
    activeRouterHandle = await repo.find(taskQueue.router);
  }
}

async function processMessageFromRouter(m) {
  // console.log('worker: received message from router', m);
  switch (m.type) {
    case 'work on': {
      if (currentTaskUrl == null) {
        processTask(m.task);
      }
      break;
    }
  }
}

async function processTask(taskUrl) {
  currentTaskUrl = taskUrl;
  try {
    await executeTask();
    moveTaskToDone();
  } catch (error) {
    console.error('worker: error while processing task:', error);
  } finally {
    currentTaskUrl = null;
  }
}

// Move completed task to done queue
function moveTaskToDone() {
  queueHandle.change((doc) => {
    const idx = doc.pending.indexOf(currentTaskUrl);
    doc.pending.splice(idx, 1);
    doc.done.push(currentTaskUrl);
  });
}

async function executeTask() {
  // Update worker status to show current task
  workerHandle.change((doc) => {
    doc.currentTask = currentTaskUrl;
  });

  const currentTaskHandle = await repo.find(currentTaskUrl);
  const taskDoc = currentTaskHandle.doc();
  if (!taskDoc) {
    console.error('worker: Task document not found:', currentTaskUrl);
    return;
  }

  console.log('worker: Executing task:', currentTaskUrl);

  const input = taskDoc.input;
  const log = [];
  let status = 'succeeded';
  let result = null;
  const startTime = Date.now();

  try {
    // Dynamic import of the task module using importShim for import map support
    console.log('worker: importing task module via shims', taskDoc.importUrl);
    const module = await self.importShim(taskDoc.importUrl);
    console.log('worker: imported task module via shims', module);
    const taskFunction = module.default;

    // Execute the task with logging context
    result = await taskFunction.call(
      {
        log(...args) {
          const timestamp = Date.now();
          const message = args.map((arg) => '' + arg).reduce((acc, m) => `${acc} ${m}`);
          log.push([timestamp, message]);
          console.log('Task log:', message);
        },
      },
      input
    );
  } catch (error) {
    console.error('Worker: Task execution failed:', error);
    log.push([Date.now(), error?.message ?? '' + error]);
    status = 'failed';
  }

  const endTime = Date.now();

  // Update task document with results
  currentTaskHandle.change((doc) => {
    doc.runs.push({
      worker: workerHandle.documentId,
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

const seconds = async (s) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });
