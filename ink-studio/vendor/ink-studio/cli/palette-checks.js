const TargetSelectors = require('../src/target-selectors.js');
const { prepareReview, captureReview, measure, sheet, edgeLegend } = require('./readability-review.js');

const swatchLimits = { minPixels:['pixels','min',1], minShare:['share','min',1] };
const contourLimits = {
  minSamples:['samples','min',1], minPixels:['pixels','min',1],
  minColorP10:['colorP10','min'], minLightnessP10:['lightnessP10','min'],
  maxWeakColorShare:['weakColorShare','max'], maxWeakLightnessShare:['weakLightnessShare','max'],
  maxCroppedEdges:['croppedEdges','max']
};
const countLimits = new Set(['minPixels','minSamples','maxCroppedEdges']);
const swatchLegend = [['Exact swatch','#72d5a1'],['Wrong swatch','#ff8fe2']];
const swatchMarks = swatchLegend.map(([,hex])=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
const record = value => value && Object.getPrototypeOf(value)===Object.prototype;

function scope(value, available, id) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length ||
      !Array.from(value).every(name=>available.has(name)))
    throw new TypeError('Check '+id+' needs distinct known view or state names');
}

function prepareChecks(input,{subjects,views,states,thresholds}) {
  if (!Array.isArray(input) || !input.length || input.length>32)
    throw new RangeError('A palette check plan needs 1–32 checks');
  const ids=new Set(), viewIds=new Set(views.map(row=>row.id)), stateIds=new Set(states.map(row=>row.id));
  return Array.from(input,check=>{
    if (!record(check)) throw new TypeError('Each palette check needs a named definition');
    const {id,type,subject,views,states,swatch,...overrides}=check;
    if (!TargetSelectors.name(id) || id.length>64 || ids.has(id)) throw new TypeError('Palette checks need distinct IDs');
    ids.add(id);
    const index=subjects.findIndex(row=>row.id===subject);
    if (index<0) throw new TypeError('Check '+id+' needs a known subject');
    scope(views,viewIds,id);
    scope(states,stateIds,id);
    if (type!=='swatch' && type!=='readability') throw new TypeError('Check '+id+' needs type swatch or readability');
    if (type==='swatch' ? typeof swatch!=='string' || !/^#[0-9a-f]{6}$/i.test(swatch) : swatch!==undefined)
      throw new TypeError('Only swatch checks take an exact #rrggbb swatch');
    const fields=type==='swatch' ? swatchLimits : contourLimits;
    for (const [key,value] of Object.entries(overrides)) {
      const valid=Object.hasOwn(fields,key) &&
        (countLimits.has(key) ? Number.isSafeInteger(value) && value>=(key==='maxCroppedEdges' ? 0 : 1) :
          Number.isFinite(value) && value>=0 && value<=1);
      if (!valid) throw new RangeError('Invalid '+key+' for check '+id);
    }
    const limits=Object.fromEntries(Object.entries(fields).filter(([,row])=>row[2]!==undefined)
      .map(([key,row])=>[key,row[2]]));
    if (type==='readability' && !['minColorP10','minLightnessP10','maxWeakColorShare','maxWeakLightnessShare']
      .some(key=>Object.hasOwn(overrides,key))) {
      limits.maxWeakColorShare=thresholds.weakShare;
      limits.maxWeakLightnessShare=thresholds.weakShare;
    }
    const definition={id,type,subject,...(views && {views}),...(states && {states}),...(swatch && {swatch:swatch.toLowerCase()}),
      limits:{...limits,...overrides}};
    return {definition,index,expected:swatch && parseInt(swatch.slice(1),16),fields};
  });
}

function countSwatch(frame,index,expected,marks) {
  const {w,rgb,alpha,readabilityMask}=frame, bit=1<<index;
  let pixels=0, exactPixels=0;
  let firstMismatch=null;
  for (let p=0;p<readabilityMask.length;p++) {
    if (!(readabilityMask[p]&bit) || alpha?.[p]===0) continue;
    const q=p*3, color=rgb[q]*65536+rgb[q+1]*256+rgb[q+2], exact=color===expected;
    if (!exact && !firstMismatch)
      firstMismatch={x:p%w,y:Math.floor(p/w),swatch:'#'+color.toString(16).padStart(6,'0')};
    pixels++;
    exactPixels+=Number(exact);
    marks[p]=Math.max(marks[p],exact ? 1 : 2);
  }
  return {pixels,exactPixels,share:pixels ? exactPixels/pixels : null,firstMismatch};
}

function contour(row) {
  const {pixels,samples,croppedEdges,occludedEdges,transparentEdges,color,lightness,weakColorShare,weakLightnessShare,
    worstColor,worstLightness}=row;
  return {pixels,samples,croppedEdges,occludedEdges,transparentEdges,colorP10:color?.p10??null,
    lightnessP10:lightness?.p10??null,weakColorShare,weakLightnessShare,worstColor,worstLightness};
}

function result({definition,fields}, metrics) {
  const failures=[];
  for (const [name,limit] of Object.entries(definition.limits)) {
    const [metric,comparison]=fields[name], actual=metrics[metric];
    if (actual===null || (comparison==='min' ? actual<limit : actual>limit))
      failures.push({metric,comparison,limit,actual});
  }
  return {id:definition.id,passed:failures.length===0,metrics,failures};
}

function checkPaletteShot(world,options={}) {
  const {plan,view={}}=options;
  if (!record(plan)) throw new TypeError('Palette checks need a plan');
  if (view.raw) throw new RangeError('Palette checks need a palette-enabled render');
  const {checks:input,...review}=plan;
  const prepared=prepareReview(review,view.time??view.t??world.lookSnapshot?.time??0);
  const checks=prepareChecks(input,prepared);
  const {kit,tiles,layout,columns,frame,samples}=captureReview(world,prepared,options,
    (raw,subjects,thresholds,matte,_kit,sample)=>{
      const active=checks.filter(({definition})=>(!definition.views || definition.views.includes(sample.view)) &&
        (!definition.states || definition.states.includes(sample.state)));
      const indices=[...new Set(active.filter(row=>row.definition.type==='readability').map(row=>row.index))];
      const {frame,marked,subjects:measured}=measure(raw,subjects,thresholds,matte,indices);
      const contours=new Map(indices.map((index,i)=>[index,contour(measured[i])]));
      const hasSwatches=active.some(row=>row.definition.type==='swatch');
      const marks=hasSwatches && new Uint8Array(raw.w*raw.h);
      const results=active.map(check=>result(check,check.definition.type==='swatch' ?
        countSwatch(raw,check.index,check.expected,marks) : contours.get(check.index)));
      if (marks) for (let p=0;p<marks.length;p++) if (marks[p]) marked.rgb.set(swatchMarks[marks[p]-1],p*3);
      const findings=results.filter(row=>!row.passed).map(row=>row.id);
      return {frame,marked,results,findings,status:findings.length ? findings.length+' failed' : results.length ? 'Pass' : 'No checks'};
    });
  const byId=new Map(checks.map(({definition})=>[definition.id,{...definition,passed:true,evaluations:0,failed:0}]));
  for (const sample of samples) for (const result of sample.results) {
    const check=byId.get(result.id);
    check.evaluations++;
    if (!result.passed) { check.failed++; check.passed=false; }
  }
  const summaries=[...byId.values()], failed=summaries.filter(check=>!check.passed).length, passed=summaries.length-failed;
  const {subjects,views,states,thresholds,matte}=prepared;
  const legend=[...(checks.some(row=>row.definition.type==='readability') ? edgeLegend : []),
    ...(checks.some(row=>row.definition.type==='swatch') ? swatchLegend : [])];
  const image=sheet(kit,tiles,layout,columns,{title:'Palette checks',subtitle:passed+' passed   '+failed+' failed',legend});
  return {image,report:{format:'ink-studio/palette-checks',version:1,scene:world.id??null,...frame,
    passed:failed===0,summary:{passed,failed},subjects,views,states,thresholds,...(matte && {matte}),
    checks:summaries,samples,legend:Object.fromEntries(legend)}};
}

module.exports = { checkPaletteShot };
