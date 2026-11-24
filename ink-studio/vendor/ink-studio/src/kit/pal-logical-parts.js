/* A manufactured part can be split by clip planes, spans, and wrapped seams. */
(function (K) {
  const P = K.procedural || K.authoring;
  const empty = Object.freeze([]);
  const validKey = key => typeof key === 'string' && key.length > 0;

  function compile(parts, identify) {
    if (!Array.isArray(parts) || parts.length > 65536 || typeof identify !== 'function')
      throw Error('Logical parts need a bounded list of pieces and a key function');
    const byKey = new Map(), pieces = parts.slice();
    const keys = pieces.map((part, index) => {
      const key = identify(part, index);
      if (key == null) return null;
      if (!validKey(key)) throw Error('Part keys must be nonempty strings');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(part);
      return key;
    });
    const groups = Object.freeze([...byKey].map(([key, fragments]) =>
      Object.freeze({ key, fragments: Object.freeze(fragments) })));

    function partition(hidden = []) {
      if ((!Array.isArray(hidden) && !(hidden instanceof Set)) || (hidden.length ?? hidden.size) > 65536)
        throw Error('Part exclusions need a bounded list of keys');
      const omit = new Set(hidden);
      for (const key of omit) if (!validKey(key)) throw Error('Part exclusions need nonempty keys');
      const visible = [], omitted = [];
      for (let i = 0; i < pieces.length; i++)
        (omit.has(keys[i]) ? omitted : visible).push(pieces[i]);
      return { visible, omitted };
    }

    return Object.freeze({ groups, get: key => byKey.get(key) || empty, partition });
  }

  function validSite(site) {
    return Array.isArray(site) && site.length === 2 && Number.isFinite(site[0]) && Number.isFinite(site[1]);
  }

  // The caller owns the chart and resolves each retained point in its current layout.
  function edits(keys = [], anchors = [], locate) {
    if (!Array.isArray(keys) || !Array.isArray(anchors) || keys.length + anchors.length > 65536 ||
        !keys.every(validKey) || typeof locate !== 'function')
      throw Error('Part edits need bounded keys and a chart lookup');
    const original = new Set(keys), referenced = new Set(), records = [], excluded = new Set();
    for (const record of anchors) {
      if (!record || !validKey(record.key) || !validSite(record.site))
        throw Error('Part edit anchors need a retained key and a finite chart point');
      if (!original.has(record.key)) continue;
      const site = Object.freeze(record.site.slice()), key = locate(site, record.key);
      if (key != null && !validKey(key)) throw Error('Invalid resolved part key');
      referenced.add(record.key);
      records.push({ key: record.key, site, resolved: key });
      if (key != null) excluded.add(key);
    }
    const legacy = keys.filter(key => !referenced.has(key));
    for (const key of legacy) excluded.add(key);

    function setVisible(key, visible, site) {
      if (!validKey(key) || typeof visible !== 'boolean' || !visible && !validSite(site))
        throw Error('Part visibility edits need a key, visibility and an erase position');
      if (excluded.has(key) === !visible) return null;
      const kept = visible ? records.filter(record => record.resolved !== key) : records.concat({ key, site });
      const next = kept.map(({key, site}) => ({ key, site: site.slice() }));
      const retained = legacy.filter(item => !visible || item !== key);
      return { keys: [...new Set([...retained, ...next.map(record => record.key)])].sort(), anchors: next };
    }
    return Object.freeze({ keys: Object.freeze([...excluded].sort()), has: key => excluded.has(key), setVisible });
  }

  function captureAnchors(keys, anchors, siteFor) {
    if(!Array.isArray(keys)||!Array.isArray(anchors)||keys.length+anchors.length>65536||
       !keys.every(validKey)||typeof siteFor!=='function')
      throw Error('Capturing part anchors needs bounded keys and a site lookup');
    const seen=new Set();
    for(const record of anchors){
      if(!record||!validKey(record.key)||!validSite(record.site))
        throw Error('Part edit anchors need a retained key and a finite chart point');
      seen.add(record.key);
    }
    let result=anchors;
    for(const key of keys){
      if(seen.has(key))continue;
      seen.add(key);
      const site=siteFor(key);
      if(site==null)continue;
      if(!validSite(site))throw Error('Part sites must be two finite coordinates');
      if(result===anchors)result=anchors.slice();
      result.push({key,site:site.slice()});
    }
    return result;
  }

  P.logicalParts = Object.freeze({ compile, edits, captureAnchors });
})(KIT);
