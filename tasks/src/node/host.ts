// A queue's workers on a machine with no browser.
//
//   node dist-node/host.mjs --queue automerge:… --accept automerge:<package>
//                           [--queue automerge:…]… [--accept automerge:…]… | --accept-any
//                           [--workers 1] [--sync wss://…] [--new-queue "title"]
//                           [--code-dir <dir>] [--verbose]
//
// It is an automerge peer, not a service: nothing listens on a port, so it
// runs the same on a laptop or on a server anywhere. It joins each queue it's
// given the way a browser does, with a pool, a router and workers of its own
// (the same code, each in a thread: see self-shim.ts), so a queue served only
// by processes like this one routes itself, and two of them on one queue
// share its tasks and take over from each other.
//
// A task says where its code is (see ../import-url.ts), and a process on a
// machine can reach everything that machine can. So this must be told whose
// code it runs (see ../acceptance.ts), and there is no default:
//
//   --accept automerge:<package>   code that is in that package, at any
//                                  version; repeat for more
//   --accept-any                   whatever a queue's tasks bring, `data:`
//                                  URLs included: for a queue only you write to
//
// Code kept in automerge is fetched through this process's own Repo and
// imported from --code-dir (see package-files.ts; ~/.patchwork-tasks/code
// unless said). It runs in Node: it can import its neighbours and Node's own
// modules, not what a browser's import map would have given it.
//
//   --local automerge:<package>=<dir>   run that package's code from this
//                                       directory instead of fetching it
//
// For a machine that has the package checked out and installed: a solver's
// package, whose code imports its own source and its dependencies and drives
// programs installed beside it. A task names the package's code the way it
// always does; this host answers from its own copy, whichever version the
// task named. Naming a package this way accepts it.
//
// --new-queue makes a queue, prints its url, and serves it: for a machine
// that should have a queue of its own.

import { Worker, MessageChannel, type MessagePort } from 'node:worker_threads';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { Repo, initSubduction } from '@automerge/automerge-repo-node';
import type {
  MessageToRouter,
  MessageToWorker,
  MessageToWorkerPool,
  RepoConfig,
} from '../protocol';
import type { TaskQueueDoc, TaskQueueSet } from '../datatype';
import type { QueueSetting } from '../acceptance';
import { QUEUE_DATATYPE_ID, ROUTER_NAME, WORKER_POOL_NAME, workerName } from '../ids';

const DEFAULT_SYNC_SERVER_URL = 'wss://subduction.sync.inkandswitch.com';
const AUTOMERGE_URL = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}$/;

interface Options {
  queues: string[];
  accept: string[];
  acceptAny: boolean;
  /** Packages to run from a directory here: `automerge:<package>` to an absolute path. */
  local: Record<string, string>;
  workers: number;
  sync: string;
  newQueue: string | null;
  codeDir: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    queues: [],
    accept: [],
    acceptAny: false,
    local: {},
    workers: 1,
    sync: process.env.PATCHWORK_SYNC ?? DEFAULT_SYNC_SERVER_URL,
    newQueue: null,
    codeDir: join(homedir(), '.patchwork-tasks', 'code'),
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
      }
      return next;
    };
    switch (flag) {
      case '--queue':
        options.queues.push(value());
        break;
      case '--accept':
        options.accept.push(value());
        break;
      case '--accept-any':
        options.acceptAny = true;
        break;
      case '--local': {
        const given = value();
        const at = given.indexOf('=');
        if (at < 0) {
          throw new Error('--local wants automerge:<package>=<directory>');
        }
        const packageUrl = given.slice(0, at);
        if (!AUTOMERGE_URL.test(packageUrl)) {
          throw new Error(`${packageUrl} isn't a package's automerge: url`);
        }
        options.local[packageUrl] = resolve(given.slice(at + 1));
        break;
      }
      case '--workers':
        options.workers = Number(value());
        break;
      case '--sync':
        options.sync = value();
        break;
      case '--new-queue':
        options.newQueue = value();
        break;
      case '--code-dir':
        options.codeDir = resolve(value());
        break;
      case '--verbose':
        options.verbose = true;
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  for (const url of [...options.queues, ...options.accept]) {
    if (!AUTOMERGE_URL.test(url)) {
      throw new Error(`${url} isn't an automerge: url (a package's is given without its heads)`);
    }
  }
  if (!Number.isInteger(options.workers) || options.workers < 1) {
    throw new Error('--workers wants a whole number, 1 or more');
  }
  if (options.queues.length === 0 && !options.newQueue) {
    throw new Error('say which queue to work on: --queue automerge:…, or --new-queue "a title"');
  }
  // a package this host has a copy of is one it runs
  if (!options.acceptAny) {
    for (const packageUrl of Object.keys(options.local)) {
      if (!options.accept.includes(packageUrl)) {
        options.accept.push(packageUrl);
      }
    }
  }
  if (options.acceptAny === options.accept.length > 0) {
    throw new Error(
      options.acceptAny
        ? "--accept-any already takes every package's code: leave --accept out"
        : 'say whose code this process runs: --accept automerge:<package> (repeat for more), or --accept-any',
    );
  }
  return options;
}

