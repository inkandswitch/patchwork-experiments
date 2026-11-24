/* Measure authored stop spacing and compare it with sampled output colours. */
(function (K) {
  const material = K.procedural.materials, color = material.perceptual;
  const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const unit = n=>Number.isFinite(n) && n>=0 && n<=1;

  function swatch(value) {
    const rgb = color.parse(value);
    if (!Array.from(rgb).every(unit)) throw new TypeError('Ramp review stops need finite RGB colors');
    const packed = color.toHex(rgb);
    const rendered = color.parse(packed);
    return { color:'#'+packed.toString(16).padStart(6,'0'),lightness:color.lab(rendered)[0] };
  }

  function reviewRamp(definition) {
    if (!record(definition) || Object.keys(definition).some(key=>
      !['stops','positions','direction','maxDeviation','maxGap','reversalTolerance','resolved'].includes(key)))
      throw new TypeError('Ramp review needs ordered stops and optional spacing settings');
    const { stops, positions, direction='auto', maxDeviation=.035,maxGap=.22,reversalTolerance=.005,resolved } = definition;
    if (!Array.isArray(stops) || stops.length<1 || stops.length>256 ||
        !['auto','ascending','descending'].includes(direction) ||
        ![maxDeviation,maxGap,reversalTolerance].every(unit))
      throw new RangeError('Use 1–256 ramp stops, a valid direction, and thresholds in [0, 1]');
    const count=stops.length;
    const pair = value=>Array.isArray(value) && value.length===2;
    const positioned = stops.some(pair);
    if (positioned && (positions!==undefined || !Array.from(stops).every(pair)))
      throw new TypeError('Use ordered colors with positions or [position, color] stops');
    const at = positioned ? stops.map(stop=>stop[0]) : positions;
    if (at!==undefined && (!Array.isArray(at) || at.length!==count ||
        !Array.from(at).every((value,i)=>unit(value) && (!i || value>at[i-1]))))
      throw new RangeError('Ramp positions must increase in [0, 1] with one position per stop');
    if (resolved!==undefined && (!Array.isArray(resolved) || resolved.length!==count))
      throw new TypeError('Supply one resolved color or null per ramp stop');
    const rows=Array.from(stops,(value,index)=>{
      const output=resolved && resolved[index]!==null ? swatch(resolved[index]) : null;
      return { index, position:at?.[index] ?? index/Math.max(1,count-1), ...swatch(positioned ? value[1] : value),
        ...(resolved && {resolved:output?.color ?? null,resolvedLightness:output?.lightness ?? null}) };
    });
    const first=rows[0], last=rows.at(-1), span=last.lightness-first.lightness;
    const departure=rows.find(row=>Math.abs(row.lightness-first.lightness)>reversalTolerance);
    const inferred=Math.abs(span)>reversalTolerance ? span : (departure?.lightness ?? first.lightness)-first.lightness;
    const slope=direction==='auto' ? inferred : direction==='ascending' ? 1 : -1;
    const sign = slope>0 ? 1 : slope<0 ? -1 : 0;
    const steps=[], flags=[];
    for (let i=1;i<count;i++) {
      const a=rows[i-1], b=rows[i], indices=[a.index,b.index];
      const delta=b.lightness-a.lightness;
      const expected=sign*Math.abs(span)*(b.position-a.position)/(last.position-first.position);
      const deviation=Math.abs(delta-expected);
      steps.push({indices,delta,expected,deviation,...(a.resolved && b.resolved &&
        {resolvedDelta:b.resolvedLightness-a.resolvedLightness})});
      if (sign && delta*sign < -reversalTolerance) flags.push({kind:'reversal',indices,delta});
      else if (deviation>maxDeviation) flags.push({kind:'uneven-step',indices,delta,expected,deviation});
      if (a.color===b.color) flags.push({kind:'duplicate-stop',indices,color:a.color});
      if (a.resolved && a.resolved===b.resolved)
        flags.push({kind:'resolved-collapse',indices,color:a.resolved,authoredDuplicate:a.color===b.color});
    }
    // Read gaps across the available lightness levels, even if authoring order reverses.
    const sorted=rows.slice().sort((a,b)=>a.lightness-b.lightness || a.index-b.index);
    for (let i=1;i<sorted.length;i++) {
      const a=sorted[i-1], b=sorted[i], gap=b.lightness-a.lightness;
      if (gap>maxGap) flags.push({kind:'missing-midtones',indices:[a.index,b.index],gap,
        lightness:[a.lightness,b.lightness],midpoint:(a.lightness+b.lightness)*.5});
    }
    return K.procedural.data.freeze({
      direction:sign>0 ? 'ascending' : sign<0 ? 'descending' : 'flat',
      thresholds:{maxDeviation,maxGap,reversalTolerance},stops:rows,steps,flags
    });
  }

  material.reviewRamp = reviewRamp;
})(KIT);
