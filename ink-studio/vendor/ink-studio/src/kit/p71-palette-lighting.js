/* Suggest and approve material lighting ramps using only existing palette slots. */
(function (K) {
  const color = K.procedural.materials.perceptual;
  const format = 'ink-studio/lighting-ramp-draft', version = 1;
  const diffuse = ['shadow','bounce','half-shade','base','highlight'];
  const tones = Object.freeze([...diffuse,'neutralizer']);
  const presets = {
    cloth: {levels:[.54,.68,.85,.40], chroma:[.82,.70,.96,.65], positions:[0,.20,.47,.74,1]},
    iron:  {levels:[.43,.62,.80,.76], chroma:[.62,.60,.76,.40], positions:[0,.15,.38,.70,1]},
    stone: {levels:[.50,.66,.84,.48], chroma:[.77,.63,.89,.59], positions:[0,.23,.49,.73,1]},
    skin:  {levels:[.61,.73,.88,.38], chroma:[1.10,.95,1.04,.68], positions:[0,.21,.49,.75,1]}
  };
  const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
  const name = value=>typeof value === 'string' && value.trim() && value.length<=128 &&
    !['__proto__','prototype','constructor'].includes(value);
  const hex = n=>'#'+n.toString(16).padStart(6,'0');
  const inRange = (n,len)=>Number.isInteger(n) && n>=0 && n<len;
  const mix = (a,b,t)=>a+(b-a)*t;
  const distance = (a,b)=>2*(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;

  function readPalette(values) {
    if (!Array.isArray(values) || !values.length || values.length>48)
      throw new RangeError('Lighting ramps need 1–48 source swatches');
    return Array.from(values,value=>{
      const rgb = color.parse(value);
      if (!Array.from(rgb).every(Number.isFinite)) throw new TypeError('Lighting ramp swatches need finite RGB');
      return color.toHex(rgb);
    });
  }

  function readRoles(roles,len) {
    if (!record(roles)) throw new TypeError('Existing palette roles must be named');
    return Object.fromEntries(Object.entries(roles).map(([key,indices])=>{
      if (!name(key) || !Array.isArray(indices) || !indices.length || !Array.from(indices).every(n=>inRange(n,len)))
        throw new RangeError('Existing palette role ' + key + ' needs valid palette indices');
      return [key,indices.slice()];
    }));
  }

  function target(value,lab) {
    if (Number.isInteger(value)) {
      if (!inRange(value,lab.length)) throw new RangeError('Lighting ramp hint is outside the palette');
      return lab[value];
    }
    const rgb = color.parse(value);
    if (!Array.from(rgb).every(Number.isFinite)) throw new TypeError('Lighting ramp hints need finite RGB');
    return color.lab(rgb);
  }

  function nearest(candidates,score) {
    let best = candidates[0], error = Infinity;
    for (const slot of candidates) {
      const value = score(slot);
      if (value < error) { best = slot; error = value; }
    }
    return best;
  }

  // Choose the stops together so a close color match cannot invert the lighting ramp.
  function orderedRamp(lab,candidates,wanted,base) {
    const sorted = candidates.slice().sort((a,b)=>lab[a][0]-lab[b][0] || a-b);
    let prior = sorted.map(slot=>({slot,error:distance(lab[slot],wanted[0]),chain:[slot]}));
    for (let i=1;i<wanted.length;i++) {
      prior = sorted.map((slot,j)=>{
        if (i===3 && slot!==base) return null;
        let best, error = Infinity;
        for (let k=0;k<=j;k++) {
          if (!prior[k]) continue;
          const cost = prior[k].error + (prior[k].slot===slot ? .006 : 0);
          if (cost<error) { best = prior[k]; error = cost; }
        }
        if (!best) return null;
        return {slot,error:error+distance(lab[slot],wanted[i]),chain:[...best.chain,slot]};
      });
    }
    const choices = prior.filter(Boolean);
    return nearest(choices,row=>row.error).chain;
  }

  function suggest(definition) {
    if (!fields(definition,['palette','roles','materials']) || !record(definition.materials) ||
        !Object.keys(definition.materials).length || Object.keys(definition.materials).length>32)
      throw new TypeError('Lighting ramps need a palette and 1–32 named materials');
    const palette = readPalette(definition.palette), roles = readRoles(definition.roles ?? {},palette.length);
    const lab = palette.map(n=>color.lab(color.parse(n)));
    const ramps = Object.fromEntries(Object.entries(definition.materials).map(([role,settings])=>{
      if (!name(role) || !fields(settings,['base','preset','bounce','candidates']) || settings.base===undefined)
        throw new TypeError('Lighting material ' + role + ' needs a base color and optional preset, bounce or candidates');
      const preset = settings.preset ?? (Object.hasOwn(presets,role) ? role : 'stone');
      if (typeof preset !== 'string' || !Object.hasOwn(presets,preset)) throw new RangeError('Lighting preset must be cloth, iron, stone or skin');
      const source = settings.candidates ?? palette.map((_,i)=>i);
      if (!Array.isArray(source) || !source.length || !Array.from(source).every(n=>inRange(n,palette.length)))
        throw new RangeError('Lighting candidates must be nonempty source palette indices');
      const candidates = [...new Set(source)].sort((a,b)=>a-b), wantedBase = target(settings.base,lab);
      const base = Number.isInteger(settings.base) ? settings.base : nearest(candidates,i=>distance(lab[i],wantedBase));
      if (!candidates.includes(base)) throw new RangeError(role + ' base must be in its candidates');
      const [L,a,b] = lab[base], {levels,chroma,positions} = presets[preset];
      const bounce = settings.bounce === undefined ? [L,a*.74,b*.74+.018] : target(settings.bounce,lab);
      const wanted = [
        [L*levels[0],a*chroma[0],b*chroma[0]],
        [L*levels[1],mix(a*chroma[1],bounce[1],.58),mix(b*chroma[1],bounce[2],.58)],
        [L*levels[2],a*chroma[2],b*chroma[2]],
        lab[base],
        [mix(L,1,levels[3]),a*chroma[3],b*chroma[3]]
      ];
      const selected = orderedRamp(lab,candidates,wanted,base);
      const neutralizer = nearest(candidates,i=>.6*(L-lab[i][0])**2 + 4*(lab[i][1]**2+lab[i][2]**2));
      const swatches = Object.fromEntries(tones.map((tone,i)=>[tone,i<selected.length ? selected[i] : neutralizer]));
      return [role,{swatches,positions:positions.slice(),interpolation:'smooth'}];
    }));
    return {format,version,palette:palette.map(hex),roles,ramps};
  }

  function approve(draft) {
    if (!fields(draft,['format','version','palette','roles','ramps']) || draft.format!==format || draft.version!==version ||
        !record(draft.ramps) || !Object.keys(draft.ramps).length || Object.keys(draft.ramps).length>32)
      throw new TypeError('Approval needs a version 1 lighting ramp draft');
    const palette = readPalette(draft.palette), roles = readRoles(draft.roles ?? {},palette.length), added = new Set();
    const save = (role,indices) => {
      if (added.has(role)) throw new RangeError('Lighting ramp role names overlap at ' + role);
      added.add(role);
      roles[role] = indices;
    };
    const ramps = Object.fromEntries(Object.entries(draft.ramps).map(([role,settings])=>{
      if (!name(role) || !fields(settings,['swatches','positions','interpolation']) ||
          !fields(settings.swatches,tones) || !tones.every(tone=>inRange(settings.swatches[tone],palette.length)))
        throw new TypeError('Lighting draft ' + role + ' needs all six named swatch indices');
      const { swatches, positions, interpolation = 'smooth' } = settings;
      if (!Array.isArray(positions) || positions.length!==diffuse.length ||
          !Array.from(positions).every((n,i)=>Number.isFinite(n) && n>=0 && n<=1 && (!i || n>positions[i-1])) ||
          !ColorCurves.modes.includes(interpolation))
        throw new RangeError('Lighting draft ' + role + ' needs five increasing positions and a valid interpolation');
      save(role,diffuse.map(tone=>swatches[tone]));
      for (const tone of tones) save(role+'.'+tone,[swatches[tone]]);
      return [role,{role,positions:positions.slice(),interpolation}];
    }));
    return {palette,roles,ramps};
  }

  K.procedural.materials.lightingRamps = Object.freeze({suggest,approve,tones});
})(KIT);
