/**
 * Multi-system helpers for the frame.
 *
 * One account → many physical rigs (systems), each with its own calibration doc
 * + reserved-tag controls. The CURRENT system is chosen per-frame-instance and
 * persisted in localStorage keyed by the account url — so two windows on the
 * same account can run two rigs simultaneously (NOT synced via the doc).
 */

import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  getRegistry,
  createDocOfDatatype2,
} from "@inkandswitch/patchwork-plugins";
import {
  defaultControls,
  CALIBRATION_DATATYPE_ID,
  type PhysicalFrameConfig,
  type PhysicalSystem,
} from "./folder-datatype";

const LS_PREFIX = "physical-frame-system:";

export function loadCurrentSystemId(accountUrl: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + accountUrl);
  } catch {
    return null;
  }
}

export function saveCurrentSystemId(accountUrl: string, systemId: string): void {
  try {
    localStorage.setItem(LS_PREFIX + accountUrl, systemId);
  } catch {
    /* storage unavailable; in-memory selection still works for the session */
  }
}

// Chosen calibration plugin id — per-frame-instance (local preference, not synced),
// keyed by account + system so different rigs can prefer different plugins.
const CAL_PLUGIN_PREFIX = "physical-frame-calplugin:";

export function loadCalibrationPluginId(
  accountUrl: string,
  systemId: string,
): string | null {
  try {
    return localStorage.getItem(`${CAL_PLUGIN_PREFIX}${accountUrl}:${systemId}`);
  } catch {
    return null;
  }
}

export function saveCalibrationPluginId(
  accountUrl: string,
  systemId: string,
  pluginId: string,
): void {
  try {
    localStorage.setItem(
      `${CAL_PLUGIN_PREFIX}${accountUrl}:${systemId}`,
      pluginId,
    );
  } catch {
    /* storage unavailable */
  }
}

/** Deterministic-ish id without Math.random (avoids harness restrictions). */
function newSystemId(config: PhysicalFrameConfig): string {
  let n = Object.keys(config.systems ?? {}).length + 1;
  let id = `system-${n}`;
  while (config.systems?.[id]) id = `system-${++n}`;
  return id;
}

/**
 * Create a new system: a fresh calibration doc + default controls, stored in the
 * config under a new id. Returns the new system id.
 */
export async function addSystem(
  configHandle: DocHandle<PhysicalFrameConfig>,
  repo: Repo,
  name: string,
): Promise<string> {
  const datatype = await getRegistry("patchwork:datatype").loadWhenReady(
    CALIBRATION_DATATYPE_ID,
  );
  const calHandle = await createDocOfDatatype2(datatype as never, repo);
  const id = newSystemId(configHandle.doc() as PhysicalFrameConfig);
  configHandle.change((d) => {
    if (!d.systems) d.systems = {};
    d.systems[id] = {
      name: name || id,
      calibrationUrl: calHandle.url as AutomergeUrl,
      controls: defaultControls(),
    };
  });
  return id;
}

/** The current system (by id), or null if none/unknown. */
export function currentSystem(
  config: PhysicalFrameConfig | undefined,
  systemId: string | null,
): PhysicalSystem | null {
  if (!config || !systemId) return null;
  return config.systems?.[systemId] ?? null;
}

/** First system id in the config (stable order), or null if none. */
export function firstSystemId(config: PhysicalFrameConfig | undefined): string | null {
  const ids = Object.keys(config?.systems ?? {});
  return ids.length ? ids.sort()[0] : null;
}
