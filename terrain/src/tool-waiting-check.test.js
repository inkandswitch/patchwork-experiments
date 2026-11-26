// A checker's case of the waiting words of Fetch data (step 5 of the task
// system): "this browser takes no part, because the tasks package is not
// installed here" goes once this page's pool host appears. doWork, watchWork
// and stopWork are stood in for, as in tool-fetch.test.js.
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

it("the first view of a fetch asked before this page's pool host has started says the tasks package is not installed, and stops saying so once the host is there", async () => {
  // doWork's joinPool appends the pool's component, which registers its host
  // only once the package's component is loaded and mounted; a view that
  // arrives before then is shown with poolHere() false. The tool works the
  // words out again on window.patchworkTasks's hostsChanged, with no new view,
  // and lets go of that listener when it closes.
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ data: { set() {} } }) });
  const repo = new FakeRepo();
  const doc = terrainDoc();
  doc.data = null;
  const handle = repo.add(doc);
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const close = TerrainTool(handle, element);
  element.querySelector(".fetch").click();
  await settle();
  calls.doWork[0].options.onProgress({ key: "k", state: "waiting", taskUrl: TASK, importUrl: "x", input: null, progress: null, logs: [], result: undefined, error: null, runs: [] });
  expect(element.querySelector(".where").textContent).toContain("the tasks package is not installed here");
  // the pool's component mounts: its host is registered, as pool-host.ts's startPoolHost does it
  const hosts = (window.patchworkTasks ??= {});
  hosts.poolHosts ??= {};
  hosts.hostsChanged ??= new EventTarget();
  hosts.poolHosts[1] = {};
  hosts.hostsChanged.dispatchEvent(new Event("change"));
  await settle();
  expect(element.querySelector(".where").textContent).not.toContain("not installed");
  // closing the tool lets go of the listener it added
  const added = vi.spyOn(hosts.hostsChanged, "removeEventListener");
  close();
  expect(added).toHaveBeenCalledWith("change", expect.any(Function));
});
