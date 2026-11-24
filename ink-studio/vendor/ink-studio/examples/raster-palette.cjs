// Create original raster artwork, run a portable Ink graph, and make a review board.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const R=KIT.procedural.raster, D=KIT.procedural.drawing2d;

const directory=path.resolve(process.argv[2] || 'raster-palette-review');
const W=152,H=82, reserved='#ffe5ad', glow=[255,229,173];
const palette=['#13152d','#262446','#3c355b','#594769','#80596e','#aa707a','#ce8986','#e8b09c','#efcbaa','#d5ddd5','#749da1','#4b687c'];
const palettePolicy={palette,reserved:[reserved],match:'perceptual',dither:{
  pattern:'bayer',strength:1,pairs:[
    ...palette.slice(0,8).map((color,i)=>({colors:[color,palette[i+1]]})),
    {colors:[palette[8],palette[9]]},{colors:[palette[3],palette[11]]},
    {colors:[palette[11],palette[10]]},{colors:[palette[10],palette[9]]}
  ]
}};
const cool=['#14172f','#292044','#3d2d5b','#60416d','#865575','#b97883','#e4a098','#f0ccb0'];
const pack=KIT.authoring.assetPacks.savePaletteLook({
  id:'salt-sky/afterglow',label:'Salt Sky Afterglow',
  ramp:{interpolation:'smooth',stops:[[0,'#11152b'],[.24,'#292044'],[.48,'#613a70'],[.64,'#ad6582'],[.8,'#e89b97'],[1,'#f1d1ac']]},
  palette:cool,reserved:[reserved],match:'brightness',
  dither:{pattern:'bayer',strength:.88,pairs:cool.slice(0,-1).map((color,i)=>({colors:[color,cool[i+1]]}))}
});
const clamp=x=>Math.max(0,Math.min(1,x));
const mix=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*clamp(t)));
const noise=(x,y)=>(((Math.imul(x+127,1571280899)^Math.imul(y+72,752709599))>>>13)%127)/127;
function surface(width,height,pixel) {
  const value=R.canvas({width,height});
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=pixel(x,y);
    value.data.set(p,(y*width+x)*4);
    value.data[(y*width+x)*4+3]=p[3] ?? 255;
  }
  return value;
}
function field(x,y) {
  const grain=noise(x,y)-.5, depth=y/H;
  let rgb=mix([24,27,60],[218,138,143],(depth*1.58+.16*x/W)**1.27);
  if (y<30 && noise(x*7,y*11)>.993) rgb=mix(rgb,[221,188,174],.45);
  const sun=Math.hypot(x-112.4,(y-24.2)*1.01);
  if (sun<15.8) rgb=mix([219,120,116],[249,195,153],1-(y-8)/44+.05*grain);
  const clouds=(Math.sin(x*.12+y*.68)+Math.sin(x*.049-y*.72))*.5;
  if (y>13 && y<44 && clouds>.78 && sun>15.8) rgb=mix(rgb,[242,170,162],.19+.07*grain);
  const horizon=44+3*Math.sin(x*.09)+2*Math.cos(x*.19);
  if(y>=horizon) rgb=mix([111,79,105],[181,111,118],clamp((y-horizon)*.071));
  const ridge=54+3.8*Math.cos(.05*x)+2*Math.sin(x*.15);
  if(y>=ridge) {
    const r=(y-ridge)/(H-ridge);
    rgb=mix([183,115,119],[53,49,81],r+.13*Math.sin(x*.053+y*.28)+.085*grain);
    if((x+Math.floor(4*Math.sin(y*.7)))%23<4 && noise(x,y)> .65) rgb=mix(rgb,[220,146,131],.32);
    if(y>71+3*Math.sin(x*.8) && noise(Math.floor(x/3),Math.floor(y/2))>.84)
      rgb=mix(rgb,[33,41,67],.35);
  }
  const u=(x-70.7)/23, cap=42-15*Math.sqrt(Math.max(0,1-u*u));
  const base=67+2*Math.sin(x*.11);
  if(Math.abs(u)<1 && y>=cap && y<base) {
    const inward=Math.hypot((x-70.5)/9.2,Math.max(0,48-y)/10);
    if(y>35 && inward<1) rgb=mix([29,31,56],[70,53,73],(y-37)/26);
    else {
      const seam=(y+Math.floor(2*Math.cos(x*.3)))%6===0 || (x+((Math.floor(y/6)%2)*5))%10===0;
      const rim=clamp(.59+.35*(-u)-.18*(y-42)/20+.08*grain);
      rgb=mix([43,54,80],[144,169,171],rim-(seam?.19:0));
      if (y<cap+1.7) rgb=mix(rgb,[238,185,155],.72);
      if (inward>1 && inward<1.28 && y>35) rgb=mix([136,102,107],[231,175,141],.40-rim*.13);
    }
    if (y>base-2) rgb=mix(rgb,[39,46,71],.66);
  }
  if (x===63 && y>=34 && y<39 || x===78 && y>=32 && y<37) rgb=[52,56,77];
  if(y>=44 && y<54 && x>=67 && x<=74) {
    if(y===44 || y===53 || x===67 || x===74) rgb=[122,83,72];
    else rgb=mix([243,144,88],glow,(y-45)/8+.15);
    if(x===70 && y>=48 && y<=51 || x===71 && y>=48 && y<=50) rgb=glow;
  }
  if (y>=57 && y<61 && x>=68 && x<=74) rgb=mix(rgb,[225,149,114],.36);
  if(x>97 && x<134 && y>61 && (x+Math.floor(y*.7))%17===0 && noise(x,y)>.7) rgb=mix(rgb,[38,56,71],.62);
  return rgb;
}

