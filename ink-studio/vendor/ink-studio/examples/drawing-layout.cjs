// Build and run the tide chart as a portable CLI graph, then make a review image.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const {KIT} = ink.load(), R = KIT.procedural.raster, D = KIT.procedural.drawing2d;

const directory = path.resolve(process.argv[2] || 'drawing-layout-review');
const width = 208, height = 114;
const rect = (x,y,w,h,fill,extra={}) => ({type:'rect',rect:[x,y,w,h],fill,...extra});
const ellipse = (x,y,w,h,fill,extra={}) => ({type:'ellipse',rect:[x,y,w,h],fill,...extra});
const line = (d,color,width=1) => ({type:'path',d,color,width});
const mark = (d,fill,stroke,width=1) => ({type:'path',d,fill,...(stroke && {stroke}),width});
const text = (text,x,y,color,extra={}) => ({type:'text',text,at:[x,y],color,...extra});
const node = (name,port) => ({node:name,...(port && {port})});
const input = name => ({input:name});

function builder() {
  const nodes = {};
  const op = (name,operation,inputs) => {
    nodes[name] = {op:operation,inputs};
    return node(name);
  };
  const record = (name,fields) => op(name,'data.record',fields);
  const get = (name,source,key) => op(name,'data.get',{record:source,key});
  const list = (name,fields) => op(name,'data.collect',{source:record(name+'Record',fields),keys:Object.keys(fields)});
  const draw = (name,w,h,commands) => op(name,'draw.render',{width:w,height:h,edges:'hard',commands});
  return {nodes,op,record,get,list,draw};
}

const land = 'M 25 49 Q 35 38 48 39 Q 59 34 66 23 L 84 18 Q 103 11 118 24 ' +
  'L 138 37 Q 149 43 169 42 Q 181 46 178 56 L 170 66 Q 153 71 153 80 L 140 91 ' +
  'Q 124 100 113 95 L 95 90 Q 84 84 75 91 L 55 98 Q 37 93 32 80 L 28 66 Q 16 57 25 49 Z';
const lagoon = 'M 92 43 Q 102 38 111 40 Q 123 42 126 51 Q 122 58 112 60 L 98 57 Q 91 52 92 43 Z';
const outlines = [
  rect(0,0,width,height,'#16293f'),
  {type:'grid',origin:[.5,.5],step:[13,13],counts:[16,8],width:1,color:'#1a3349',
    majorEvery:4,majorColor:'#254359',majorWidth:1},
  line(land,'#f0d598',1.7),
  line(lagoon,'#a6d3ba',1.4),
  mark('M 181 69 L 184 64 191 60 199 64 200 71 194 77 186 76 Z','#3e7275','#c6cc98'),
  mark('M 155 93 L 163 89 174 92 178 98 169 104 158 103 Z','#3e7275','#c6cc98')
];

const {nodes,op,record,list,draw} = builder();
// Flood a flat field bounded by the same shoreline, then keep the navigation grid on the sea.
const boundaries = draw('boundaries',width,height,[rect(0,0,width,height,'#16293f'),line(land,'#f0d598',1.7),line(lagoon,'#a6d3ba',1.4)]);
const surveyed = op('land','raster.floodFill',{source:boundaries,options:{seed:[65,62],color:'#38666c'}});
const filled = op('lagoon','raster.floodFill',{source:surveyed,options:{seed:[108,48],color:'#213c52'}});
const terrain = op('terrain','raster.mask',{source:filled,mask:node('land','mask')});
const inlet = op('inlet','raster.mask',{source:filled,mask:node('lagoon','mask')});
const outline = draw('outline',width,height,outlines);
const base = op('base','raster.stack',{width,height,layers:list('terrainLayers',{
  outline:record('outlineLayer',{source:outline}),land:record('landLayer',{source:terrain}),inlet:record('inletLayer',{source:inlet})
})});

const routePath = 'M 34 75 C 53 84 61 56 82 59 C 121 66 124 84 145 70 C 163 58 162 44 171 50';
const route = op('route','draw.path',{d:routePath,options:{steps:12}});
const ribbon = op('ribbon','draw.ribbon',{source:route,options:{
  width:Array.from({length:37},(_,i)=>.6+3.7*Math.sin(Math.PI*i/36)),
  fill:'#eea66c',stroke:'#ffe8aa',strokeWidth:1}});
const routeInk = op('routeInk','draw.render',{width,height,edges:'hard',commands:list('routeShapes',{
  route:ribbon,
  west:ellipse(30,71,8,8,'#ffd99c',{stroke:'#483946',width:1}),
  east:ellipse(167,46,8,8,'#ffd99c',{stroke:'#483946',width:1})
})});

