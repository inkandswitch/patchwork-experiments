/* eslint-env worker */

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
let runnerHandle = null;
let currentTaskHandle = null;

// Worker initialization
self.onmessage = async (event) => {
  if (event.data.port && event.data.queueUrl) {
    const { port, queueUrl, contactUrl } = event.data;

    try {
      // Initialize Automerge WASM
      await initializeBase64Wasm(automergeWasmBase64);

      // Create repo with MessageChannel network adapter
      repo = new Repo({
        network: [new MessageChannelNetworkAdapter(port)],
        peerId: `worker-${Math.round(Math.random() * 10000)}`,
      });
      self.repo = repo;

      // Find the queue document
      queueHandle = await repo.find(queueUrl);

      // Create our own runner document for announcement
      runnerHandle = repo.create({
        name: generateName().dashed,
        contactUrl: contactUrl || null,
        currentTask: null,
      });

      // Start the autonomous task loop
      startTaskLoop();

      // Start broadcasting our presence
      startBroadcasting();

      console.log('Worker: Ready and running autonomously', {
        queueUrl,
        runnerUrl: runnerHandle.url,
      });
    } catch (error) {
      console.error('Worker: Failed to initialize:', error);
    }
  }
};

// Autonomous task loop - continuously pull jobs from queue
async function startTaskLoop() {
  while (true) {
    try {
      const taskId = await grabNextTask();
      if (taskId) {
        await executeTask(taskId);
        await moveTaskToDone(taskId);
      } else {
        // No tasks available, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error('Worker: Error in task loop:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Grab next task from queue (atomic operation)
async function grabNextTask() {
  let taskId = null;

  queueHandle.change((doc) => {
    if (doc.pending.length > 0) {
      // Grab a random task from the front portion of the queue
      const maxIndex = Math.min(100, doc.pending.length - 1);
      const idx = Math.floor(Math.random() * maxIndex);
      [taskId] = doc.pending.splice(idx, 1);
    }
  });

  return taskId;
}

// Move completed task to done queue
async function moveTaskToDone(taskId) {
  queueHandle.change((doc) => {
    doc.done.push(taskId);
  });
}

// Broadcast worker presence
function startBroadcasting() {
  setInterval(() => {
    if (queueHandle && runnerHandle) {
      queueHandle.broadcast({ runnerUrl: runnerHandle.url });
    }
  }, 3000);
}

async function executeTask(taskUrl) {
  try {
    // Update runner status to show current task
    runnerHandle.change((doc) => {
      doc.currentTask = taskUrl;
    });

    currentTaskHandle = await repo.find(taskUrl);
    const taskDoc = currentTaskHandle.doc();

    if (!taskDoc) {
      console.error('Worker: Task document not found:', taskUrl);
      return;
    }

    console.log('Worker: Executing task:', taskUrl);

    const input = taskDoc.input;
    const log = [];
    let status = 'succeeded';
    let result = null;
    const startTime = Date.now();

    try {
      // Dynamic import of the task module
      const module = await import(taskDoc.importUrl);
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
        runner: runnerHandle.documentId,
        status,
        result,
        startTime,
        endTime,
        log,
      });
    });

    // Clear current task from runner
    runnerHandle.change((doc) => {
      doc.currentTask = null;
    });
  } catch (error) {
    console.error('Worker: Error in executeTask:', error);
  } finally {
    currentTaskHandle = null;
  }
}