function lantern(x,y) {
  const ox=x-23.5, v=y-20;
  const background=mix([24,126,68],[67,201,83],.18+.62*x/47+.1*Math.sin(y*.17));
  if (y>=4 && y<=12 && Math.abs(Math.hypot(ox,v+10)-3)<1) return [230,177,101];
  if (y>=11 && y<18 && Math.abs(ox)<2) return [130,91,90];
  const rim=Math.abs(ox) + Math.abs(v-10)*.67;
  if (v>=-3 && v<=24 && rim<16) {
    if (rim>13 || v<2 || v>19 || Math.abs(ox)>9.8 || (v>13 && (x===18 || x===28)))
      return mix([49,63,116],[137,192,205],.54-ox/46+.1*noise(x,y));
    const ember=Math.hypot(ox*.62,(v-10)*1.1);
    if (ember<1.8) return glow;
    return mix([211,115,82],[255,218,153],1-ember/11);
  }
  if (y>=43 && y<49 && Math.abs(ox)+Math.abs(y-46)<5) return [200,144,120];
  return background;
}

const source=surface(W,H,field), prop=surface(48,54,lantern);
const nodes={},assets={},outputs={},artifacts={};
const op=(id,operation,inputs)=>{
  nodes[id]={op:operation,inputs}; return {node:id};
};
const asset=(id,filename,format)=>{
  assets[id]={format,file:filename}; return op(id,format==='png'?'pngAsset':'jsonAsset',{name:id});
};
function expose(id,link,format='png') {
  outputs[id]=link; artifacts[id]={output:id,format};
}
function writeRaster(file,raster) {
  fs.writeFileSync(file,PNG.encode(raster.width,raster.height,raster.data,4));
}
fs.mkdirSync(directory,{recursive:true});
writeRaster(path.join(directory,'observatory.png'),source);
writeRaster(path.join(directory,'lantern.png'),prop);
fs.writeFileSync(path.join(directory,'afterglow-pack.json'),JSON.stringify(pack,null,2)+'\n');
const input=asset('source','observatory.png','png'), lamp=asset('plate','lantern.png','png');
const manifest=asset('pack','afterglow-pack.json','json');
expose('source',input);
const look=op('look','color.look',{source:input,pack:manifest,binding:{asset:'salt-sky/afterglow',revision:pack.revision}});
expose('afterglow',look);
expose('lookMetadata',{...look,port:'metadata'},'json');
for(const method of ['solid','ordered','diffusion']) {
  const resolved=op(method,'palette.resolve',{source:input,policy:palettePolicy,options:{method}});
  expose(method,resolved);
}
expose('diffusionIndices',{node:'diffusion',port:'indices'},'json');

const authorRamps=op('recipe','palette.recipe',{definition:{anchors:{glass:'#70958e'},roles:{
  glass:{anchor:'glass',steps:6,lightness:[.19,.94],hueShift:[21,-17],chromaScale:[.8,1,.35]}
}}});
const gradientOptions=op('gradientOptions','data.record',{palette:authorRamps,channel:'lightness',range:[.16,.92]});
expose('namedRamp',op('namedRamp','color.gradient',{source:input,ramp:'glass',options:gradientOptions}));

const key=op('key','color.key',{source:lamp,options:{color:'#30ab51',metric:'chroma',tolerance:.045,softness:.025}});
const swapped=op('replace','color.replace',{source:key,rules:[
  {from:'#6385aa',to:'#c57e99',tolerance:.085,softness:.028,preserveLightness:true}],
  options:{metric:'perceptual'}});
