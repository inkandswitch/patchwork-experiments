import {
  findHueBridgeIp,
  pairHue,
  sendHueAction,
  type HueAction,
} from './hue.ts';

export type HueBridgeConfig = {
  bridgeIp: string;
  username: string;
  lightsOn: boolean;
};

export function createHueBridgeManager(opts: {
  handle: any;
  configKey: string;
  deviceType: string;
  bridgeIpInput: HTMLInputElement;
  findButton: HTMLButtonElement;
  pairButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  statusText: HTMLElement;
}): {
  loadSettings(): void;
  syncControls(message?: string): void;
  isLightsOn(): boolean;
  setLightsOn(on: boolean): void;
  getUsername(): string;
  getBridgeIp(): string;
  sendAction(action: HueAction): Promise<void>;
  destroy(): void;
} {
  const { handle, configKey, deviceType, bridgeIpInput, findButton, pairButton, toggleButton, statusText } = opts;

  let hueUsername = '';
  let huePairedBridgeIp = '';
  let hueLightsOn = false;
  let hueBusy = false;

  function getBridgeIp() {
    return bridgeIpInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  function loadSettings() {
    try {
      const doc = handle.doc();
      const settings = doc?.[configKey] as HueBridgeConfig | null | undefined;
      if (settings) {
        bridgeIpInput.value = settings.bridgeIp ?? '';
        hueUsername = settings.username ?? '';
        huePairedBridgeIp = settings.bridgeIp ?? '';
        hueLightsOn = Boolean(settings.lightsOn);
      } else {
        bridgeIpInput.value = '';
        hueUsername = '';
        huePairedBridgeIp = '';
        hueLightsOn = false;
      }
    } catch {
      bridgeIpInput.value = '';
      hueUsername = '';
      huePairedBridgeIp = '';
      hueLightsOn = false;
    }
  }

  function saveSettings() {
    const bridgeIp = getBridgeIp();
    handle.change((doc: any) => {
      if (bridgeIp && hueUsername) {
        doc[configKey] = {
          bridgeIp,
          username: hueUsername,
          lightsOn: hueLightsOn,
        };
      } else {
        doc[configKey] = null;
      }
    });
  }

  function syncControls(message?: string) {
    const bridgeIp = getBridgeIp();
    findButton.disabled = hueBusy;
    pairButton.disabled = hueBusy || !bridgeIp;
    toggleButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    toggleButton.textContent = hueLightsOn ? 'Turn Lights Off' : 'Turn Lights On';

    if (message) {
      statusText.textContent = message;
    } else if (!bridgeIp) {
      statusText.textContent = 'Enter the Hue Bridge IP, or use Find Bridge.';
    } else if (!hueUsername) {
      statusText.textContent = 'Press the physical Hue Bridge button, then click Pair.';
    } else {
      statusText.textContent = `Paired with ${bridgeIp}. Toggle lights or use tool-specific controls.`;
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
      if (getBridgeIp() !== huePairedBridgeIp) {
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
    const bridgeIp = getBridgeIp();
    if (!bridgeIp) {
      syncControls('Enter the Hue Bridge IP first.');
      return;
    }

    hueBusy = true;
    syncControls('Pairing... press the bridge button if this fails.');
    let statusMessage = '';

    try {
      const username = await pairHue(bridgeIp, deviceType);
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
    const bridgeIp = getBridgeIp();
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

  async function doSendAction(action: HueAction) {
    const bridgeIp = getBridgeIp();
    if (!bridgeIp || !hueUsername) return;

    await sendHueAction(bridgeIp, hueUsername, action);

    if (action.on !== undefined) {
      hueLightsOn = action.on;
      saveSettings();
    }
  }

  function onBridgeInput() {
    if (getBridgeIp() !== huePairedBridgeIp) {
      hueUsername = '';
    }
    saveSettings();
    syncControls();
  }

  // Wire event listeners
  bridgeIpInput.addEventListener('input', onBridgeInput);
  findButton.addEventListener('click', () => { void findBridge(); });
  pairButton.addEventListener('click', () => { void pair(); });
  toggleButton.addEventListener('click', () => { void toggleLights(); });

  return {
    loadSettings,
    syncControls,
    isLightsOn: () => hueLightsOn,
    setLightsOn(on: boolean) {
      hueLightsOn = on;
      saveSettings();
    },
    getUsername: () => hueUsername,
    getBridgeIp,
    sendAction: doSendAction,
    destroy() {
      bridgeIpInput.removeEventListener('input', onBridgeInput);
    },
  };
}
