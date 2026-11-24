// Build a standalone CLI graph and a pixel-scale review of its raster effects.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const R=KIT.procedural.raster,D=KIT.procedural.drawing2d;

const directory=path.resolve(process.argv[2] || 'pixel-effects-review');
fs.mkdirSync(directory,{recursive:true});
const W=128,H=80;
const rect=(x,y,w,h,fill,extra={})=>({type:'rect',rect:[x,y,w,h],fill,...extra});
const ellipse=(x,y,w,h,fill,extra={})=>({type:'ellipse',rect:[x,y,w,h],fill,...extra});
const line=(d,color,width=1)=>({type:'path',d,color,width});
const polygon=(points,fill,extra={})=>({type:'polygon',points,fill,...extra});
function mirrored(type,d,settings) {
  const {points,closed}=D.path(d);
  const sides=[points,points.map(([x,y])=>[W-x,y])];
  return sides.map(points=>({type,points,...(type==='path' && {closed}),...settings}));
}
function star(x,y,a,b,fill) {
  return polygon([[x,y-b],[x+a*.22,y-b*.2],[x+a,y],[x+a*.22,y+b*.2],
    [x,y+b],[x-a*.22,y+b*.2],[x-a,y],[x-a*.22,y-b*.2]],fill);
}

const moth=[
  ...mirrored('polygon','M 64 41 Q 45 16 13 12 Q 5 20 13 34 Q 22 48 38 47 Q 17 57 28 67 Q 40 76 59 56 L 64 49 Z',
    {fill:'#3a6686',stroke:'#89b9ba',width:1}),
  ...mirrored('polygon','M 61 41 Q 42 19 16 15 Q 12 27 23 36 Q 37 47 61 47 Z',{fill:'#528c9b'}),
  ...mirrored('polygon','M 58 40 Q 36 25 18 19 Q 18 30 29 34 Q 42 39 58 43 Z',{fill:'#92b7a4'}),
  ...mirrored('polygon','M 59 47 Q 44 46 33 55 Q 25 65 35 67 Q 50 66 59 51 Z',{fill:'#696098'}),
  ...mirrored('polygon','M 58 52 Q 46 58 31 62 Q 35 70 49 62 Z',{fill:'#ab82b2'}),
  ...mirrored('path','M 58 43 Q 41 38 23 26',{color:'#e5d59d',width:1}),
  ...mirrored('path','M 55 48 Q 41 50 33 60',{color:'#c5accc',width:1}),
  ...mirrored('path','M 64 33 Q 61 24 55 23 L 52 26',{color:'#f4d59e',width:1}),
  ellipse(27,34,14,9,'#233c59'),ellipse(87,34,14,9,'#233c59'),
  star(34,38,6,4,'#fbd8a6'),star(94,38,6,4,'#fbd8a6'),
  ellipse(60,31,8,24,'#665479',{stroke:'#e9b887',width:1}),
  ellipse(61,34,6,14,'#bd8d89'),
  rect(63,36,2,9,'#ffe9ba'),ellipse(61,30,6,6,'#ffe3a3'),
  star(20,58,3,4,'#cc91ba'),star(108,58,3,4,'#cc91ba'),
  star(64,9,4,5,'#ffe2a8')
];
const morph=[
  {type:'polygon',rings:[[[5,12],[14,6],[43,6],[49,13],[49,39],[43,45],[13,45],[5,39]],
    [[15,17],[38,17],[38,35],[15,35]],[[27,10],[28,10],[28,11],[27,11]],[[43,38],[44,38],[44,39],[43,39]]],
    fill:'#6bb8b0'},
  rect(55,12,10,2,'#9e86b6'),rect(66,12,11,2,'#9e86b6'),rect(79,12,14,2,'#9e86b6'),
  rect(55,22,8,2,'#9e86b6'),rect(64,22,15,2,'#9e86b6'),rect(80,22,13,2,'#9e86b6'),
  rect(55,32,16,3,'#9e86b6'),rect(73,32,20,3,'#9e86b6')
];
const starCommands=[
  line('M 6 41 Q 11 29 21 27','#67749f',1.5),line('M 10 45 L 15 41','#98bfc0',1),
  star(26,31,11,14,'#c187b3'),star(26,31,6,9,'#ffcd9d'),star(26,31,3,5,'#fff0c2')
];

const nodes={},outputs={},exportsSpec={},assets={};
const node=(node,port)=>({node,...(port && {port})});
const op=(name,kind,inputs)=>{
  nodes[name]={op:kind,inputs};
  return node(name);
};
const draw=(name,width,height,commands)=>op(name,'draw.render',{width,height,edges:'hard',commands});
const effect=(name,kind,source,options)=>op(name,'fx.'+kind,{source,options});
function expose(name,link,format='png') {
  outputs[name]=link;
  exportsSpec[name]={output:name,format};
}
function write(file,image) {
  fs.writeFileSync(file,PNG.encode(image.width,image.height,image.data,4));
}

