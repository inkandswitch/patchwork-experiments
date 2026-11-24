// Build a graph, render its 3D projections, and assemble a native raster review.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const {KIT,TexturedSurface,makeBuilder,makeSculpt}=ink.load();
const R=KIT.procedural.raster,D=KIT.procedural.drawing2d,U=KIT.procedural.rasterWarp;
const PNG=require('../cli/png.js');

const directory=path.resolve(process.argv[2] || 'raster-warps-review');
fs.mkdirSync(directory,{recursive:true});
const W=112,H=70,TAU=Math.PI*2;
const rect=(x,y,w,h,fill,extra={})=>({type:'rect',rect:[x,y,w,h],fill,...extra});
const ellipse=(x,y,w,h,fill,extra={})=>({type:'ellipse',rect:[x,y,w,h],fill,...extra});
const poly=(points,fill,extra={})=>({type:'polygon',points,fill,...extra});
const line=(d,color,width=1)=>({type:'path',d,color,width});
const label=(text,x,y,color,scale=1)=>({type:'text',text,at:[x,y],color,scale});
const nodes={},outputs={},exportsSpec={};
const node=(node,port)=>({node,...(port && {port})});
const op=(id,kind,inputs)=>{
  nodes[id]={op:kind,inputs}; return node(id);
};
const draw=(id,width,height,commands)=>op(id,'draw.render',{width,height,edges:'hard',commands});
const passes=(id,inputs)=>op(id,'data.record',inputs);
function array(id,entries) {
  return op(id,'data.collect',{source:passes(id+'Record',entries),keys:Object.keys(entries)});
}
function expose(id,link,format='png') {
  outputs[id]=link; exportsSpec[id]={output:id,format};
}
function write(name,image) {
  fs.writeFileSync(path.join(directory,name+'.png'),PNG.encode(image.width,image.height,image.data,4));
}
const field=(width,height,channels,fn)=>({width,height,channels,
  data:Array.from({length:width*height},(_,p)=>fn((p%width+.5)/width,(Math.floor(p/width)+.5)/height)).flat()});

const paper=[
  rect(0,0,W,H,'#17334b'),
  rect(2,2,W-4,H-4,'#20465a',{radius:3,stroke:'#e7bd83',width:1}),
  {type:'grid',origin:[6.5,6.5],step:[8,8],counts:[12,7],width:1,color:'#2e5768',majorEvery:3,majorColor:'#416c75'},
  rect(6,6,33,9,'#17334b'),label('ASH 07',7,6,'#e7c491'),
  ellipse(28,16,71,46,'#315a69',{stroke:'#84b6ac',width:1}),
  ellipse(33,20,63,38,'#366b76',{stroke:'#bad2ab',width:1}),
  ellipse(39,24,52,31,'#407983',{stroke:'#bcd2aa',width:1}),
  ellipse(46,28,37,23,'#50898a',{stroke:'#d9cf9d',width:1}),
  ellipse(51,31,28,17,'#6d9990',{stroke:'#f1d6a4',width:1}),
  line('M 12 53 Q 45 41 47 19 Q 67 5 94 16','#d89d84'),
  line('M 11 59 Q 47 50 55 28 Q 69 17 102 25','#edbf96',1.5),
  line('M 15 63 Q 49 54 61 38 Q 71 27 102 30','#af857d'),
  poly([[61,27],[69,37],[83,41],[69,45],[61,57],[58,46],[49,41],[58,37]],'#f3deab'),
  ellipse(60,39,4,4,'#a96d72'),
  rect(7,18,8,1,'#90b3a7'),rect(7,22,13,1,'#90b3a7'),rect(7,26,10,1,'#90b3a7'),
  rect(93,58,11,6,'#17334b'),rect(95,60,8,1,'#f1c895')
];
const chart=draw('chart',W,H,paper);
expose('chart',chart);
const uv=op('uv','warp.field',{width:W,height:H,matrix:[[1.08,.47,-.27],[-.13,1.02,.055]]});
expose('uvSample',op('uvSample','warp.sample',{source:chart,field:uv,options:{edge:'mirror',filter:'nearest'}}));
expose('uvField',uv,'json');

