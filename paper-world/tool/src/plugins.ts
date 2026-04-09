import type { Subscribable } from "./subscribable";
import type { Filesystem } from "./filesystem";

export type Plugin = {
  type: string;
  name: string;
  description: string;
  source: string;
  folder: string;
  [key: string]: unknown;
};

export type PluginRegistry = {
  all(): Subscribable<Plugin[]>;
  byType(type: string): Subscribable<Plugin[]>;
};

type PluginEntry = {
  type?: string;
  name?: string;
  description?: string;
  toolUrl?: string;
  schemaUrl?: string;
  source?: string;
  [key: string]: unknown;
};

type PackageJson = {
  exports?: Record<string, string>;
};

export function createPluginRegistry(filesystem: Filesystem): PluginRegistry {
  let current: Plugin[] = [];
  const listeners = new Set<(plugins: Plugin[]) => void>();
  const typeViews = new Map<string, TypeView>();

  filesystem.watch("**/package.json", (matches) => {
    void loadPlugins(matches);
  });

  async function loadPlugins(matches: string[]): Promise<void> {
    try {
      const next = await parsePackageFiles(filesystem, matches);
      if (!pluginsEqual(current, next)) {
        current = next;
        notify();
      }
    } catch {
      // read failures are silent; next change will retry
    }
  }

  function notify(): void {
    for (const fn of listeners) fn(current);
    for (const view of typeViews.values()) view.notify();
  }

  function allSubscribable(): Subscribable<Plugin[]> {
    return {
      value() {
        return current;
      },
      subscribe(fn: (value: Plugin[]) => void): () => void {
        fn(current);
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    };
  }

  function byTypeSubscribable(type: string): Subscribable<Plugin[]> {
    let existing = typeViews.get(type);
    if (existing) return existing;
    existing = new TypeView(type);
    typeViews.set(type, existing);
    return existing;
  }

  class TypeView implements Subscribable<Plugin[]> {
    #type: string;
    #listeners = new Set<(value: Plugin[]) => void>();

    constructor(type: string) {
      this.#type = type;
    }

    value(): Plugin[] {
      return current.filter((p) => p.type === this.#type);
    }

    subscribe(fn: (value: Plugin[]) => void): () => void {
      fn(this.value());
      this.#listeners.add(fn);
      return () => {
        this.#listeners.delete(fn);
      };
    }

    notify(): void {
      const filtered = this.value();
      for (const fn of this.#listeners) fn(filtered);
    }
  }

  return {
    all: allSubscribable,
    byType: byTypeSubscribable,
  };
}

async function parsePackageFiles(
  filesystem: Filesystem,
  matches: string[],
): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const match of matches) {
    const folderPath = match.replace(/\/package\.json$/, "").replace(/^package\.json$/, "");
    try {
      const raw = await filesystem.readFile(match);
      const parsed: PackageJson = JSON.parse(raw);
      if (!parsed.exports || typeof parsed.exports !== "object") continue;
      for (const [key, target] of Object.entries(parsed.exports)) {
        if (!key.endsWith(".json") || !target.endsWith(".json")) continue;
        const jsonPath = folderPath ? `${folderPath}/${target.replace(/^\.\//, "")}` : target.replace(/^\.\//, "");
        await loadPluginJson(filesystem, plugins, folderPath, jsonPath);
      }
    } catch {
      // skip unreadable package.json files
    }
  }
  return plugins;
}

async function loadPluginJson(
  filesystem: Filesystem,
  plugins: Plugin[],
  folderPath: string,
  jsonPath: string,
): Promise<void> {
  try {
    const raw = await filesystem.readFile(jsonPath);
    const entry: PluginEntry = JSON.parse(raw);
    const entrySource = entry.toolUrl ?? entry.source;
    if (!entry.type || !entry.name || !entrySource) return;
    const sourcePath = folderPath ? `${folderPath}/${entrySource}` : entrySource;
    const { type, name, description, toolUrl, schemaUrl, source, ...metadata } = entry;
    const resolvedSchemaUrl = schemaUrl
      ? filesystem.getUrlOfFile(folderPath ? `${folderPath}/${schemaUrl}` : schemaUrl)
      : undefined;
    plugins.push({
      type,
      name,
      description: description ?? "",
      source: filesystem.getUrlOfFile(sourcePath),
      folder: folderPath,
      ...(resolvedSchemaUrl ? { schemaUrl: resolvedSchemaUrl } : {}),
      ...metadata,
    });
  } catch {
    // skip unreadable plugin JSON files
  }
}

function pluginsEqual(a: Plugin[], b: Plugin[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].source !== b[i].source || a[i].name !== b[i].name || a[i].type !== b[i].type) {
      return false;
    }
  }
  return true;
}
