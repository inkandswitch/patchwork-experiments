// What this viewer's keys, mouse and gamepad say, as one port's input bytes.
import { ticcmd, BT } from "../doom.js";

// Doom's own speeds (g_game.c): forwardmove {0x19, 0x32}, sidemove {0x18,
// 0x28}, angleturn {640, 1280}; the mouse turns by 8 units a mickey.
const FORWARD = [25, 50], SIDE = [24, 40], TURN = [640, 1280];

// SNES pad bits (engines/snes/src/machine.cpp).
const SNES = { B: 0x1, Y: 0x2, SELECT: 0x4, START: 0x8, UP: 0x10, DOWN: 0x20, LEFT: 0x40, RIGHT: 0x80, A: 0x100, X: 0x200, L: 0x400, R: 0x800 };
const SNES_KEYS = {
  ArrowUp: SNES.UP, ArrowDown: SNES.DOWN, ArrowLeft: SNES.LEFT, ArrowRight: SNES.RIGHT,
  KeyZ: SNES.B, KeyX: SNES.A, KeyA: SNES.Y, KeyS: SNES.X, KeyQ: SNES.L, KeyW: SNES.R,
  Enter: SNES.START, ShiftRight: SNES.SELECT, Backspace: SNES.SELECT,
};
/** Each SNES pad button's name, by its bit. */
const SNES_NAMES = { [SNES.UP]: "Up", [SNES.DOWN]: "Down", [SNES.LEFT]: "Left", [SNES.RIGHT]: "Right", [SNES.B]: "B", [SNES.A]: "A", [SNES.Y]: "Y", [SNES.X]: "X", [SNES.L]: "L", [SNES.R]: "R", [SNES.START]: "Start", [SNES.SELECT]: "Select" };
// The standard gamepad layout, by button index.
const SNES_PAD = [SNES.B, SNES.A, SNES.Y, SNES.X, SNES.L, SNES.R, 0, 0, SNES.SELECT, SNES.START, 0, 0, SNES.UP, SNES.DOWN, SNES.LEFT, SNES.RIGHT];

export const HELP = {
  doom: "Arrows or WASD move · mouse turns (click the picture) · Ctrl / click fires · Space / E uses · Shift runs · Alt or , . strafes · 1–7 weapons",
  snes: "Arrows · Z = B · X = A · A = Y · S = X · Q / W = L / R · Enter = Start · Backspace = Select · or a gamepad",
};

/**
 * The keys each machine's pad reads, by code, for a held tool to declare
 * (scene/STAGE.md, "The held tool": its declared keys are its own).
 */
export const KEYS = {
  doom: [
    ["ArrowUp", "Forward"], ["ArrowDown", "Back"], ["ArrowLeft", "Turn left"], ["ArrowRight", "Turn right"],
    ["KeyW", "Forward"], ["KeyS", "Back"], ["KeyA", "Strafe left"], ["KeyD", "Strafe right"],
    ["Comma", "Strafe left"], ["Period", "Strafe right"], ["AltLeft", "Strafe"], ["AltRight", "Strafe"],
    ["ShiftLeft", "Run"], ["ShiftRight", "Run"], ["ControlLeft", "Fire"], ["ControlRight", "Fire"],
    ["Space", "Use"], ["KeyE", "Use"],
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => [`Digit${n}`, "Weapon"]),
  ].map(([code, label]) => ({ code, label })),
  // each key labelled with the pad's button it presses (SNES_KEYS)
  snes: Object.entries(SNES_KEYS).map(([code, bit]) => ({ code, label: SNES_NAMES[bit] })),
};

/**
 * One port's pad: the keys held down, the mouse's turn and its button, and a
 * gamepad if one is connected, sampled once a tick as the port's input bytes.
 * Fed by whatever hears the events: the Machine tool's element (inputs()
 * below), or a scene's held tool.
 */