const nx=6,ny=5;
const points=Array.from({length:nx*ny},(_,i)=>{
  const u=i%nx/(nx-1),v=Math.floor(i/nx)/(ny-1), inside=Math.sin(u*Math.PI)*Math.sin(v*Math.PI);
  return [u+.12*Math.sin(v*TAU)*inside,.04+.89*v+.14*Math.sin(u*TAU+.4)*Math.sin(Math.PI*v)];
});
const grid=op('grid','warp.grid',{source:chart,control:{columns:nx,rows:ny,points},options:{filter:'nearest'}});
expose('grid',grid);
const mesh=op('mesh','warp.mesh',{source:chart,control:{
  from:[[0,0],[1,0],[1,1],[0,1],[.57,.52]],
  to:[[.02,.22],[.91,.03],[.98,.87],[.19,.99],[.51,.57]],
  triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]
},options:{filter:'nearest'}});
expose('mesh',mesh);

const bandColors=['#e0b881','#ba8182','#897aa6','#568a9d','#88b9ad','#3f6f90','#d39381','#e6c788'];
const strip=draw('strip',W,26,[
  rect(0,0,W,26,'#24445a'),
  ...bandColors.flatMap((color,i)=>[
    rect(i*14+1,3,12,19,color),rect(i*14+2,4,10,3,'#ebe1b4'),
    rect(i*14+4,11,6,2,'#32566b'),rect(i*14+6,9,2,6,'#32566b'),rect(i*14,22,14,1,'#88a4a3')
  ])
]);
expose('strip',strip);
expose('polar',op('polar','warp.polar',{source:strip,options:{width:78,height:78,radii:[.16,.49],filter:'nearest',angle:-.25}}));

const vectors=field(W,H,2,(u,v)=>[5*Math.sin(v*TAU*2.7),2.5*Math.sin(u*TAU*1.8)]);
const heightMap=field(W,H,1,(u,v)=>210*Math.exp(-((u-.42)**2*21+(v-.5)**2*13))+110*Math.exp(-((u-.72)**2*40+(v-.55)**2*41)));
expose('displaced',op('displaced','warp.displace',{source:chart,map:vectors,options:{edge:'mirror',filter:'nearest'}}));
expose('glass',op('glass','warp.refract',{source:chart,map:heightMap,options:{index:1.48,depth:28,heightScale:1/42,edge:'clamp',filter:'linear'}}));

const mw=96,mh=66;
const stampBackground=()=>[rect(0,0,mw,mh,'#192c45'),
  {type:'grid',origin:[4.5,4.5],counts:[14,9],step:[6,6],width:1,color:'#29455b'}];
function emblem(cx,color,accent,kind){
  const layers=stampBackground();
  if(kind==='sun') layers.push(ellipse(cx-14,17,28,28,color,{stroke:'#f7ddaa',width:1}),ellipse(cx-10,21,20,20,accent));
  else layers.push(poly([[cx,11],[cx+18,30],[cx,49],[cx-18,30]],color,{stroke:'#f7ddaa',width:1}),
    poly([[cx,18],[cx+12,30],[cx,42],[cx-12,30]],accent));
  layers.push(poly([[cx,20],[cx+3,28],[cx+10,31],[cx+3,34],[cx,42],[cx-3,34],[cx-10,31],[cx-3,28]],'#f7dfb0'));
  return layers;
}
const start=draw('start',mw,mh,emblem(25,'#4c959b','#6ab1ac','sun'));
const finish=draw('finish',mw,mh,emblem(70,'#bb7796','#d29caa','diamond'));
const landmark=(x)=>[[0,0],[x/mw,0],[1,0],[0,.47],[x/mw,.47],[1,.47],[0,1],[x/mw,1],[1,1]];
const cells=[[0,1,3],[3,1,4],[1,2,4],[4,2,5],[3,4,6],[6,4,7],[4,5,7],[7,5,8]];
const control={from:landmark(25),to:landmark(70),triangles:cells};
const middle=op('middle','warp.morph',{a:start,b:finish,control,amount:{input:'amount'},options:{filter:'nearest'}});
expose('start',start);expose('finish',finish);expose('middle',middle);

const beatColors=['#67b5b2','#81bfd0','#c28fb1','#e9a18e','#ecc889','#99c6a1'];
function beat(i){
  const color=beatColors[i],cx=12+i*13;
  return [rect(0,0,96,66,'#182944'),rect(5,7,86,51,'#233d54',{radius:3,stroke:'#63868d'}),
    ...Array.from({length:11},(_,j)=>rect(8+j*7,25,3,21,j<=i*2 ? color : '#35536a')),
    ellipse(cx-5,13,10,38,color+'99'),rect(8,49,79,2,'#cbc5a1'),label('PHASE',10,10,'#c4d5bd')];
}
const frameNodes=Object.fromEntries(beatColors.map((_,i)=>['beat'+i,draw('beat'+i,96,66,beat(i))]));
const sequence=array('frames',frameNodes);
const delay=field(96,66,1,(u,v)=>.64*u+.15*Math.sin(v*TAU)*Math.sin(u*Math.PI));
const timeOptions={fps:6,playback:'loop',interpolation:'linear',filter:'nearest'};
const remap=op('remap','warp.timeRemap',{frames:sequence,map:delay,options:timeOptions});
expose('uniformTime',frameNodes.beat2);expose('remap',remap);