const alpha=op('alpha','color.channels',{source:key,options:{order:['alpha','alpha','alpha',255]}});
expose('plate',lamp);
expose('keyed',key);
expose('recolored',swapped);
expose('matte',alpha);
const accent= (48*W+70)*4;
const assertions=[
  {id:'diffusionAccent',output:'diffusion',path:['data',accent+2],op:'eq',value:glow[2]},
  {id:'lookAccent',output:'afterglow',path:['data',accent+2],op:'eq',value:glow[2]},
  {id:'transparentPlate',output:'keyed',path:['data',3],op:'eq',value:0},
  {id:'opaqueEmber',output:'keyed',path:['data',(30*48+24)*4+3],op:'eq',value:255},
  {id:'unchangedEmber',output:'recolored',path:['data',(30*48+24)*4+2],op:'eq',value:glow[2]}
];
const project=path.join(directory,'raster-palette.json'), graph=path.join(directory,'graph');
fs.writeFileSync(project,JSON.stringify({format:'ink-studio/graph-project',version:1,assets,nodes,outputs,exports:artifacts,assertions},null,2)+'\n');
const run=spawnSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'graph','run',project,'--out',graph],
  {encoding:'utf8',maxBuffer:8*1024*1024});
if(run.error || run.status!==0) throw new Error(run.stderr || run.error?.message || JSON.stringify(JSON.parse(run.stdout).assertions));

const width=1360,height=1130, board=R.canvas({width,height,color:[15,21,36]});
function rect(x,y,w,h,color) {
  const row=Uint8Array.from({length:w*4},(_,i)=>color[i%4]??255);
  for(let v=y;v<y+h;v++) board.data.set(row,(v*width+x)*4);
}
function stamp(image,x,y) {
  for(let v=0;v<image.height;v++) for(let u=0;u<image.width;u++) {
    const i=(v*image.width+u)*4, o=((y+v)*width+x+u)*4, a=image.data[i+3]/255;
    for(let c=0;c<3;c++) board.data[o+c]=Math.round(board.data[o+c]*(1-a)+image.data[i+c]*a);
  }
}
function label(text,x,y,scale=2,color='#a9b6cc') {
  stamp(D.text(text,{scale,color}).value,x,y);
}
function art(name,x,y,scale,checker=false) {
  const png=PNG.raster(path.join(graph,'artifacts',name+'.png'));
  const raster=R.resize({width:png.w,height:png.h,data:png.data},{width:png.w*scale,height:png.h*scale});
  if(checker) for(let v=0;v<raster.height;v+=12) for(let u=0;u<raster.width;u+=12)
    rect(x+u,y+v,Math.min(12,raster.width-u),Math.min(12,raster.height-v),
      ((v+u)/12)%2?[31,42,63]:[43,55,78]);
  stamp(raster,x,y);
}
function card(x,y,w,h,title,note) {
  rect(x,y,w,h,[25,34,54]);
  rect(x,y,w,1,[55,66,95]);
  label(title,x+18,y+17,2,'#f6d5ad');
  if(note) label(note,x+18,y+h-19,1);
}
function swatches(list,x,y) {
  for(const [i,hex] of list.entries())
    rect(x+i*24,y,21,9,hex.slice(1).match(/../g).map(n=>parseInt(n,16)));
}
rect(34,34,30,4,[232,160,126]);
label('INK STUDIO / CLI GRAPH',78,28,2,'#87c5be');
label('PALETTE AND COLOUR',34,66,4,'#ffebcc');
label('A study of the Salt Sky Observatory',36,110,2);

card(34,154,636,326,'SOURCE RASTER','One native 152 x 82 frame with an exact lantern accent.');
card(690,154,636,326,'AFTERGLOW LOOK PACK','The saved look applies a ramp and palette while retaining the accent.');
art('source',124,200,3);
art('afterglow',780,200,3);
swatches([...cool,reserved],1089,452);
const cards=[
  [34,'SOLID MATCH','solid','Perceptual match to the nearest enabled swatch.'],
  [469,'ORDERED PAIRS','ordered','Bayer uses only the approved swatch pairs.'],
  [904,'ERROR DIFFUSION','diffusion','Serpentine diffusion distributes the residual.']
];
for(const [x,title,name,note] of cards) {
  card(x,498,422,250,title,note);
  art(name,x+59,545,2);
}

card(34,767,422,322,'CHROMA KEY','Colour distance removes the green plate.');
art('plate',70,850,3);
label('INPUT',77,1045,2);
art('keyed',278,850,3,true);
label('KEYED',305,1045,2);
card(469,767,422,322,'SELECTIVE REPLACEMENT','The metal changes colour while the amber glass keeps its tones.');
art('keyed',509,850,3,true);
label('ORIGINAL METAL',509,1045,1);
art('recolored',711,850,3,true);
label('ROSE FINISH',743,1045,1);
card(904,767,422,322,'CHANNELS AND RAMPS','Alpha preview and a named Ink ramp sampled by lightness.');
art('matte',936,845,3);
art('namedRamp',1100,871,1);
label('ALPHA',965,1045,1);
label('GLASS RAMP',1124,1045,1);
label('SALT SKY OBSERVATORY  /  NATIVE RASTER REVIEW',34,1108,1,'#91a8bb');

const boardFile=path.join(directory,'raster-palette.png');
writeRaster(boardFile,board);
console.log(boardFile);