const mapping = draw('symbols',width,height,[
  line('M 40 51 C 63 50 64 34 82 30 Q 102 24 116 32 L 132 43','#608e83'),
  line('M 44 57 C 59 57 65 39 82 37 Q 98 31 117 36 L 135 49','#6b9284'),
  line('M 51 86 Q 62 84 73 78 Q 82 73 93 78','#608e83'),
  line('M 82 87 Q 99 81 110 87 Q 125 94 137 83','#6b9284'),
  line('M 133 52 L 141 53 146 58','#608e83'),
  line('M 133 56 L 141 59 145 65','#608e83'),
  mark('M 16 10 L 20 22 16 19 12 22 Z','#f0d598'),
  text('N',14,2,'#f0d598')
]);
const mapLabels = draw('mapLabels',width,height,[
  text('BAY 07',8,102,'#749aad'),
  text('CUT',28,80,'#faffd9'),
  text('STATION',157,32,'#faffd9'),
  text('LAGOON',96,47,'#73acb6')
]);
const compactMap = op('compactMap','raster.stack',{width,height,layers:list('mapLayers',{
  base:record('baseLayer',{source:base}),symbols:record('symbolLayer',{source:mapping}),route:record('routeLayer',{source:routeInk})
})});
const map = op('map','raster.blend',{background:compactMap,foreground:mapLabels});

const title = op('title','draw.text',{text:'TIDELINE / 07',options:{scale:2,color:'#fff0c4'}});
const caption = op('caption','draw.text',{text:'ESTUARY FIELD CHART',options:{color:'#8fbeb9'}});
const legend = draw('legend',96,10,[rect(0,2,9,4,'#eea66c'),text('TRAVERSE ROUTE',12,0,'#e5ddc6')]);
const chart = builder(), viewportW=input('width'), viewportH=input('height');
const chartBoxes=chart.op('bounds','layout.boxes',{width:viewportW,height:viewportH,boxes:[
  {id:'sheet',size:['100%','100%'],padding:[6,5,6,6]},
  {id:'title',parent:'sheet',size:['100%',16]},
  {id:'caption',parent:'sheet',size:['100%',8],offset:[0,20]},
  {id:'map',parent:'sheet',size:['100%','73%'],anchor:[0,.19],offset:[0,4]},
  {id:'legend',parent:'sheet',size:['100%',10],anchor:[0,1],pivot:[0,1]}
]});
const paper = chart.op('paper','raster.canvas',{width:viewportW,height:viewportH,color:[22,34,48]});
const entries={paper:chart.record('paperLayer',{source:paper})};
for (const key of ['title','caption','map','legend']) {
  const box=chart.get(key+'Box',chartBoxes,key);
  entries[key]=chart.op(key+'Layer','layout.place',{source:input(key),box,options:{align:[key==='map'?.5:0,.5]}});
}
chart.op('sheet','raster.stack',{width:viewportW,height:viewportH,layers:chart.list('layers',entries)});
const shared = {title,caption,map,legend};
const wide = op('wide','Chart',{width:222,height:157,...shared});
const narrow = op('narrow','Chart',{width:151,height:157,...shared,map:compactMap});

const iconSheet = draw('icons',112,46,[
  ellipse(7,10,26,25,'#1b344a',{stroke:'#ffcd87',width:1.5}),
  mark('M 20 12 L 23 20 29 21 23 24 20 31 17 24 11 22 17 19 Z','#ffce7d','#fff2b9'),
  mark('M 46 34 L 45 26 42 24 43 20 47 24 48 15 52 13 54 17 51 25 57 20 61 21 60 26 54 28 54 34 Z',
    '#e78d7f','#ffc2a1'),
  mark('M 69 28 L 93 28 88 35 74 35 Z','#d39569','#ffe0a3'),
  mark('M 80 9 L 91 26 80 26 Z','#94d0c0','#edf2b8'),
  line('M 80.5 9 L 80.5 29','#ffe0a3',1)
]);
const components = op('parts','raster.components',{source:iconSheet,options:{threshold:1,minArea:10,connectivity:8}});
const sprites = op('sprites','array.map',{items:components,labels:node('parts','labels'),source:iconSheet});
nodes.sprites.group='Extract';
const atlas = op('atlas','raster.pack',{sprites,options:{maxWidth:114,maxHeight:80,trim:true,padding:2,extrude:1}});

const outputs={wide,narrow,boundaries,base,routeInk,iconSheet,sheet:atlas,atlas:node('atlas','atlas'),regions:components,
  landStats:node('land','stats'),lagoonStats:node('lagoon','stats'),layoutWide:node('wide','layout'),layoutNarrow:node('narrow','layout')};
const pngNames=['wide','narrow','boundaries','base','routeInk','iconSheet','sheet'];
const exportsSpec=Object.fromEntries(Object.keys(outputs).map(output=>[output,{output,
  format:pngNames.includes(output)?'png':output==='atlas'?'atlas':'json'}]));
