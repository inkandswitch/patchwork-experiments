// Telling the others what the doc bears out (telling.js; STAGE.md "Telling"):
// a mounted stage on a manual clock, an extension that declares one message,
// and a peer's sends put on the wire as presence carries them. Every case of
// valid × when `says` first answers × how often the same send arrives, each
// checked for what is told, as what, and when; then the speaker's name, one's
// own tell, and what still goes to `receive`.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { manualTime } from "./time.js";
import { SEND } from "./presence.js";
import { NAME_MS, TELL_MS } from "./telling.js";

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

/**
 * An extension telling "moved": valid when data.to is a number, borne out
 * once the doc has object a at x ≥ data.to. Every `says` it is asked, and
 * every message `receive` gets, is recorded.
 */
function teller() {
  const seen = { asked: [], received: [], api: null };
  const ext = {
    meta: { id: "t.teller" },
    module: {
      create(api) {
        seen.api = api;
        return {
          messages: {
            moved: {
              valid: (d) => !!d && typeof d === "object" && Number.isFinite(d.to),
              says(d, who, scene) {
                seen.asked.push({ who, at: api.clock.now() });
                return (scene.objects.a?.transform?.position?.[0] ?? 0) >= d.to ? `${who.name} moved a to ${d.to}` : null;
              },
            },
          },
          receive: (type, data, from) => seen.received.push({ type, data, from }),
        };
      },
    },
  };
  return { ext, seen };
}

