const { captureReview,prepareReview,measure,sheet,edgeLegend } = require('./readability-review.js');

const limits = Object.freeze({midtoneShareDrop:.15,midtoneSwatchLoss:.5,weakEdgeGain:.2,sameSwatchGain:.2});
const contactColor = '#ff6ec8';
const contactBytes = [255,110,200];
const hex = color => '#'+color.toString(16).padStart(6,'0');
const pack = (rgb,p) => rgb[p*3]*65536+rgb[p*3+1]*256+rgb[p*3+2];
const record = value => value && Object.getPrototypeOf(value)===Object.prototype;

function preparePairs(subjects, requested) {
  const ids = subjects.map(subject=>subject.id);
  const all = ids.flatMap((a,i)=>ids.slice(i+1).map(b=>[a,b]));
  const names = requested ?? all;
  if (!Array.isArray(names) || names.length>all.length) throw new TypeError('Choose distinct subject pairs for contact review');
  const seen = new Set();
  return Array.from(names,pair=>{
    if (!Array.isArray(pair) || pair.length!==2 || !pair.every(name=>ids.includes(name)) || pair[0]===pair[1])
      throw new TypeError('Each contact pair needs two different subject IDs');
    const [a,b]=pair.map(name=>ids.indexOf(name)), key=Math.min(a,b)*ids.length+Math.max(a,b);
    if (seen.has(key)) throw new TypeError('Contact pairs must be unique');
    seen.add(key);
    return {subjects:pair.slice(),a:1<<a,b:1<<b};
  });
}

function paletteFor(scene, frame, visible, subject, index, read, settings) {
  if (!subject.pixels) return null;
  const rgb=new Uint8Array(subject.pixels*3), alpha=scene.alpha && new Uint8Array(subject.pixels);
  const bit=1<<index;
  let q=0;
  for (let p=0;p<visible.length;p++) {
    if (!(visible[p]&bit) || frame.alpha?.[p]===0) continue;
    rgb[q*3]=scene.rgb[p*3];
    rgb[q*3+1]=scene.rgb[p*3+1];
    rgb[q*3+2]=scene.rgb[p*3+2];
    if (alpha) alpha[q]=scene.alpha[p];
    q++;
  }
  const data=read({w:subject.pixels,h:1,rgb,alpha},settings);
  if (!data.alpha.included) return null;
  return {pixels:data.alpha.included,swatches:data.sourceSwatches,tones:data.tones,brightness:data.brightness,
    hue:data.hue,saturation:data.saturation};
}

function measureContacts(scene, visible, pairs, marked) {
  const {w,h,rgb,alpha}=scene;
  const rows=pairs.map(({subjects})=>({subjects,samples:0,sameSwatch:0,sameSwatchShare:null,example:null}));
  function edge(p,q) {
    if (!visible[p] || !visible[q] || visible[p]===visible[q] ||
        alpha && (alpha[p]!==255 || alpha[q]!==255)) return;
    const left=pack(rgb,p), right=pack(rgb,q), same=left===right;
    for (const [i,{a,b}] of pairs.entries()) {
      const mask=a|b, P=visible[p]&mask, Q=visible[q]&mask;
      if (!(P===a && Q===b || P===b && Q===a)) continue;
      const row=rows[i];
      row.samples++;
      if (!same) continue;
      row.sameSwatch++;
      if (!row.example) {
        const first=P===a ? p : q, second=P===a ? q : p;
        row.example={a:[first%w,Math.floor(first/w)],b:[second%w,Math.floor(second/w)],swatch:hex(left)};
      }
      marked.rgb.set(contactBytes,p*3);
      marked.rgb.set(contactBytes,q*3);
    }
  }
  if (pairs.length) for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=y*w+x;
    if (x+1<w) edge(p,p+1);
    if (y+1<h) edge(p,p+w);
  }
  for (const row of rows) if (row.samples) row.sameSwatchShare=row.sameSwatch/row.samples;
  return rows;
}

const delta = (a,b) => a==null || b==null ? null : b-a;
const crosses = (gain, limit) => gain!=null && gain>0 && gain>=limit;