const project={
  format:'ink-studio/graph-project',version:1,nodes,outputs,exports:exportsSpec,
  groups:{
    Chart:{inputs:{width:'number',height:'number',title:'raster',caption:'raster',map:'raster',legend:'raster'},
      nodes:chart.nodes,outputs:{value:node('sheet'),layout:chartBoxes}},
    Extract:{inputs:{item:'record',labels:'raster',source:'raster'},
      nodes:{crop:{op:'raster.extractComponent',inputs:{component:input('item'),labels:input('labels'),source:input('source')}}},
      outputs:{value:node('crop')}}
  },
  assertions:[
    {id:'isolatedSymbols',output:'regions',path:['length'],op:'eq',value:3},
    {id:'landInterior',output:'landStats',path:['area'],op:'min',value:2000},
    {id:'landBoundary',output:'landStats',path:['area'],op:'max',value:9000},
    {id:'lagoonInterior',output:'lagoonStats',path:['area'],op:'min',value:180},
    {id:'lagoonBoundary',output:'lagoonStats',path:['area'],op:'max',value:800}
  ]
};

fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'tide-chart.json'), graphOut=path.join(directory,'graph'), art=path.join(graphOut,'artifacts');
fs.writeFileSync(file,JSON.stringify(project,null,2)+'\n');
const run=spawnSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'graph','run',file,'--out',graphOut],
  {encoding:'utf8',maxBuffer:8*1024*1024});
if (run.error || run.status!==0) throw new Error(run.stderr || run.error?.message ||
  JSON.stringify(JSON.parse(run.stdout).assertions));

const W=1240, H=973, bg=[13,22,34], cardColor=[25,41,57];
const surfaces=[];
function surface(source,x=0,y=0) { surfaces.push({source,x,y}); }
function panel(x,y,width,height,color=cardColor) { surface(R.canvas({width,height,color}),x,y); }
function label(value,x,y,scale=2,color='#a5c6c8') { surface(D.text(value,{scale,color}).value,x,y); }
function picture(name,x,y,scale) {
  const decoded=PNG.raster(path.join(art,name+'.png'));
  const image={width:decoded.w,height:decoded.h,data:decoded.data};
  surface(scale===1 ? image : R.resize(image,{width:image.width*scale,height:image.height*scale}),x,y);
}

panel(0,0,W,H,bg);
panel(32,32,27,4,[237,171,106]);
label('INK STUDIO / CLI GRAPH',72,26,2,'#92cec2');
label('DRAWING AND LAYOUT',32,66,4,'#ffeece');
label('A tide chart, sized for two formats',34,108,2,'#a5c6c8');
panel(32,155,720,552);
panel(772,155,436,552);
label('WIDE CHART',54,175,2,'#f4cb92');
label('COMPACT CHART',795,175,2,'#f4cb92');
picture('wide',59,207,3);
picture('narrow',839,217,2);
label('222 x 157 ART PX',55,684,2);
label('151 x 157 ART PX',794,551,2);
label('Same chart and layout rules.',795,582,2);
label('The title stays anchored',795,609,2);
label('while the map fits its box.',795,627,2);

for (const x of [32,428,824]) panel(x,730,384,205);
label('FLOOD FILL',50,750,2,'#f4cb92');
label('OUTLINE',51,783,1);
label('SEEDED REGIONS',238,783,1);
function fitPreview(name,x,y,width,height) {
  const decoded=PNG.raster(path.join(art,name+'.png'));
  const source={width:decoded.w,height:decoded.h,data:decoded.data};
  const layer=D.place(source,[x,y,width,height]);
  surfaces.push(layer);
}
fitPreview('boundaries',50,796,166,104);
fitPreview('base',234,796,166,104);
label('The shore and lagoon fill independently.',50,913,1);

label('PATH RIBBON',446,750,2,'#f4cb92');
fitPreview('routeInk',452,781,335,119);
label('A sampled curve carries a tapered width.',446,913,1);

const regions=JSON.parse(fs.readFileSync(path.join(art,'regions.json'),'utf8'));
label('COMPONENT EXTRACTION',842,750,2,'#f4cb92');
label('SOURCE',845,783,1);
label('PACKED',1022,783,1);
fitPreview('iconSheet',842,794,165,108);
fitPreview('sheet',1020,794,165,108);
label(regions.length+' isolated silhouettes go to a native atlas.',842,913,1);
label('TIDELINE SURVEY  /  NATIVE RASTER WORKFLOW',32,952,1,'#8da9b2');

const board=R.stack({width:W,height:H,layers:surfaces}).value;
const image=path.join(directory,'drawing-layout.png');
fs.writeFileSync(image,PNG.encode(W,H,board.data,4));
console.log(image);