const nativeMesh=TexturedSurface.grid({segments:[16,12],point:(u,v)=>{
  const x=(u-.5)*3.12-.66, y=2.62-v*1.97+.055*Math.sin(u*TAU), z=.29*Math.cos((u-.5)*Math.PI)+.29*Math.sin(v*Math.PI)*Math.sin(u*TAU);
  return [x,y,z];
}});
const uvMesh=Object.fromEntries(['points','uvs','triangles'].map(key=>[key,Array.from(nativeMesh[key])]));
const batch=op('surface','warp.surface',{source:chart,mesh:uvMesh});
const paint=op('paint','warp.project',{source:strip,options:{projection:{type:'cylinder',origin:[1.63,.32,0],radius:.55},
  scale:1.75,space:'world',wrap:true,stage:'lit'}});
expose('projectedPaint',paint,'json');
outputs.surface=batch;
outputs.animationFrames=sequence;

const projectFile=path.join(directory,'raster-warps.json'), graph=path.join(directory,'graph');
const project={format:'ink-studio/graph-project',version:1,time:.39,inputs:{amount:{type:'number',default:.5}},
  nodes,outputs,exports:exportsSpec,assertions:[{id:'polarWidth',output:'polar',path:['width'],op:'eq',value:78},
    {id:'nativeVertices',output:'surface',path:['vertices',2000],op:'min',value:-10},
    {id:'phaseWidth',output:'remap',path:['width'],op:'eq',value:96}]};
fs.writeFileSync(projectFile,JSON.stringify(project,null,2)+'\n');
const run=spawnSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'graph','run',projectFile,'--out',graph],
  {encoding:'utf8',maxBuffer:8*1024*1024});
if(run.error || run.status!==0) throw new Error(run.stderr || run.error?.message || JSON.stringify(JSON.parse(run.stdout).assertions));

const {outputs:sample}=ink.readGraphProject(projectFile).run();
const pal=[0x141c32,0x3e4c61,0x52667a,0x738987,0xa79a81,0xe6b485,0x334450,0x457b77];
const B=makeBuilder(103,pal), S=KIT.sculpt(makeSculpt(B));
S.sun=KIT.V.norm([-.56,.88,.42]); S.amb=.40; S.sunK=.62; S.sky=.18;
S.pixel=true; S.pixelSize(16);
const stone={r:[1,2,3]},metal={r:[2,4,5]},base={r:[6,1,2]};
S.box([.05,.12,0],[2.62,.12,.84],base,{res:.095,rd:.14});
S.box([-.65,.37,0],[1.69,.14,.51],stone,{res:.085,rd:.085});
for(const x of [-2.1,.85]) S.box([x,1.34,-.28],[.085,.93,.16],metal,{res:.065,rd:.04});
const painted=KIT.surface.material({r:[2,3,4]},{layers:{decal:sample.projectedPaint}});
S.tube([[1.63,.38,0],[1.63,2.02,0]],.53,.53,painted,{res:.045});
S.tube([[1.63,.32,0],[1.63,.39,0]],.64,.64,metal,{res:.062});
S.tube([[1.63,2.06,0],[1.63,2.15,0]],.56,.56,metal,{res:.065});
S.bake();
const world=B.finish({spriteSurfaces:sample.surface,radius:3.6,cam:{target:[0,1.30,0],dist:7.4,yaw:.38,pitch:.18}});
function rendered(yaw,width=264,height=150,pitch=.20) {
  const frame=ink.render(world,{w:width,h:height,px:1,yaw,pitch,raw:true,transparent:false});
  const data=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++){
    data[i*4]=frame.rgb[i*3];data[i*4+1]=frame.rgb[i*3+1];data[i*4+2]=frame.rgb[i*3+2];data[i*4+3]=255;
  }
  return {width,height,channels:4,data};
}
const front=rendered(.37,390,210), side=rendered(-.67,390,210);
write('projection-front',front);write('projection-oblique',side);