const base=draw('moth',W,H,moth);
const rim=effect('outlined','outline',base,{outer:2,inner:1,color:'#443664',innerColor:'#c7cfab'});
const metal=effect('beveled','bevel',rim,{width:3,direction:[-1,-1],strength:.9,highlight:'#fff0bd',shadow:'#231d4c'});
const lum=effect('glowing','glow',metal,{radius:9,strength:1.6,color:'#8564c2'});
expose('moth',base); expose('outline',rim); expose('bevel',metal); expose('glow',lum);

const meteor=draw('meteor',107,52,starCommands);
const kernel=effect('kernel','kernelBlur',meteor,{radius:5,sigma:2.3,edge:'transparent'});
const curve=op('curve','draw.path',{d:'M 0 0 C 13 -1 30 -8 40 -13 Q 49 -22 62 -14'});
const pathBlur=op('path','fx.pathBlur',{source:meteor,path:curve,options:{samples:34,falloff:'start'}});
const trailLayers=op('trailLayers','data.record',{
  trail:op('trailLayer','data.record',{source:pathBlur}),
  spark:op('sparkLayer','data.record',{source:meteor})
});
const trail=op('trail','raster.stack',{width:107,height:52,
  layers:op('trailOrder','data.collect',{source:trailLayers,keys:['trail','trail','trail','spark']})});
expose('meteor',meteor); expose('kernel',kernel); expose('path',pathBlur); expose('trail',trail);

const widget=draw('widget',96,51,morph);
const eroded=effect('erode','erode',widget,{radius:1});
const closed=effect('close','repair',widget,{radius:1,color:'#ffc692'});
const bridge=effect('bridge','repair',closed,{method:'bridge',maxGap:2,color:'#ffc692'});
expose('widget',widget); expose('eroded',eroded); expose('repaired',bridge);
expose('repairMask',node('bridge','added'),'json');

const terrain=R.canvas({width:100,height:50}), colors=[[25,45,70],[75,67,110],[144,87,130],[228,137,157],[255,207,160]];
function mix(a,b,t){return a.map((n,i)=>Math.round(n+(b[i]-n)*t));}
for(let y=0;y<50;y++) for(let x=0;x<100;x++) {
  const horizon=23+4*Math.sin(x*.11)+1.8*Math.sin(x*.34), hot=Math.hypot(x-68,y-15)<10;
  let spectrum=y>horizon ? .46+.20*Math.sin(x*.21+y*.6)+.19*Math.sin(x*.088+y*.97)+.08*Math.sin(x*94+y*39)
    : .12+y*.027+.10*Math.sin(x*.078+y*.18);
  if (hot && y<horizon) spectrum=.83+(23-y)*.014;
  const u=Math.max(0,Math.min(3.999,spectrum*4)), i=Math.floor(u);
  const pixel=mix(colors[i],colors[i+1],u-i);
  terrain.data.set([...pixel,255],(y*100+x)*4);
}
write(path.join(directory,'water.png'),terrain);
assets.water={format:'png',file:'water.png'};
const water=op('water','pngAsset',{name:'water'});
const waterMask=draw('waterMask',100,50,[
  rect(0,0,100,50,'#000000'),
  polygon([[6,31],[39,28],[94,30],[94,45],[59,46],[8,43]],'#ffffff')
]);
const sortOptions=op('sortOptions','data.record',{key:'lightness',axis:'horizontal',order:'desc',mask:waterMask});
const sorted=effect('sorted','pixelSort',water,sortOptions);
expose('water',water);expose('sorted',sorted);

const vision=effect('analyze','analyze',base,{minArea:4,threshold:128});
expose('paths',node(vision.node,'paths'),'json');
expose('points',node(vision.node,'points'),'json');
expose('regions',node(vision.node,'regions'),'json');
const traceGroup={
  inputs:{item:'path'},nodes:{command:{op:'data.record',inputs:{type:'path',source:{input:'item'},color:'#ffbd89',width:1}}},
  outputs:{value:node('command')}
};
const trace=op('trace','array.map',{items:node(vision.node,'paths')});
nodes.trace.group='Trace';
const edge=draw('edges',W,H,trace);
expose('edges',edge);

const assertions=[
  {id:'tracedContour',output:'paths',path:['length'],op:'min',value:2},
  {id:'centroidCount',output:'points',path:['length'],op:'min',value:2},
  {id:'bridgedContact',output:'repairMask',path:['data',12*96+65],op:'eq',value:255}
];
const project=path.join(directory,'pixel-effects.json'), graph=path.join(directory,'graph');
fs.writeFileSync(project,JSON.stringify({
  format:'ink-studio/graph-project',version:1,nodes,assets,groups:{Trace:traceGroup},outputs,exports:exportsSpec,assertions
},null,2)+'\n');
const run=spawnSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'graph','run',project,'--out',graph],
  {encoding:'utf8',maxBuffer:8*1024*1024});
