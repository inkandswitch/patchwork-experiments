/* Share the application factory table between the browser host and workers. */
export async function loadSimulationModules(urls) {
  const implementations = Object.create(null);
  for (const url of urls) {
    const { default: table } = await import(url);
    if (!table || typeof table !== 'object' || Array.isArray(table))
      throw Error('A simulation worker module must default-export a system factory table');
    for (const [kind, factory] of Object.entries(table)) {
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(kind) ||
          ['__proto__', 'constructor', 'prototype'].includes(kind) ||
          typeof factory !== 'function' || Object.hasOwn(implementations, kind))
        throw Error('Invalid or duplicate simulation worker factory ' + kind);
      implementations[kind] = factory;
    }
  }
  return Object.freeze(implementations);
}
