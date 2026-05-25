import type { ColorsDoc } from '../types.ts';
import { clamp } from '../shared/utils.ts';
import {
  findHueBridgeIp,
  pairHue,
  sendHueAction,
  hueToHueBridge,
  percentToHueSat,
  percentToHueBrightness,
  type HueAction,
} from '../shared/hue.ts';
import type { ActiveComposition } from './types.ts';
import { formatColorMix, hslForComposition } from './composition.ts';

export function createHueBridgeManager(opts: {
  handle: any;
  bridgeIpInput: HTMLInputElement;
  findButton: HTMLButtonElement;
  pairButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  syncButton: HTMLButtonElement;
  statusText: HTMLElement;
  getComposition: () => ActiveComposition;
}): {
  loadSettings(): void;
  syncControls(message?: string): void;
  applyComposition(composition: ActiveComposition, force?: boolean): Promise<void>;
  destroy(): void;
} {
  const { handle, bridgeIpInput, findButton, pairButton, toggleButton, syncButton, statusText, getComposition } = opts;

  let hueUsername = '';
  let huePairedBridgeIp = '';
  let hueLightsOn = false;
  let hueSceneSync = false;
  let hueBusy = false;
  let hueLastSceneKey = '';

  function getHueBridgeIp() {
    return bridgeIpInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  function loadSettings() {
    try {
      const doc = handle.doc() as ColorsDoc | undefined;
      const settings = doc?.hueConfig;
      if (settings) {
        bridgeIpInput.value = settings.bridgeIp ?? '';
        hueUsername = settings.username ?? '';
        huePairedBridgeIp = settings.bridgeIp ?? '';
        hueLightsOn = Boolean(settings.lightsOn);
        hueSceneSync = Boolean(settings.sceneSync);
      } else {
        bridgeIpInput.value = '';
        hueUsername = '';
        huePairedBridgeIp = '';
        hueLightsOn = false;
        hueSceneSync = false;
      }
    } catch {
      bridgeIpInput.value = '';
      hueUsername = '';
      huePairedBridgeIp = '';
      hueLightsOn = false;
      hueSceneSync = false;
    }
  }

  function saveSettings() {
    handle.change((doc: ColorsDoc) => {
      doc.hueConfig = {
        bridgeIp: getHueBridgeIp(),
        username: hueUsername,
        lightsOn: hueLightsOn,
        sceneSync: hueSceneSync,
      };
    });
  }

  function syncControls(message?: string) {
    const bridgeIp = getHueBridgeIp();
    findButton.disabled = hueBusy;
    pairButton.disabled = hueBusy || !bridgeIp;
    toggleButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    syncButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    toggleButton.textContent = hueLightsOn ? 'Turn Lights Off' : 'Turn Lights On';
    syncButton.textContent = hueSceneSync ? 'Unsync Scene' : 'Sync Scene';
    syncButton.classList.toggle('is-active', hueSceneSync);

    if (message) {
      statusText.textContent = message;
    } else if (!bridgeIp) {
      statusText.textContent = 'Enter the Hue Bridge IP, press the bridge button, then Pair.';
    } else if (!hueUsername) {
      statusText.textContent = 'Press the physical Hue Bridge button, then click Pair.';
    } else if (hueSceneSync) {
      statusText.textContent = `Scene sync active: QR colors and effects are driving Hue at ${bridgeIp}.`;
    } else {
      statusText.textContent = `Paired with ${bridgeIp}. Toggle lights, or Sync Scene for QR-driven color/effects.`;
    }
  }

  async function findBridge() {
    hueBusy = true;
    syncControls('Looking for Hue bridges on this network...');
    let statusMessage = '';

    try {
      const ip = await findHueBridgeIp();
      if (!ip) {
        statusMessage = 'No Hue Bridge found. Check it is powered, connected to the router, and online.';
        return;
      }

      bridgeIpInput.value = ip;
      if (getHueBridgeIp() !== huePairedBridgeIp) {
        hueUsername = '';
      }
      saveSettings();
      statusMessage = `Found Hue Bridge at ${ip}. Press bridge button, then Pair.`;
    } catch {
      statusMessage = 'Bridge discovery failed. You can still type the bridge IP from the Hue app or router.';
    } finally {
      hueBusy = false;
      syncControls(statusMessage || undefined);
    }
  }

  async function pair() {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp) {
      syncControls('Enter the Hue Bridge IP first.');
      return;
    }

    hueBusy = true;
    syncControls('Pairing... press the bridge button if this fails.');
    let statusMessage = '';

    try {
      const username = await pairHue(bridgeIp, 'qr_scene_machine#browser');
      if (username) {
        hueUsername = username;
        huePairedBridgeIp = bridgeIp;
        saveSettings();
        statusMessage = 'Paired. Try Turn Lights On.';
        return;
      }
      statusMessage = 'Pair failed: unexpected bridge response.';
    } catch (err) {
      statusMessage = err instanceof Error
        ? `Pair failed: ${err.message}`
        : 'Pair failed. Check bridge IP and that this page is on the same network.';
    } finally {
      hueBusy = false;
      syncControls(statusMessage || undefined);
    }
  }

  async function toggleLights() {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) {
      syncControls('Pair the Hue Bridge first.');
      return;
    }

    const nextOn = !hueLightsOn;
    hueBusy = true;
    syncControls(nextOn ? 'Turning Hue lights on...' : 'Turning Hue lights off...');
    let statusMessage = '';

    try {
      await sendHueAction(bridgeIp, hueUsername, { on: nextOn });
      hueLightsOn = nextOn;
      saveSettings();
      statusMessage = nextOn ? 'Hue lights are on.' : 'Hue lights are off.';
    } catch (err) {
      statusMessage = err instanceof Error
        ? `Hue error: ${err.message}`
        : 'Hue request failed. Check bridge IP and browser network permissions.';
    } finally {
      hueBusy = false;
      syncControls(statusMessage || undefined);
    }
  }

  async function toggleSceneSync() {
    if (!hueUsername || !getHueBridgeIp()) {
      syncControls('Pair the Hue Bridge first.');
      return;
    }

    hueSceneSync = !hueSceneSync;
    hueLightsOn = hueSceneSync ? true : hueLightsOn;
    saveSettings();
    syncControls(hueSceneSync ? 'Scene sync enabled.' : 'Scene sync paused.');

    if (hueSceneSync) {
      await applyComp(getComposition(), true);
    }
  }

  async function applyComp(composition: ActiveComposition, force = false) {
    if (!hueSceneSync || !hueUsername || !getHueBridgeIp()) {
      return;
    }

    if (!force && composition.key === hueLastSceneKey) {
      return;
    }

    hueLastSceneKey = composition.key;
    const action = createHueColorAction(composition, force ? 2 : 3);
    await doSendAction(action);
  }

  function createHueColorAction(composition: ActiveComposition, transitiontime: number): HueAction {
    const mix = hslForComposition(composition);
    return {
      on: true,
      hue: hueToHueBridge(mix.h),
      sat: percentToHueSat(composition.colors.length ? clamp(mix.s + 22, 55, 100) : mix.s),
      bri: percentToHueBrightness(composition.colors.length ? clamp(mix.l + 42, 62, 100) : 54),
      transitiontime,
    };
  }

  async function doSendAction(action: HueAction) {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) {
      return;
    }

    try {
      await sendHueAction(bridgeIp, hueUsername, action);

      if (action.on !== undefined) {
        hueLightsOn = action.on;
        saveSettings();
        syncControls(hueSceneSync ? `Hue target: ${formatColorMix(getComposition().colors) || 'Idle'}.` : undefined);
      }
    } catch {
      hueSceneSync = false;
      syncControls('Hue sync stopped: bridge request failed.');
      saveSettings();
    }
  }

  function onBridgeInput() {
    if (getHueBridgeIp() !== huePairedBridgeIp) {
      hueUsername = '';
    }
    saveSettings();
    syncControls();
  }

  // Wire up event listeners
  bridgeIpInput.addEventListener('input', onBridgeInput);
  findButton.addEventListener('click', () => { void findBridge(); });
  pairButton.addEventListener('click', () => { void pair(); });
  toggleButton.addEventListener('click', () => { void toggleLights(); });
  syncButton.addEventListener('click', () => { void toggleSceneSync(); });

  return {
    loadSettings,
    syncControls,
    applyComposition: applyComp,
    destroy() {
      bridgeIpInput.removeEventListener('input', onBridgeInput);
      // Button listeners are cleaned up when DOM is cleared
    },
  };
}
