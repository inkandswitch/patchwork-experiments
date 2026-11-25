// A machine's pool, in a Node process: it serves task queues from a machine
// with no browser.
//
//   node dist-node/host.mjs --queue automerge:… --accept automerge:<package>
//                           [--queue automerge:…]… [--accept automerge:…]… | --accept-any
//                           [--workers 1] [--sync wss://…] [--new-queue "title"]
//                           [--data-dir ~/.patchwork-tasks] [--name <host name>]
//                           [--code-dir <dir>] [--local automerge:<package>=<dir>]…
//                           [--verbose]
//
// It is an automerge peer, not a service: nothing listens on a port, so it
// runs the same on a laptop or on a server anywhere. The pool (../pool.ts)
// runs in this process's main thread with a Repo of its own, and each task's
// code runs in a worker thread it can end whatever the code is doing (see
// executor.ts). --workers is how many run at once.
//
// Everything is kept in --data-dir: the pool's documents (pool/), each
// thread's (slots/<n>/), code fetched from automerge (code/, unless
// --code-dir says), the pool's id (pool-id), and the running host's pid
// (host.pid). The id is what makes the runs this pool started its own after
// a restart: a host that comes back on the same directory records each run
// it no longer has as lost, and the task is taken again. One host to a
// directory; a second one refuses to start.
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
// Code kept in automerge is fetched through the thread's Repo and imported
// from the code directory (see package-files.ts). It runs in Node: it can
// import its neighbours and Node's own modules, not what a browser's import
// map would have given it.
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
//
// SIGINT or SIGTERM stops it: it takes nothing more, tells each run's code to
// stop ('stopping'), ends its thread GRACE_MS later if it has not, records
// each run as lost so that it is taken again, saves, and exits. If that has
// not happened within STOP_DEADLINE_MS the process exits anyway: a save that
// never settles must not keep a machine from shutting down. A second signal
// exits at once.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { Repo, initSubduction } from '@automerge/automerge-repo-node';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { Pool, type Docs } from '../pool';
import { GRACE_MS } from '../task-rules.js';
import type { Acceptance } from '../acceptance';
import type { Queue } from '../datatype';
import { QUEUE_DATATYPE_ID } from '../ids';
import { NodeExecutor } from './executor';

const DEFAULT_SYNC_SERVER_URL = 'wss://subduction.sync.inkandswitch.com';
const AUTOMERGE_URL = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}$/;

/** Long enough for the pool to give stopped code its grace, end it, save, and send what it saved: twice the grace and a little over. */
const STOP_DEADLINE_MS = 2 * GRACE_MS + 2_000;

interface Options {
  queues: string[];
  accept: string[];
  acceptAny: boolean;
  /** Packages to run from a directory here: `automerge:<package>` to an absolute path. */
  local: Record<string, string>;
  workers: number;
  sync: string;
  newQueue: string | null;
  dataDir: string;
  codeDir: string | null;
  name: string;
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
    dataDir: join(homedir(), '.patchwork-tasks'),
    codeDir: null,
    name: hostname(),
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
      case '--data-dir':
        options.dataDir = resolve(value());
        break;
      case '--code-dir':
        options.codeDir = resolve(value());
        break;
      case '--name':
        options.name = value();
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

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: there is a process, someone else's
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
};

/**
 * Makes this process the one host on `dataDir`, or says why not. A pid file
 * left by a host that died is taken over. Returns how to let go.
 */
function holdDataDir(dataDir: string): () => void {
  const file = join(dataDir, 'host.pid');
  for (let tries = 0; ; tries++) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        throw error;
      }
      if (tries > 0) {
        throw new Error(`another host has just started on ${dataDir}`);
      }
    }
    const pid = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `another host is running on ${dataDir} (pid ${pid}). Stop it first, or give this one a --data-dir of its own. If pid ${pid} is not a tasks host, delete ${file}.`,
      );
    }
    rmSync(file, { force: true }); // its host is gone
  }
  return () => {
    try {
      if (readFileSync(file, 'utf8').trim() === String(process.pid)) {
        rmSync(file, { force: true });
      }
    } catch {
      // gone already
    }
  };
}

/** The pool's id, made the first time this directory is used and the same ever after. */
function poolIdOf(dataDir: string): string {
  const file = join(dataDir, 'pool-id');
  try {
    const id = readFileSync(file, 'utf8').trim();
    if (id) {
      return id;
    }
  } catch {
    // not made yet
  }
  const id = crypto.randomUUID();
  writeFileSync(file, `${id}\n`);
  return id;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { dataDir } = options;
  mkdirSync(dataDir, { recursive: true });
  const release = holdDataDir(dataDir);
  process.on('exit', release);
  const poolId = poolIdOf(dataDir);

  await initSubduction();
  const repo = new Repo({
    network: [],
    storage: new NodeFSStorageAdapter(join(dataDir, 'pool')),
    subductionWebsocketEndpoints: [options.sync],
  } as any);

  const queues = [...options.queues];
  if (options.newQueue) {
    const queue = repo.create<Queue & { '@patchwork': { type: string } }>({
      '@patchwork': { type: QUEUE_DATATYPE_ID },
      title: options.newQueue,
      jobs: {},
    });
    await repo.flush([queue.documentId]);
    queues.push(queue.url);
    console.log(`made the queue "${options.newQueue}": ${queue.url}`);
  }

  const say = options.verbose ? (line: string) => console.log(`${new Date().toISOString()} ${line}`) : undefined;
  const executor = new NodeExecutor({
    script: new URL('./run-thread.mjs', import.meta.url),
    dataDir,
    settings: {
      repoConfig: { syncServerUrl: options.sync },
      place: { codeDir: options.codeDir ?? join(dataDir, 'code'), local: options.local },
    },
    taskBytes: (taskUrl) => repo.export(taskUrl),
    say,
  });
  const acceptance: Acceptance = options.acceptAny ? 'any' : options.accept;
  const pool = new Pool({
    repo: repo as unknown as Docs,
    id: poolId,
    name: options.name,
    slots: options.workers,
    executor,
    queues: Object.fromEntries(queues.map((url) => [url as AutomergeUrl, acceptance])),
  });

  const whose = options.acceptAny
    ? 'any code'
    : `code from ${options.accept.length} package${options.accept.length === 1 ? '' : 's'}`;
  console.log(
    `${options.name}: pool ${poolId}, ${options.workers} slot${options.workers === 1 ? '' : 's'} on ${queues.length} queue${queues.length === 1 ? '' : 's'}, running ${whose}`,
  );
  for (const url of queues) {
    console.log(`  queue ${url}`);
  }
  if (!options.acceptAny) {
    for (const url of options.accept) {
      console.log(`  code from ${url}${options.local[url] ? ` (from ${options.local[url]})` : ''}`);
    }
  }

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      console.error(`${signal} again: exiting now`);
      process.exit(1);
    }
    stopping = true;
    console.log(`${signal}: stopping ${pool.busy} run${pool.busy === 1 ? '' : 's'}`);
    setTimeout(() => {
      console.error(`not stopped after ${STOP_DEADLINE_MS / 1000} s: exiting all the same`);
      process.exit(1);
    }, STOP_DEADLINE_MS).unref();
    try {
      await pool.stop();
      // sends the server what was saved, the runs' ends among it
      await repo.shutdown();
    } catch (error) {
      console.error('stopping:', error);
    }
    console.log('stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(2);
});