async function setup({ repo = new FakeRepo(), viewerId = "viewer:bob" } = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const time = manualTime();
  const { ext, seen } = teller();
  const s = await mountStage({ repo, viewerId, time, extensions: [ext], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
  cleanups.push(() => s.unmount());
  await time.until(() => seen.api, { what: "the extension running" });
  await time.step(2);
  /** a peer's send, as presence carries it (`n`: its number in that peer's sends) */
  const wire = (data, { n = 1, kind = "moved", viewer = "viewer:zed", session = "peer-1" } = {}) =>
    s.handle.emit("ephemeral-message", { message: { type: SEND, session, viewer, ext: "t.teller", kind, n, data } });
  /** the doc moves a to x: an update of the stage */
  const moveTo = async (x) => {
    s.change((d) => (d.objects.a.transform.position = [x, 0, 0]));
    await time.step(1);
  };
  const told = () => s.local.get().notices.map((n) => ({ text: n.text, at: n.at }));
  return { s, time, seen, wire, moveTo, told };
}

describe("a peer's word, held to the doc", () => {
  // when `says` first answers text, as the doc it's handed: a's x reaching `to`
  //   never        : a never gets there
  //   at once      : a is there already
  //   after update : the second doc change inside the window gets it there
  //   after window : only a change past TELL_MS does
  const SAYS = ["never", "at once", "after update", "after window"];
  const cases = [];
  for (const valid of [false, true]) for (const says of SAYS) for (const times of [1, 2]) cases.push({ valid, says, times });

  it.each(cases)("valid $valid, says text $says, delivered $times time(s)", async ({ valid, says, times }) => {
    const t = await setup();
    const to = { never: 99, "at once": 0, "after update": 2, "after window": 3 }[says];
    const t0 = t.time.now();
    const data = valid ? { to } : { to: String(to) };
    t.wire(data);
    await t.time.step(1);
    // the same send again (presence de-duplicates by the sender's session and number)
    if (times === 2) t.wire(data);
    await t.time.advance(500 - (t.time.now() - t0));
    await t.moveTo(1);
    await t.time.advance(1000 - (t.time.now() - t0));
    await t.moveTo(2);
    await t.time.advance(TELL_MS + 500 - (t.time.now() - t0));
    await t.moveTo(3);
    await t.time.step(2);
    const shown = t.told();
    const tells = valid && (says === "at once" || says === "after update");
    expect(shown.map((n) => n.text)).toEqual(tells ? [`Someone moved a to ${to}`] : []);
    if (tells) {
      // at its arrival, or at the update that bore it out (a frame or two: the doc change, then the flush)
      const at = shown[0].at - t0;
      if (says === "at once") expect(at).toBeLessThan(2 * t.time.frameMs);
      else expect(at).toBeGreaterThanOrEqual(1000), expect(at).toBeLessThan(1000 + 3 * t.time.frameMs);
    }
    // an invalid word is never asked about; a valid one is asked at most until the window ends
    if (!valid) expect(t.seen.asked).toEqual([]);
    else for (const a of t.seen.asked) expect(a.at - t0).toBeLessThanOrEqual(TELL_MS);
    // a told word never reaches receive, and nothing waits once it's told or its time is up
    expect(t.seen.received).toEqual([]);
    expect(t.s.debug.telling.waiting()).toBe(0);
  });
});

describe("a word the doc never bears out, in a quiet doc", () => {
  // nothing updates the stage after it arrives, so nothing asks it again: it is forgotten when its time runs out
  it.each([{ valid: true }, { valid: false }])("valid $valid: waits until TELL_MS, then is gone", async ({ valid }) => {
    const t = await setup();
    const t0 = t.time.now();
    t.wire(valid ? { to: 99 } : { to: "99" });
    await t.time.step(1);
    expect(t.s.debug.telling.waiting()).toBe(valid ? 1 : 0);
    await t.time.advance(TELL_MS - 2 * t.time.frameMs - (t.time.now() - t0));
    expect(t.s.debug.telling.waiting()).toBe(valid ? 1 : 0);
    await t.time.advance(4 * t.time.frameMs);
    expect(t.s.debug.telling.waiting()).toBe(0);
    expect(t.told()).toEqual([]);
    expect(t.seen.asked).toHaveLength(valid ? 1 : 0);
  });
});

describe("the speaker is named by the stage", () => {
  // contact {a doc with a name, a doc without one, no doc to be had, a doc that's slow to come, no viewer}
  it.each([
    { contact: "named", expect: "Ana moved a to 0", wait: false },
    { contact: "unnamed", expect: "Someone moved a to 0", wait: false },
    { contact: "missing", expect: "Someone moved a to 0", wait: false },
    { contact: "slow", expect: "Someone moved a to 0", wait: true },
    { contact: "none", expect: "Someone moved a to 0", wait: false },
  ])("$contact contact → “$expect”", async ({ contact, expect: text, wait }) => {
    const repo = new FakeRepo();
    const viewer =
      contact === "named" ? repo.add({ name: "Ana" }).url : contact === "unnamed" ? repo.add({}).url : contact === "missing" ? "automerge:gone" : contact === "slow" ? "automerge:slow" : null;
    if (contact === "slow") {
      const find = repo.find.bind(repo);
      repo.find = (url) => (url === viewer ? new Promise(() => {}) : find(url));
    }
    const t = await setup({ repo });
    const t0 = t.time.now();
    t.wire({ to: 0 }, { viewer });
    await settle();
    await t.time.step(1);
    if (wait) {
      // not asked, nor told, until the name has come or NAME_MS has passed
      expect(t.seen.asked).toEqual([]);
      expect(t.told()).toEqual([]);
      await t.time.advance(NAME_MS + 100);
      await settle();
      expect(t.told()[0].at - t0).toBeGreaterThanOrEqual(NAME_MS);
    }
    expect(t.told().map((n) => n.text)).toEqual([text]);
    expect(t.seen.asked.map((a) => a.who)).toEqual([{ viewer, name: text.split(" ")[0], mine: false }]);
  });

  it("is asked once per viewer: a second word from them waits on nothing", async () => {
    const repo = new FakeRepo();
    const ana = repo.add({ name: "Ana" });
    const find = vi.spyOn(repo, "find");
    const t = await setup({ repo });
    t.wire({ to: 0 }, { viewer: ana.url, n: 1 });
    await settle();
    t.wire({ to: -1 }, { viewer: ana.url, n: 2 });
    await settle();
    await t.time.step(1);
    expect(t.told().map((n) => n.text)).toEqual(["Ana moved a to 0", "Ana moved a to -1"]);
    expect(find.mock.calls.filter(([u]) => u === ana.url)).toHaveLength(1);
    expect(t.seen.asked.map((a) => a.who.name)).toEqual(["Ana", "Ana"]);
  });

  it("a name that comes after NAME_MS names them from their next word on", async () => {
    const repo = new FakeRepo();
    const ana = repo.add({ name: "Ana" });
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    repo.find = (url) => (url === ana.url ? gate.then(() => find(url)) : find(url));
    const t = await setup({ repo });
    t.wire({ to: 0 }, { viewer: ana.url, n: 1 });
    await settle();
    await t.time.advance(NAME_MS + 100);
    await settle();
    release();
    await settle();
    t.wire({ to: 0 }, { viewer: ana.url, n: 2 });
    await settle();
    await t.time.step(1);
    expect(t.told().map((n) => n.text)).toEqual(["Someone moved a to 0", "Ana moved a to 0"]);
  });
});

describe("one's own tell, and what is still receive's", () => {
  /** Two views of one doc in one page (the page bus carries between them), on one clock. */
  async function two() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const time = manualTime();
    const repo = new FakeRepo();
    const A = teller();
    const B = teller();
    let which = A;
    const ext = { meta: { id: "t.teller" }, module: { create: (api) => which.ext.module.create(api) } };
    const a = await mountStage({ repo, viewerId: "viewer:ana", time, extensions: [ext], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    cleanups.push(() => a.unmount());
    await time.until(() => A.seen.api, { what: "A's extension" });
    which = B;
    const { default: Stage } = await import("./stage.js");
    const el = document.createElement("div");
    el.repo = a.repo;
    el.viewerId = "viewer:bob";
    el.time = time;
    document.body.append(el);
    const off = Stage(a.handle, el);
    cleanups.push(() => (off(), el.remove()));
    await time.until(() => B.seen.api, { what: "B's extension" });
    await time.step(2);
    const notices = (s) => s.atom.get().notices.map((n) => n.text);
    const bView = () => el.querySelector(".scene-stage").__sceneDebug.view;
    return { time, a, A, B, aNotices: () => notices(a.debug.view), bNotices: () => notices(bView()) };
  }

  it("told here at once as “You”, sent once, never echoed; told there once the doc bears it out", async () => {
    const t = await two();
    t.a.change((d) => (d.objects.a.transform.position = [5, 0, 0]));
    await t.time.step(2);
    t.A.seen.api.tell("moved", { to: 5 });
    expect(t.aNotices()).toEqual(["You moved a to 5"]);
    await t.time.step(3);
    expect(t.bNotices()).toEqual(["Someone moved a to 5"]);
    // told once on each side, and A's own send never came back to it as a peer's
    await t.time.advance(TELL_MS + 100);
    expect(t.aNotices()).toEqual(["You moved a to 5"]);
    expect(t.bNotices()).toEqual(["Someone moved a to 5"]);
    expect(t.A.seen.asked.map((a) => a.who)).toEqual([{ viewer: "viewer:ana", name: "You", mine: true }]);
    expect(t.B.seen.asked.map((a) => a.who)).toEqual([{ viewer: "viewer:ana", name: "Someone", mine: false }]);
    expect(t.A.seen.received).toEqual([]);
    expect(t.B.seen.received).toEqual([]);
  });

  it("what is told is a copy: changing one's data after telling it changes nothing told, here or there", async () => {
    const t = await two();
    const d = { to: 1 };
    t.A.seen.api.tell("moved", d);
    d.to = 99;
    t.a.change((doc) => (doc.objects.a.transform.position = [1, 0, 0]));
    await t.time.step(3);
    expect(t.aNotices()).toEqual(["You moved a to 1"]);
    expect(t.bNotices()).toEqual(["Someone moved a to 1"]);
  });

  it("one's own waits for the doc too, on this stage's updates", async () => {
    const t = await two();
    t.A.seen.api.tell("moved", { to: 1 });
    expect(t.aNotices()).toEqual([]);
    t.a.change((d) => (d.objects.a.transform.position = [1, 0, 0]));
    await t.time.step(3);
    expect(t.aNotices()).toEqual(["You moved a to 1"]);
    expect(t.bNotices()).toEqual(["Someone moved a to 1"]);
  });

  it("an invalid tell, or one of a type it doesn't declare, is neither said nor sent; a plain send is still receive's", async () => {
    const t = await two();
    const sent = vi.spyOn(t.a.debug.presence, "send");
    t.A.seen.api.tell("moved", { to: "5" });
    t.A.seen.api.tell("waved", { to: 0 });
    await t.time.step(3);
    expect(sent).not.toHaveBeenCalled();
    expect(t.aNotices()).toEqual([]);
    expect(t.bNotices()).toEqual([]);
    t.A.seen.api.send("waved", { hi: 1 });
    await t.time.step(3);
    expect(t.B.seen.received.map((r) => [r.type, r.data])).toEqual([["waved", { hi: 1 }]]);
    expect(t.B.seen.asked).toEqual([]);
  });
});