if(run.error || run.status!==0) throw new Error(run.stderr || run.error?.message || JSON.stringify(JSON.parse(run.stdout).assertions));

const width=1328,height=1138,board=R.canvas({width,height,color:[14,20,34]});
function rectPixels(x,y,w,h,color){
  const row=Uint8Array.from({length:w*4},(_,i)=>color[i%4]??255);
  for(let v=y;v<y+h;v++) board.data.set(row,(v*width+x)*4);
}
function stamp(image,x,y){
  for(let v=0;v<image.height;v++) for(let u=0;u<image.width;u++) {
    const i=(v*image.width+u)*4, o=((y+v)*width+x+u)*4, a=image.data[i+3]/255;
    for(let c=0;c<3;c++) board.data[o+c]=Math.round(board.data[o+c]*(1-a)+image.data[i+c]*a);
  }
}
function label(value,x,y,scale=2,color='#afc0d5') {
  stamp(D.text(value,{scale,color}).value,x,y);
}
function card(x,y,w,h,title,note){
  rectPixels(x,y,w,h,[25,35,56]);
  rectPixels(x,y,w,1,[62,76,102]);
  label(title,x+18,y+17,2,'#f6cda5');
  if(note) label(note,x+18,y+h-19,1);
}
function read(name){
  const decoded=PNG.raster(path.join(graph,'artifacts',name+'.png'));
  return {width:decoded.w,height:decoded.h,data:decoded.data};
}
function show(name,x,y,scale,color=[16,24,44]){
  const source=typeof name==='string' ? read(name) : name;
  const image=R.resize(source,{width:source.width*scale,height:source.height*scale});
  rectPixels(x,y,image.width,image.height,color);
  stamp(image,x,y);
}

rectPixels(34,32,30,4,[234,176,128]);
label('INK STUDIO / CLI GRAPH',78,26,2,'#a3cbc7');
label('PIXEL EFFECTS',34,65,4,'#ffe9c4');
label('Prism moth and raster studies',36,108,2);
card(34,150,620,382,'DRAWN SOURCE','Original art at 128 x 80 pixels.');
card(674,150,620,382,'OUTLINE / BEVEL / GLOW','The outline, relief and glow are separate graph nodes.');
show('moth',88,191,4);
show('glow',728,191,4);

card(34,550,412,226,'KERNEL BLUR','The Gaussian softens in both directions.');
card(458,550,412,226,'PATH BLUR','Repeated trails reveal the evenly sampled curve.');
card(882,550,412,226,'PIXEL SORT','Sort runs inside the reflection mask by lightness.');
show('meteor',59,610,1); show('kernel',204,595,2);
show('meteor',481,610,1); show('trail',626,595,2);
show('water',901,614,1); show('sorted',1054,595,2);
label('SOURCE 1X',63,728,1);label('GAUSSIAN 2X',211,728,1);
label('SOURCE 1X',488,728,1);label('CURVED TRAIL 2X',633,728,1);
label('SOURCE 1X',908,728,1);label('SORTED 2X',1063,728,1);

card(34,794,412,294,'EROSION','The one-pixel erosion recedes from exposed edges.');
card(458,794,412,294,'GAP REPAIR','Peach pixels mark repaired holes and line breaks.');
card(882,794,412,294,'PATHS AND POINTS','Contour paths and component centroids export as JSON.');
show('widget',59,878,1); show('eroded',213,851,2);
show('widget',481,878,1); show('repaired',637,851,2);
label('SOURCE 1X',64,1007,1);label('ERODED 2X',220,1007,1);
label('SOURCE 1X',488,1007,1);label('REPAIRED 2X',642,1007,1);
const points=JSON.parse(fs.readFileSync(path.join(graph,'artifacts/points.json'),'utf8'));
const lines=read('edges');
const display=R.stack({width:W,height:H,layers:[
  {source:read('moth'),opacity:.25},{source:lines},
  {source:D.render({width:W,height:H,edges:'hard',commands:points.flatMap(([x,y])=>[
    rect(Math.floor(x)-2,Math.floor(y),5,1,'#89f1db'),
    rect(Math.floor(x),Math.floor(y)-2,1,5,'#89f1db')
  ])})}
]}).value;
show(R.crop(display,{x:6,y:1,width:116,height:74}),913,844,3);
label('PRISM MOTH  /  NATIVE RASTER REVIEW',34,1110,1,'#92a7bb');

const out=path.join(directory,'pixel-effects.png');
write(out,board);
console.log(out);
