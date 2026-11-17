// The touch controls, with real fingers (Chrome's touch emulation) in
// headless Chrome: probes/touch-probe.html's built scene, a keyboard body
// that locks the pointer, a tool with a key, and a block to carry.
//
//   pnpm build
//   node probes/touch-run.mjs [--port 4693] [--cdp 9693] [--show] [--shots <dir>]
//
// Enters the body by tapping the chip's menu (no pointer lock is asked for),
// reads the pad (the arrows' places and the buttons under each layer), opens
// the chip's menu again over the pad's buttons (each item on top), holds
// Forward (the body hears W down and up), holds it while another finger
// drags on the world to look (both at once), holds Run with Forward, presses
// the wrench's Reload (the tool's, not the body's), carries the block with
// one finger and turns it with Turn left on the pad, carries it again and
// puts it back with a second finger on the Esc hint ("Put it back"), holds a
// finger still on the block (its menu, not the eye's look's), then a
// mouse click on the world hides the pad and only asks for the lock.
//
// The use prompt's buttons are keys (STAGE.md, "Keys"): first in Look, a tap on
// the post shows its verbs where it tapped and keeps them when the finger
// lifts; Ring by a tap rings once; Wind (hold G) winds only while a finger
// holds its button; Open runs once on a tap though Shut takes its place
// under the finger before the lift. Then walking, the eye on the post:
// Wind held from the prompt in the middle, no lock asked. Last, with a
// mouse: the button held down winds, let up stops; its right or middle
// button on Ring rings nothing. Prints a JSON report; exits non-zero on a
// failure.
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

  /** Hold a prompt button (by name) with a finger for `ms` of page time: the turns wound before, during and after. */
  const windBy = async (press, lift, ms = 300) => {
    const t0 = await P("turns()");
    await press();
    await b.rest(ms);
    const t1 = await P("turns()");
    const held = (await P("prompt()"))?.find((v) => v.name === "Wind")?.held ?? null;
    await lift();
    await b.rest(ms);
    const t2 = await P("turns()");
    return { wound: t1 - t0, after: t2 - t1, held, heard: await heard() };
  };
  const verb = async (name) => (await P("prompt()"))?.find((v) => v.name === name) ?? null;

  // 0. in Look, a finger on the post: its verbs where it tapped, kept when it lifts; Ring is a tap; Wind lasts as long as the finger
  await heard();
  const post = await P("post()");
  await touch.tap(post);
  await b.rest(200);
  const tapped = { look: await P("look()"), prompt: await P("prompt()") };
  await touch.tap((await verb("Ring")).at);
  await b.rest(60);
  const rung = await heard();
  const wind0 = await verb("Wind");
  const w0 = await windBy(() => touch.fingers([[1, ...wind0.at]]), () => touch.fingers([]));
  check(
    "0. in Look, a tap on the post shows Ring (T), Wind (hold G) and Open (Y) below where it tapped, still there after the lift; a tap on Ring rings once; Wind winds only while a finger holds it",
    tapped.look === "post" && JSON.stringify(tapped.prompt?.map((v) => [v.name, v.key])) === JSON.stringify([["Ring", "T"], ["Wind", "G"], ["Open", "Y"]]) && Math.abs(tapped.prompt[0].at[0] - post[0]) < 80 && tapped.prompt[0].at[1] > post[1] &&
      JSON.stringify(rung) === JSON.stringify(["ring"]) && w0.wound >= 10 && w0.after === 0 && w0.held === true && JSON.stringify(w0.heard) === JSON.stringify(["wind", "wind end"]) && (await P("focused()")) === "root",
    { post, tapped, rung, w0 },
  );

  // 0b. a verb that runs on the press puts another in its place before the finger lifts (Open, then Shut, by a
  // doc change): Chrome clicks the button under the lift once the one pressed has gone, and that click runs nothing
  const lidTap = async (name) => {
    const at = (await verb(name))?.at;
    if (!at) return null;
    await touch.fingers([[1, ...at]]);
    await b.rest(120); // a human's tap: the prompt has drawn what the press did before the lift
    const during = (await P("prompt()"))?.map((v) => v.name);
    await touch.fingers([]);
    await b.rest(60);
    return { during, heard: await heard(), lid: await P("lid()"), after: (await P("prompt()"))?.map((v) => v.name) };
  };
  const opened = await lidTap("Open");
  const shut = await lidTap("Shut");
  check(
    "0b. a tap on Open opens the lid once, though Shut takes its place under the finger before the lift (that lift's click runs nothing); a tap on Shut shuts it once",
    JSON.stringify(opened?.during) === JSON.stringify(["Ring", "Wind", "Shut"]) && JSON.stringify(opened?.heard) === JSON.stringify(["open"]) && opened?.lid === true &&
      JSON.stringify(shut?.heard) === JSON.stringify(["shut"]) && shut?.lid === false && JSON.stringify(shut?.after) === JSON.stringify(["Ring", "Wind", "Open"]),
    { opened, shut },
  );

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

  // 2b. the chip's menu opens over the pad's buttons: every item takes the finger where it's drawn, no pad key beneath
  await touch.tap(await P("chip()"));
  await b.until(`window.__probe.menuItem("Walkish")`, { frames: 60, what: "the chip's menu" });
  const items = await b.js(`[...document.querySelectorAll(".body-menu .menu-item")].map((e) => { const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: e.textContent, top: top === e || e.contains(top) ? "item" : (top?.className ?? null) }; })`);
  const under = await b.js(`(() => { const m = document.querySelector(".body-menu").getBoundingClientRect(), k = document.querySelector(".touch-buttons").getBoundingClientRect(); return m.bottom > k.top && k.bottom > m.top && m.right > k.left && k.right > m.left; })()`);
  await touch.tap(await P('menuItem("Walkish")'));
  await b.rest(100);
  const afterItem = { menu: await b.js(`!!document.querySelector(".body-menu")`), body: (await P("view()")).body, heard: await heard() };
  check("2b. the chip's menu over the pad's buttons: every item is on top where it's drawn, and a tap on one is the item's, not a pad key's", under && items.length >= 3 && items.every((i) => i.top === "item") && !afterItem.menu && afterItem.body === "walkish" && afterItem.heard.length === 0, { under, items, afterItem });

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

  // 7c. a finger's long press on the block opens the block's menu: what it pressed, not what the eye looks at
  // (the look of a lock body under touch is the eye's, HISTORY.md, TOOLS Decisions 14)
  const lookBefore = await P("look()");
  const block3 = await P("block()");
  await touch.fingers([[1, ...block3]]);
  await b.rest(700);
  const longMenu = await P("contextMenu()");
  await touch.fingers([]);
  await P("closeMenu()");
  await b.rest(100);
  check(
    "7c. a finger held still on the block opens the Block's menu, while the eye looks elsewhere",
    lookBefore !== "block" && JSON.stringify(longMenu?.slice(0, 1)) === JSON.stringify(["Block"]) && (await P("contextMenu()")) === null && (await P("view()")).gesture === null,
    { lookBefore, longMenu },
  );
  await heard();

  // 9. walking, the eye on the post: the prompt in the middle, Wind held by a finger winds while it's down; no lock asked
  await P("aim([-0.8, 0.5, 0])");
  await b.rest(100);
  const asks9 = await b.js("window.__asks");
  const walkPrompt = await P("prompt()");
  const wind9 = await verb("Wind");
  const w9 = wind9 ? await windBy(() => touch.fingers([[1, ...wind9.at]]), () => touch.fingers([])) : null;
  check(
    "9. walking under touch with the eye on the post: the prompt in the middle offers Wind; a finger on it winds only while it's down, and the lock is never asked",
    (await P("look()")) === "post" && Math.abs(wind9?.at?.[0] - 450) < 80 && w9?.wound >= 10 && w9?.after === 0 && JSON.stringify(w9?.heard) === JSON.stringify(["wind", "wind end"]) && (await b.js("window.__asks")) === asks9 && !(await P("locked()")),
    { look: await P("look()"), walkPrompt, w9 },
  );
  await shot("4-wind");

  // 8. back to a mouse: the pad hides; a press on the world after a finger only takes the lock back (HISTORY.md, TOOLS Decisions 11)
  await b.click(world[0], world[1]);
  await b.rest(100);
  v = await P("view()");
  const asks = await b.js("window.__asks");
  const padAfter = await P("pad()");
  const clicked = await heard();
  check("8. a mouse click on the world hides the pad and only asks for the lock (headless Chrome refuses it): the body hears no press", padAfter === null && v.pointer.touch === false && asks === 1 && !clicked.includes("body press"), { v, padAfter, asks, clicked });
  await shot("3-mouse");

  // 10. a mouse holds a held verb too: over the post (the look follows it: the lock refused), down on Wind's button winds, up stops
  const post10 = await P("post()");
  await b.mouse("mouseMoved", post10[0], post10[1]);
  await b.rest(100);
  const wind10 = await verb("Wind");
  let w10 = null;
  if (wind10) {
    await b.mouse("mouseMoved", wind10.at[0], wind10.at[1]);
    await b.rest(60);
    w10 = await windBy(() => b.mouse("mousePressed", wind10.at[0], wind10.at[1]), () => b.mouse("mouseReleased", wind10.at[0], wind10.at[1]));
  }
  check(
    "10. with a mouse: Wind's button held down winds, and let up stops",
    w10?.wound >= 10 && w10?.after === 0 && JSON.stringify(w10?.heard) === JSON.stringify(["wind", "wind end"]),
    { view: await P("view()"), wind10, w10 },
  );

  // 10b. only a primary press: a mouse's right or middle button on Ring rings nothing (as it clicks no button)
  const ring10 = await verb("Ring");
  const aux = [];
  if (ring10)
    for (const button of ["right", "middle"]) {
      await b.mouse("mousePressed", ring10.at[0], ring10.at[1], { button });
      await b.mouse("mouseReleased", ring10.at[0], ring10.at[1], { button });
      await b.rest(60);
      aux.push([button, await heard(), await P("contextMenu()")]);
    }
  check("10b. a right or a middle press on Ring rings nothing, and opens no menu", JSON.stringify(aux) === JSON.stringify([["right", [], null], ["middle", [], null]]), { ring10, aux });

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
