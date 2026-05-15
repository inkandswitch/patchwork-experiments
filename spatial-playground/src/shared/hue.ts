export type HuePairSuccess = {
  success: { username: string };
};

export type HueErrorResponse = {
  error: { type: number; address: string; description: string };
};

export type HueApiResponse = HuePairSuccess | HueErrorResponse;

export type HueDiscoveryBridge = {
  id: string;
  internalipaddress: string;
};

export type HueAction = {
  on?: boolean;
  hue?: number;
  sat?: number;
  bri?: number;
  transitiontime?: number;
};

export function isHuePairSuccess(response: HueApiResponse): response is HuePairSuccess {
  return 'success' in response && typeof response.success.username === 'string';
}

export function isHueErrorResponse(response: HueApiResponse): response is HueErrorResponse {
  return 'error' in response && typeof response.error.description === 'string';
}

export function hueToHueBridge(hue: number) {
  return Math.round((((hue % 360) + 360) % 360) / 360 * 65_535);
}

export function percentToHueSat(saturation: number) {
  return Math.round(clamp(saturation, 0, 100) / 100 * 254);
}

export function percentToHueBrightness(lightness: number) {
  return Math.round(clamp(lightness, 0, 100) / 100 * 254);
}

export async function findHueBridgeIp(): Promise<string | null> {
  const response = await fetch('https://discovery.meethue.com/');
  const bridges = (await response.json()) as HueDiscoveryBridge[];
  const bridge = bridges.find((b) => b.internalipaddress);
  return bridge?.internalipaddress ?? null;
}

export async function pairHue(bridgeIp: string, deviceType: string): Promise<string | null> {
  const response = await fetch(`http://${bridgeIp}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devicetype: deviceType }),
  });
  const result = (await response.json()) as HueApiResponse[];
  const success = result.find(isHuePairSuccess);
  return success ? success.success.username : null;
}

export async function sendHueAction(bridgeIp: string, username: string, action: HueAction) {
  const response = await fetch(`http://${bridgeIp}/api/${username}/groups/0/action`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const result = (await response.json()) as HueApiResponse[];
  const error = result.find(isHueErrorResponse);
  if (error) {
    throw new Error(error.error.description);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
