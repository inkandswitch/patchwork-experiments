module.exports = function loadImplementations(files) {
  const implementations = Object.create(null);
  for (const file of files) {
    const factoryTable = require(file);
    if (!factoryTable || typeof factoryTable !== 'object' || Array.isArray(factoryTable))
      throw Error('A simulation worker module must export a system factory table');
    for (const [kind, factory] of Object.entries(factoryTable)) {
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(kind) ||
          ['__proto__', 'constructor', 'prototype'].includes(kind) ||
          typeof factory !== 'function' || Object.hasOwn(implementations, kind))
        throw Error('Invalid or duplicate simulation worker factory ' + kind);
      implementations[kind] = factory;
    }
  }
  return Object.freeze(implementations);
};
