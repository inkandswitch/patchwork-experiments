// @vitest-environment node
import { describe, it, expect } from "vitest";
import { descendants, run } from "./foam.mjs";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("stopping a command", () => {
  it("kills grandchildren that left the process group (as mpirun's ranks do)", async () => {
    // a shell whose child starts its own session and sleeps: the shape of bash → prterun → ranks
    const env = { argv: (cmd) => ["bash", ["-c", cmd]] };
    const r = run(env, "perl -e 'use POSIX; setsid(); sleep 60' & perl -e 'use POSIX; setsid(); sleep 60' & wait", { cwd: process.cwd() });
    await new Promise((res) => setTimeout(res, 400));
    const tree = descendants(process.pid);
    expect(tree.length).toBeGreaterThanOrEqual(3);
    r.kill();
    await r.done;
    await new Promise((res) => setTimeout(res, 300));
    for (const pid of tree) expect(alive(pid), `pid ${pid}`).toBe(false);
  });
});