/** Makes a queue on the sync server and resolves to its url once the server has it. */
async function makeQueue(title: string, sync: string) {
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [sync] } as any);
  const handle = repo.create<TaskQueueDoc & { '@patchwork': { type: string } }>({
    '@patchwork': { type: QUEUE_DATATYPE_ID },
    title,
    activeRouter: null,
    pending: [],
    done: [],
    doneSet: {},
    jobs: {},
  });
  await repo.flush?.();
  // long enough for the server to have it; the threads' Repos find it there
  await new Promise((r) => setTimeout(r, 3_000));
  return handle.url as string;
}

/** Starts one of the three scripts in a thread, and "connects" to it as a tab would. */
function startThread(script: string, name: string, options: Options) {
  const worker = new Worker(new URL(script, import.meta.url), {
    workerData: { name, verbose: options.verbose, codeDir: options.codeDir, local: options.local },
    name,
  });
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ type: 'connect', port: port2 }, [port2]);
  worker.on('error', (error) => console.error(`[${name}] crashed:`, error));
  return { worker, port: port1 as MessagePort };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const queues = [...options.queues];
  if (options.newQueue) {
    const url = await makeQueue(options.newQueue, options.sync);
    queues.push(url);
    console.log(`made the queue "${options.newQueue}": ${url}`);
  }

  const repoConfig: RepoConfig = { syncServerUrl: options.sync };
  // a browser's workers belong to a person, and say so with their contact; these belong to a machine
  const init = { type: 'init' as const, repoConfig, contactUrl: null as any, importMap: {}, baseURI: '' };
  const setting: QueueSetting = options.acceptAny ? true : { packages: options.accept };
  const taskQueues: TaskQueueSet = Object.fromEntries(queues.map((url) => [url, setting]));
  const working = { type: 'update task queue set' as const, taskQueues };

  const pool = startThread('./thread-pool.mjs', WORKER_POOL_NAME, options);
  pool.port.postMessage(init satisfies MessageToWorkerPool);

  const workers = Array.from({ length: options.workers }, (_, id) => {
    const thread = startThread('./thread-worker.mjs', workerName(id), options);
    // a worker says it exists to whoever started it, for the pool: pass it on
    thread.port.on('message', (message) => pool.port.postMessage(message));
    thread.port.postMessage(init satisfies MessageToWorker);
    thread.port.postMessage(working satisfies MessageToWorker);
    return thread;
  });

  const router = startThread('./thread-router.mjs', ROUTER_NAME, options);
  router.port.postMessage(init satisfies MessageToRouter);
  router.port.postMessage(working satisfies MessageToRouter);
  pool.port.postMessage(working satisfies MessageToWorkerPool);

  const whose = options.acceptAny
    ? 'any code'
    : `code from ${options.accept.length} package${options.accept.length === 1 ? '' : 's'}`;
  console.log(
    `${hostname()}: ${options.workers} worker${options.workers === 1 ? '' : 's'} on ${queues.length} queue${queues.length === 1 ? '' : 's'}, running ${whose}`,
  );
  for (const url of queues) {
    console.log(`  ${url}`);
  }

  const stop = () => {
    for (const thread of [router, pool, ...workers]) {
      thread.worker.terminate();
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(2);
});