function compareSample(baseline, result, settings, weakShare) {
  const findings=[];
  for (const [i,subject] of result.subjects.entries()) {
    const source=baseline.subjects[i], a=source.palette?.tones.midtones, b=subject.palette?.tones.midtones;
    const drop=a && b && a.swatches ? (a.swatches-b.swatches)/a.swatches : null;
    const changes={midtoneShare:delta(a?.share,b?.share),midtoneSwatches:delta(a?.swatches,b?.swatches),
      midtoneSwatchLoss:drop,weakColorShare:delta(source.weakColorShare,subject.weakColorShare),
      weakLightnessShare:delta(source.weakLightnessShare,subject.weakLightnessShare),
      colorP10:delta(source.color?.p10,subject.color?.p10),lightnessP10:delta(source.lightness?.p10,subject.lightness?.p10)};
    subject.changes=changes;
    if (source.pixels && !subject.pixels) findings.push({kind:'subject-hidden',subject:subject.id,before:source.pixels,after:0});
    if (source.samples && subject.pixels && !subject.samples)
      findings.push({kind:'edge-unmeasurable',subject:subject.id,before:source.samples,after:0});
    const shareDrop=changes.midtoneShare===null ? null : -changes.midtoneShare;
    if (crosses(shareDrop,settings.midtoneShareDrop) || crosses(drop,settings.midtoneSwatchLoss))
      findings.push({kind:'midtone-loss',subject:subject.id,before:{share:a.share,swatches:a.swatches},
        after:{share:b.share,swatches:b.swatches}});
    const weakened=[['color',changes.weakColorShare,subject.weakColorShare,source.weakColorShare],
      ['lightness',changes.weakLightnessShare,subject.weakLightnessShare,source.weakLightnessShare]]
      .filter(([,gain,after])=>after>=weakShare && crosses(gain,settings.weakEdgeGain))
      .map(([metric,,after,before])=>({metric,before,after}));
    if (weakened.length) findings.push({kind:'edge-contrast-loss',subject:subject.id,metrics:weakened});
  }
  for (const [i,row] of result.contacts.entries()) {
    const prior=baseline.contacts[i];
    row.sameSwatchChange=delta(prior.sameSwatchShare,row.sameSwatchShare);
    if (crosses(row.sameSwatchChange,settings.sameSwatchGain))
      findings.push({kind:'same-swatch-contact',subjects:row.subjects,before:prior.sameSwatchShare,after:row.sameSwatchShare});
  }
  return findings;
}

function reviewPaletteWeather(world,options={}) {
  const {plan=world.paletteWeatherReview,view={}}=options;
  if (!record(plan)) throw new TypeError('Palette weather review needs a plan');
  const {baseline,pairs,palette={},limits:overrides={},...review}=plan;
  if (!record(palette) || Object.keys(palette).some(key=>!['shadow','highlight'].includes(key)) ||
      !Object.values(palette).every(n=>Number.isFinite(n) && n>=0 && n<=1) ||
      (palette.shadow??.4)>=(palette.highlight??.75))
    throw new RangeError('Palette weather needs shadow below highlight, with both in [0, 1]');
  if (!record(overrides) || Object.entries(overrides).some(([key,n])=>
    !Object.hasOwn(limits,key) || !Number.isFinite(n) || n<0 || n>1))
    throw new RangeError('Palette weather limits need a known metric and a fraction in [0, 1]');
  const settings={...limits,...overrides};
  const prepared=prepareReview(review,view.time??view.t??world.lookSnapshot?.time??0);
  const {subjects,views,states,thresholds,matte}=prepared, contacts=preparePairs(subjects,pairs);
  if (states.length<2) throw new RangeError('Palette weather review needs at least two states');
  const reference=baseline??states[0].id, baselineIndex=states.findIndex(state=>state.id===reference);
  if (baselineIndex<0) throw new RangeError('Palette weather baseline must name a review state');
  const fixedCameraAt=view.cameraTime??states[baselineIndex].time;
  const {kit,tiles,layout,columns,frame,samples}=captureReview(world,prepared,{...options,fixedCameraAt},(raw,labels,rules,matte,kit)=>{
    const result=measure(raw,labels,rules,matte);
    const {frame,marked}=result, visible=raw.readabilityMask;
    for (const [index,subject] of result.subjects.entries())
      subject.palette=paletteFor(frame,raw,visible,subject,index,kit.palette.distributions,palette);
    return {...result,contacts:measureContacts(frame,visible,contacts,marked)};
  });
  const flagCount=samples.reduce((sum,sample,i)=>{
    const source=samples[baselineIndex*views.length+i%views.length];
    sample.isBaseline=sample===source;
    sample.findings=compareSample(source,sample,settings,thresholds.weakShare);
    return sum+sample.findings.length;
  },0);
  const legend=[...edgeLegend,['Same swatch',contactColor]];
  return {image:sheet(kit,tiles,layout,columns,{title:'Palette through weather',legend}),
    report:{scene:world.id??null,...frame,baseline:reference,cameraTime:fixedCameraAt,thresholds,palette,limits:settings,...(matte && {matte}),
      views,states,subjects,pairs:contacts.map(row=>row.subjects),flagCount,samples,
      legend:{edges:Object.fromEntries(edgeLegend),sameSwatch:contactColor}}};
}

module.exports = { reviewPaletteWeather,measureContacts,compareSample };