const BW=1332,BH=1138;
const art=name=>{
  const p=PNG.raster(path.join(graph,'artifacts',name+'.png'));
  return {width:p.w,height:p.h,data:p.data};
};
const layers=[];
function place(source,x,y,k=1){
  layers.push({source:k===1 ? source : R.resize(source,{width:source.width*k,height:source.height*k}),x,y});
}
function panel(x,y,width,height,color=[25,38,55]){
  place(R.canvas({width,height,color}),x,y);
}
function title(text,x,y,size=2,color='#b4cfcd'){
  place(D.text(text,{scale:size,color}).value,x,y);
}
function card(x,y,w,h,name,note) {
  panel(x,y,w,h);panel(x,y,w,1,[54,83,94]);title(name,x+17,y+16,2,'#edca9a');
  title(note,x+17,y+h-18,1);
}
panel(0,0,BW,BH,[12,24,39]);panel(32,32,32,4,[226,162,110]);
title('INK STUDIO / CLI GRAPH',78,26,2,'#8dceb9');
title('WARPS AND PROJECTION',32,64,4,'#ffeecc');
title('Ashlight Survey in image space and on 3D surfaces',34,109,2);
card(32,149,415,365,'FLAT SOURCE','A chart used by the raster graph and the 3D renderer.');
place(art('chart'),71,215,3);
card(463,149,837,365,'3D PROJECTION','Graph texture on the curved mesh. Cylinder painted with a projected splat layer.');
place(front,480,220);place(side,891,220);
title('FRONT',488,444,1);title('OBLIQUE',899,444,1);

card(32,533,415,252,'UV FIELD','An inverse affine field shears the original chart.');
card(458,533,415,252,'MESH AND GRID','Explicit triangles and a bent regular lattice.');
card(884,533,416,252,'POLAR MAPPING','A horizontal strip closes around an annulus.');
place(art('uvSample'),123,584,2);
place(art('mesh'),478,609);place(art('grid'),632,584,2);
title('MESH',481,719,1);title('GRID',638,734,1);
place(art('strip'),904,635);place(art('polar'),1098,579,2);
title('STRIP',910,719,1);title('ANNULUS',1104,739,1);

card(32,803,415,277,'DISPLACEMENT / REFRACTION','A vector field bends the chart. Height gradients refract it.');
card(458,803,415,277,'LANDMARK MORPH','The matched centre travels before the colours blend.');
card(884,803,416,277,'PER-PIXEL TIME','One frame time on the left. A phase map on the right.');
place(art('displaced'),54,874);place(art('glass'),204,857,2);
title('DISPLACED',58,958,1);title('REFRACTED',211,1004,1);
place(art('start'),475,895);place(art('middle'),579,865,2);place(art('finish'),777,895);
title('START',478,974,1);title('MIDPOINT',590,1005,1);title('END',786,974,1);
place(art('uniformTime'),906,894);place(art('remap'),1077,858,2);
title('UNIFORM',912,974,1);title('REMAPPED',1087,1003,1);
title('ASHLIGHT SURVEY  /  NATIVE RASTER AND 3D REVIEW',32,1108,1,'#8daeb8');
let board=R.canvas({width:BW,height:BH});
for(let i=0;i<layers.length;i+=24)
  board=R.stack({width:BW,height:BH,layers:[{source:board},...layers.slice(i,i+24)]}).value;
write('raster-warps',board);

const motion=[];
for(let i=0;i<24;i++) {
  const angle=i/24*TAU, amount=(1-Math.cos(angle))*.5, time=i/12;
  const parts=[
    {source:R.canvas({width:452,height:166,color:[13,25,42]})},
    {source:D.text('3D PROJECTION',{color:'#f3d8aa'}).value,x:12,y:13},
    {source:D.text('LANDMARK MORPH',{color:'#f3d8aa'}).value,x:259,y:13},
    {source:D.text('PIXEL TIME',{color:'#f3d8aa'}).value,x:360,y:13},
    {source:rendered(.05+.72*Math.sin(angle),234,122,.22+.06*Math.cos(angle)),x:9,y:32},
    {source:U.morph(sample.start,sample.finish,control,amount,{filter:'nearest'}),x:252,y:53},
    {source:U.timeRemap(sample.animationFrames,delay,{...timeOptions,time}),x:350,y:53}
  ];
  const frame=R.stack({width:452,height:166,layers:parts}).value, rgb=new Uint8Array(452*166*3);
  for(let p=0;p<452*166;p++) for(let c=0;c<3;c++) rgb[p*3+c]=frame.data[p*4+c];
  motion.push({w:452,h:166,rgb});
}
PNG.animate(path.join(directory,'warp-motion.png'),motion,12);
console.log(path.join(directory,'raster-warps.png'));
