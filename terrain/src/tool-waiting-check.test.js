// A checker's case of the waiting words of Fetch data (step 5 of the task
// system): whether "this browser takes no part, because the tasks package is
// not installed here" stays true once this page's pool host appears. doWork,
// watchWork and stopWork are stood in for, as in tool-fetch.test.js.
import { it, expect, vi, afterEach } from "vitest";
import { FakeRepo } from "./test/fake-repo.js";
import { terrainDoc } from "./test/fixture.js";

const calls = vi.hoisted(() => ({ doWork: [] }));
vi.mock("./task-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  doWork: (repo, request, options) => new Promise((resolve, reject) => calls.doWork.push({ options, resolve, reject })),
  watchWork: () => () => {},
  stopWork: async () => true,
}));

const { default: TerrainTool } = await import("./tool.js");

const TASK = "automerge:4bCdEfGhJkLmNpQrStUvWxYz12";
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
afterEach(() => {
  document.body.innerHTML = "";
  delete window.patchworkTasks;
});

it.fails("the first view of a fetch asked before this page's pool host has started says the tasks package is not installed, and keeps saying so once the host is there", async () => {
  // Shows: doWork's joinPool appends the pool's component, which registers
  // its host only once the package's component is loaded and mounted; a view
  // that arrives before then is shown with poolHere() false, and the words are
  // worked out again only when the next view comes. With the tasks package
  // installed, the page then says it is not installed, until the task's state
  // changes (for a task this browser's pool cannot take, until it is taken
  // elsewhere). Nothing recomputes the words on window.patchworkTasks's
  // hostsChanged.
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ data: { set() {} } }) });
  const repo = new FakeRepo();
  const doc = terrainDoc();
  doc.data = null;
  const handle = repo.add(doc);
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  TerrainTool(handle, element);
  element.querySelector(".fetch").click();
  await settle();
  calls.doWork[0].options.onProgress({ key: "k", state: "waiting", taskUrl: TASK, importUrl: "x", input: null, progress: null, logs: [], result: undefined, error: null, runs: [] });
  expect(element.querySelector(".where").textContent).toContain("the tasks package is not installed here");
  // the pool's component mounts: its host is registered, as pool-host.ts's startPoolHost does it
  const hostsChanged = new EventTarget();
  window.patchworkTasks = { poolHosts: { 1: {} }, hostsChanged };
  hostsChanged.dispatchEvent(new Event("change"));
  await settle();
  expect(element.querySelector(".where").textContent).not.toContain("not installed");
});
