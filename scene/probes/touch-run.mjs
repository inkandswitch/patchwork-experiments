// The touch controls, with real fingers (Chrome's touch emulation) in
// headless Chrome: probes/touch-probe.html's built scene, a keyboard body
// that locks the pointer, a tool with a key, and a block to carry.
//
//   pnpm build
//   node probes/touch-run.mjs [--port 4693] [--cdp 9693] [--show] [--shots <dir>]
//
// Enters the body by tapping the chip's menu (no pointer lock is asked for),
// reads the pad (the arrows' places and the buttons under each layer), holds
// Forward (the body hears W down and up), holds it while another finger
// drags on the world to look (both at once), holds Run with Forward, presses
// the wrench's Reload (the tool's, not the body's), carries the block with
// one finger and turns it with Turn left on the pad, carries it again and
// puts it back with a second finger on the Esc hint ("Put it back"), then a
// mouse click on the world hides the pad and only asks for the lock. Prints a JSON report; exits
// non-zero on a failure.
//
// Simulated time: the view runs on the page's manual clock (window.__time).
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, checklist } from "./cdp.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const PORT = Number(arg("port", 4693));
const CDP = Number(arg("cdp", 9693));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-touch-shots")));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const b = await browser({ root, port: PORT, cdp: CDP, page: "/probes/touch-probe.html", show: !!arg("show", false), timeout: 180_000 });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [] };
const P = (e) => b.js(`window.__probe.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `touch-${name}.png`)));
const { touch } = b;
/** what the probe's body and tool heard since the last call */
const heard = () => b.js("window.__log.splice(0)");

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  check("no setup errors", (await P("errors")).length === 0, await P("errors"));
  check("loaded", await b.waitFor("window.__probe.loaded()", 20_000));
  await b.rest(200);
  await touch.emulate(true);

  // 1. into the body by fingers: the chip, then its menu
  await touch.tap(await P("chip()"));
  const item = await b.until(`window.__probe.menuItem("Walkish")`, { frames: 60, what: "the chip's menu" });
  await touch.tap(item);
  await b.rest(200);
  let v = await P("view()");
  check("1. a tap on the chip's menu enters the lock body; the lock is never asked for, nor taken", v.body === "walkish" && v.pointer.touch === true && v.pointer.locked === false && !(await P("locked()")) && (await b.js("window.__asks")) === 0, { v, asks: await b.js("window.__asks") });

  // 2. the pad
  const pad = await P("pad()");
  check("2. the pad shows the body's keys: the arrows' places, then Run, Jump and Q under its name", JSON.stringify(pad) === JSON.stringify({ pad: ["up=Forward", "left=Left", "down=Back", "right=Right"], buttons: [["Walkish", "Run", "Jump", "Q"]] }), pad);
  await shot("1-pad");
  await heard();

  // 3. hold Forward
  const fwd = await P('control("Forward")');
  const run = await P('control("Run")');
  const focusBefore = await P("focused()");
  await touch.fingers([[1, ...fwd]]);
  await b.rest(100);
  const during = await heard();
  const focusDuring = await P("focused()");
  await touch.fingers([]);
  await b.rest(60);
  const after = await heard();
  const focusAfter = await P("focused()");
  check("3. holding Forward: the body hears W down, then up when the finger lifts; focus stays where it was, during and after", JSON.stringify(during) === JSON.stringify(["body key KeyW w"]) && JSON.stringify(after) === JSON.stringify(["body keyup KeyW w"]) && focusBefore === "root" && focusDuring === "root" && focusAfter === "root", { during, after, focusBefore, focusDuring, focusAfter });

  // 4. Forward held while another finger drags on the world to look (CDP lifts every finger at once: the
  // order fingers lift in is touch.test.js's)
  const world = await P("world()");
  await touch.fingers([[1, ...fwd]]);
  await touch.fingers([[1, ...fwd], [2, ...world]]);
  for (let i = 1; i <= 8; i++) await touch.fingers([[1, ...fwd], [2, world[0] + i * 12, world[1]]]);
  const mid = await heard();
  await touch.fingers([]);
  const end4 = await heard();
  check(
    "4. Forward held while another finger looks: W stays down through the drag, the drag looks, and both end when the fingers lift",
    mid[0] === "body key KeyW w" && mid.includes("body press") && mid.filter((x) => x === "body look").length >= 3 && !mid.includes("body keyup KeyW w") && JSON.stringify(end4.filter((x) => x !== "body look")) === JSON.stringify(["body keyup KeyW w", "body look end"]),
    { mid, end4 },
  );

  // 5. Run and Forward together
  await touch.fingers([[1, ...fwd]]);
  await touch.fingers([[1, ...fwd], [2, ...run]]);
  const both = await heard();
  await touch.fingers([]);
  const none = await heard();
  check("5. Run and Forward together: both down, each up once", JSON.stringify(both) === JSON.stringify(["body key KeyW w", "body key ShiftLeft Shift"]) && JSON.stringify([...none].sort()) === JSON.stringify(["body keyup KeyW w", "body keyup ShiftLeft Shift"]), { both, none });

  // 6. the held tool's key is the tool's
  await P("wrench()");
  await b.rest(100);
  const withTool = await P("pad()");
  await touch.tap(await P('control("Reload")'));
  const reload = await heard();
  check("6. a held tool's key shows under its name, and presses the tool, not the body", JSON.stringify(withTool?.buttons) === JSON.stringify([["Wrench", "Reload"], ["Walkish", "Run", "Jump", "Q"]]) && JSON.stringify(reload) === JSON.stringify(["tool key KeyR r", "tool keyup KeyR r"]), { withTool, reload });
  await P("wrench()"); // put it down
  await b.rest(60);

  // 7. carry the block with one finger, turn it with the pad
  const block = await P("block()");
  const rot0 = await P("blockRot()");
  await touch.fingers([[1, ...block]]);
  for (let i = 1; i <= 6; i++) await touch.fingers([[1, block[0] - i * 6, block[1] + i * 3]]);
  const at = [block[0] - 36, block[1] + 18];
  const carrying = await P("view()");
  const padCarry = await P("pad()");
  await shot("2-carry");
  const turn = await P('control("Turn left", "gesture")');
  // Turn left pressed by a second finger while the first carries; then both lift (CDP lifts them together)
  if (turn) await touch.fingers([[1, ...at], [2, ...turn]]);
  await touch.fingers([]);
  await b.rest(200);
  const rot1 = await P("blockRot()");
  const dyaw = rot1[1] - rot0[1];
  check(
    "7. one finger carries the block; Turn left on the pad (the carry's, shown in its own group, unnamed: the stage knows no gesture's name) turns it a quarter of a half",
    carrying.gesture === "scene.carry" && JSON.stringify(padCarry?.buttons?.[0]) === JSON.stringify(["", "Turn left", "Turn right", "Turn over", "Place freely"]) && Math.abs(Math.abs(dyaw) - Math.PI / 4) < 1e-3 && (await P("pad()"))?.buttons?.length === 1,
    { carrying, padCarry, rot0, rot1 },
  );
  await heard();

  // 7b. carry it again, and a second finger on the Esc hint ("Put it back": the Escape key on touch) puts it back
  const pos0 = await P("blockPos()");
  const block2 = await P("block()");
  await touch.fingers([[1, ...block2]]);
  for (let i = 1; i <= 6; i++) await touch.fingers([[1, block2[0] + i * 8, block2[1]]]);
  const at2 = [block2[0] + 48, block2[1]];
  await b.rest(60);
  const hint = await P("hint()");
  if (hint?.at) await touch.fingers([[1, ...at2], [2, ...hint.at]]);
  await b.rest(60);
  const afterEsc = await P("view()");
  await touch.fingers([]);
  await b.rest(200);
  const pos1 = await P("blockPos()");
  const focusEsc = await P("focused()");
  check(
    "7b. the Esc hint is a key on touch: it says \"Put it back\", and a second finger on it puts the carried block back where it was",
    hint?.text === "Put it back" && hint?.key === "Escape" && afterEsc.gesture === null && JSON.stringify(pos1) === JSON.stringify(pos0) && focusEsc === "root",
    { hint, afterEsc, pos0, pos1, focusEsc },
  );
  await heard();

  // 8. back to a mouse: the pad hides; a press on the world after a finger only takes the lock back (TOOLS.md Decisions 9)
  await b.click(world[0], world[1]);
  await b.rest(100);
  v = await P("view()");
  const asks = await b.js("window.__asks");
  const padAfter = await P("pad()");
  const clicked = await heard();
  check("8. a mouse click on the world hides the pad and only asks for the lock (headless Chrome refuses it): the body hears no press", padAfter === null && v.pointer.touch === false && asks === 1 && !clicked.includes("body press"), { v, padAfter, asks, clicked });
  await shot("3-mouse");

  const errs = await P("errors");
  check("no errors", !errs.length, errs);
  details.pointerCapture = b.logs.filter((l) => /InvalidStateError|setPointerCapture/.test(l));
} catch (err) {
  check("ran", false, String(err?.stack || err));
}
report.logs = b.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).slice(-20);
report.ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify(report, null, 2));
b.stop(report.ok ? 0 : 1);