export function pad(kind, inputBytes) {
  const down = new Set();
  let mouse = 0; // mickeys since the last sample
  let fire = false;
  const gamepad = () => [...(globalThis.navigator?.getGamepads?.() ?? [])].find(Boolean);

  const doom = () => {
    const has = (...c) => c.some((x) => down.has(x));
    const g = gamepad();
    const run = has("ShiftLeft", "ShiftRight") ? 1 : 0;
    const strafe = has("AltLeft", "AltRight");
    let forward = 0, side = 0, turn = 0, buttons = 0;
    if (has("ArrowUp", "KeyW")) forward += FORWARD[run];
    if (has("ArrowDown", "KeyS")) forward -= FORWARD[run];
    const left = has("ArrowLeft"), right = has("ArrowRight");
    if (strafe) side += (right ? SIDE[run] : 0) - (left ? SIDE[run] : 0);
    else turn += (left ? TURN[run] : 0) - (right ? TURN[run] : 0);
    if (has("KeyA", "Comma")) side -= SIDE[run];
    if (has("KeyD", "Period")) side += SIDE[run];
    turn -= mouse * 8 * 8;
    mouse = 0;
    if (g) {
      const [lx, ly, rx] = g.axes.map((a) => (Math.abs(a) < 0.15 ? 0 : a));
      forward -= Math.round(ly * FORWARD[1]);
      side += Math.round(lx * SIDE[1]);
      turn -= Math.round(rx * TURN[1]);
    }
    if (has("ControlLeft", "ControlRight") || fire || g?.buttons[7]?.pressed) buttons |= BT.ATTACK;
    if (has("Space", "KeyE") || g?.buttons[0]?.pressed) buttons |= BT.USE;
    for (let n = 1; n <= 7; n++) if (down.has(`Digit${n}`)) buttons = (buttons & ~0x38) | BT.CHANGE | ((n - 1) << BT.WEAPONSHIFT);
    const clamp = (v) => Math.max(-127, Math.min(127, v));
    return ticcmd({ forward: clamp(forward), side: clamp(side), turn: Math.max(-32768, Math.min(32767, turn)), buttons });
  };
  const snes = () => {
    let b = 0;
    for (const c of down) b |= SNES_KEYS[c] ?? 0;
    const g = gamepad();
    if (g) {
      g.buttons.forEach((x, i) => x.pressed && (b |= SNES_PAD[i] ?? 0));
      const [lx, ly] = g.axes;
      if (lx < -0.5) b |= SNES.LEFT;
      if (lx > 0.5) b |= SNES.RIGHT;
      if (ly < -0.5) b |= SNES.UP;
      if (ly > 0.5) b |= SNES.DOWN;
    }
    const out = new Uint8Array(inputBytes);
    out[0] = b & 0xff;
    out[1] = b >> 8;
    return out;
  };
  return {
    /** A key went down (true) or up (false), by its code. */
    key(code, isDown) {
      if (isDown) down.add(code);
      else down.delete(code);
    },
    /** The mouse turned by dx mickeys (Doom). */
    turn(dx) {
      mouse += dx;
    },
    /** The mouse's button (Doom fires). */
    fire(isDown) {
      fire = isDown;
    },
    /** Everything let go (focus lost, the pad put down). */
    clear() {
      down.clear();
      fire = false;
      mouse = 0;
    },
    sample: kind === "doom" ? doom : snes,
  };
}

/** Keyboard, mouse and gamepad state for one element, sampled per tick. */
export function inputs(kind, element, inputBytes) {
  const p = pad(kind, inputBytes);
  const key = (e) => {
    if (e.metaKey) return;
    p.key(e.code, e.type === "keydown");
    if (/^Arrow|^Space$|^Backspace$|^Enter$|^Key[ZXASQWED]$/.test(e.code)) e.preventDefault();
  };
  const blur = () => p.clear();
  const move = (e) => {
    if (document.pointerLockElement) p.turn(e.movementX);
  };
  const press = (e) => {
    if (e.button === 0 && document.pointerLockElement) p.fire(e.type === "mousedown");
  };
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("blur", blur);
  document.addEventListener("mousemove", move);
  document.addEventListener("mousedown", press);
  document.addEventListener("mouseup", press);
  return {
    sample: p.sample,
    dispose() {
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("blur", blur);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mousedown", press);
      document.removeEventListener("mouseup", press);
    },
  };
}
