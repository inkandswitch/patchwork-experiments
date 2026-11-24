const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { createGraphHost } = require('./graph-host.js');

const format = 'ink-studio/graph-project';
const reportFormat = 'ink-studio/graph-report';
const version = 1;
const maxNodes = 2000;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sameValue = (a,b) => isDeepStrictEqual(a,b);

function fields(value, keys, label) {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Invalid ' + label);
  return value;
}

function named(value, label) {
  if (!record(value) || !Object.keys(value).every(id))
    throw new TypeError('Expected ' + label + ' keyed by graph ID');
  return Object.entries(value);
}

function separateNames(names, label) {
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length)
    throw new TypeError(label + ' need distinct names on case-insensitive filesystems');
}

function imageBytes(value) {
  const { width, height, data } = value ?? {};
  const size = width * height;
  const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      size > 2**24 || ![size*3,size*4].includes(data?.length) ||
      !(Array.isArray(data) || ArrayBuffer.isView(data)))
    throw new TypeError('Graph PNG output needs an RGB8 or RGBA8 image');
  if (!bytes) for (let i=0; i<data.length; i++) {
    const n=data[i];
    if (!Number.isInteger(n) || n<0 || n>255) throw new TypeError('Graph PNG output needs an RGB8 or RGBA8 image');
  }
  return PNG.encode(width,height,bytes ? data : Uint8Array.from(data),data.length / size);
}

function jsonBytes(value) {
  const active = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || Number.isFinite(item)) return item;
    if (active.has(item)) throw new TypeError('Graph JSON output contains a cycle');
    if (!Array.isArray(item) && !(ArrayBuffer.isView(item) && typeof item.length==='number') && !record(item))
      throw new TypeError('Graph JSON output needs finite JSON data or numeric buffers');
    active.add(item);
    const result = Array.isArray(item) || ArrayBuffer.isView(item) ? Array.from(item,visit) :
      Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0).map(([key,value])=>[key,visit(value)]));
    active.delete(item);
    return result;
  }
  return Buffer.from(JSON.stringify(visit(value),null,2)+'\n');
}

function describe(value, depth = 0) {
  if (typeof value === 'function') return {kind:'runtime',type:'function'};
  if (value === undefined || typeof value === 'bigint' || typeof value === 'symbol' ||
      typeof value === 'number' && !Number.isFinite(value)) return {kind:'runtime',type:typeof value};
  if (!value || typeof value !== 'object') return value;
  if (Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) && value.data)
    return {kind:'image',width:value.width,height:value.height,samples:value.data.length};
  if (Number.isSafeInteger(value.sampleRate) && value.sampleRate > 0 && Number.isSafeInteger(value.channels) &&
      value.channels > 0 && (Array.isArray(value.samples) || ArrayBuffer.isView(value.samples))) {
    const frames=value.samples.length / value.channels;
    return {kind:'audio',sampleRate:value.sampleRate,channels:value.channels,frames,duration:frames/value.sampleRate};
  }
  if (ArrayBuffer.isView(value)) return {kind:'buffer',type:value.constructor.name,length:value.length};
  if (Array.isArray(value)) return depth<3 && value.length<=32 ? value.map(item => describe(item,depth+1)) :
    {kind:'array',length:value.length};
  const keys = Object.keys(value);
  if (!record(value) || depth>=3 || keys.length>32) return {kind:'record',keys:keys.slice(0,32),length:keys.length};
  return Object.fromEntries(keys.map(key=>[key,describe(value[key],depth+1)]));
}

function graphSpec(value, label, groupOperators) {
  fields(value,['inputs','nodes','outputs'],label);
  const {inputs={},nodes,outputs}=value;
  function binding(value) {
    if (!record(value)) return;
    const kinds=['value','node','input','keys'].filter(key=>Object.hasOwn(value,key));
    if (!kinds.length) return;
    const [kind]=kinds;
    const allowed=kind==='node' ? ['node','port'] : kind==='keys' ? ['keys','mode'] : [kind];
    if (kinds.length!==1 || Object.keys(value).some(key=>!allowed.includes(key)) ||
        kind==='node' && (!id(value.node) || Object.hasOwn(value,'port') && !id(value.port)) ||
        kind==='input' && !id(value.input) || kind==='keys' && !Array.isArray(value.keys))
      throw new TypeError('Invalid graph binding in '+label);
  }
  for (const [name,node] of named(nodes,label+' nodes')) {
    fields(node,['op','params','inputs',...(groupOperators.includes(node?.op) ? ['group'] :
      node?.op==='data.typed' ? ['type'] : [])],'node '+name);
    if (!id(node.op)) throw new TypeError('Invalid operation for node '+name);
    if (node.group!==undefined && !id(node.group)) throw new TypeError('Invalid group for node '+name);
    for (const [,value] of [...named(node.inputs??{},'node inputs'),...named(node.params??{},'node parameters')]) binding(value);
  }
  named(inputs,label+' parameters');
  for (const [,value] of named(outputs,label+' outputs')) binding(value);
  return {inputs,nodes,outputs};
}

function select(frame, output, subpath) {
  if (!Object.hasOwn(frame.outputs,output)) throw new RangeError('Unknown graph output '+output);
  let value = frame.outputs[output];
  for (const key of subpath) {
    if (value===null || (typeof value!=='object' && typeof value!=='string') || !Object.hasOwn(value,key))
      return {found:false};
    value=value[key];
  }
  return {found:true,value};
}

function prepareAssertions(rows, plan) {
  const compares = {
    eq: sameValue, ne:(a,b)=>!sameValue(a,b),
    min:(a,b)=>Number.isFinite(a) && a>=b, max:(a,b)=>Number.isFinite(a) && a<=b
  };
  if (!Array.isArray(rows)) throw new TypeError('Graph assertions need an array');
  const ids = new Set();
  return Array.from(rows,definition=>{
    const {id:name,output,path:subpath=[],op,value}=fields(definition,['id','output','path','op','value'],'graph assertion');
    if (!id(name) || ids.has(name) || !id(output) || !Object.hasOwn(plan.outputs,output) ||
        !Object.hasOwn(compares,op) && op!=='sha256' ||
        !Object.hasOwn(definition,'value') || !Array.isArray(subpath) || !Array.from(subpath).every(key=>
          typeof key==='string' || Number.isSafeInteger(key) && key>=0) ||
        (op==='min' || op==='max') && !Number.isFinite(value) ||
        op==='sha256' && (typeof value!=='string' || !/^[0-9a-f]{64}$/.test(value)))
      throw new TypeError('Invalid or duplicate graph assertion '+name);
    ids.add(name);
    return frame=>{
      const {found,value:actual}=select(frame,output,subpath);
      let error, measured=actual;
      let passed=false;
      try {
        if (found && op==='sha256') {
          measured=sha256(Number.isSafeInteger(actual?.width) && actual.data ? imageBytes(actual) : jsonBytes(actual));
          passed=measured===value;
        } else if (found) passed=compares[op](actual,value);
      }
      catch (cause) { error=cause.message; }
      return {id:name,output,path:subpath,op,expected:describe(value),found,actual:found ? describe(measured) : null,
        passed,...(error && {error})};
    };
  });
}

function nativeOperations(kit, assets) {
  const binary = (fn, type='number') => ({inputs:{a:'number',b:'number'},outputs:{value:type},run(args){return {value:fn(args)};}});
  function asset(type, accepts) {
    return {inputs:{name:'string'},outputs:{value:type},run({name}){
      const entry=assets.get(name);
      if (!entry || !accepts(entry)) throw new RangeError('Unknown '+type+' graph asset '+name);
      return {value:entry.value};
    }};
  }
  return {
    add:binary(({a,b})=>a+b),
    multiply:binary(({a,b})=>a*b),
    lessThan:binary(({a,b})=>a<b,'boolean'),
    time:{time:true,outputs:{value:'number'},run(_,ctx){return {value:ctx.time};}},
    random:{outputs:{value:'number'},run(_,ctx){return {value:kit.KIT.grow.dice(ctx.seed)()};}},
    ...require('./graph-render.js').graph3DOperations(kit),
    pngAsset:asset('image', entry => entry.format==='png'),
    jsonAsset:asset('any', entry => entry.format==='json'),
    audioAsset:asset('audio', entry => entry.type==='audio'),
    rasterAsset:asset('raster', entry => entry.type==='raster'),
    inputAsset:asset('record', entry => entry.format==='inputs')
  };
}

function snapshotInputs(inputs, clone) {
  const active=new Set();
  function copy(value) {
    // Existing compiled toolkit handles and native sample buffers keep their identity.
    if (typeof value==='function' || typeof value?.sample==='function' || typeof value?.snapshot==='function' ||
        ArrayBuffer.isView(value)) return value;
    if (!Array.isArray(value) && !record(value)) return clone(value);
    if (active.has(value)) throw new TypeError('Graph inputs contain a cycle');
    active.add(value);
    const result=Array.isArray(value) ? Array.from(value,copy) :
      Object.fromEntries(Object.entries(value).map(([key,item])=>{
        if (['__proto__','constructor','prototype'].includes(key)) throw new TypeError('Unsafe graph input key '+key);
        return [key,copy(item)];
      }));
    active.delete(value);
    return Object.freeze(result);
  }
  return Object.fromEntries(Object.entries(inputs).map(([name,value])=>[name,copy(value)]));
}

function sweepCases(definition, broadcast) {
  const {sweep,idPrefix='case',limit=256}=fields(definition,['sweep','idPrefix','limit'],'graph sweep');
  if (!id(idPrefix)) throw new TypeError('Graph sweep needs a valid ID prefix');
  const {inputs={},time,seed}=fields(sweep,['inputs','time','seed'],'graph sweep axes');
  const axes={...Object.fromEntries(named(inputs,'sweep parameter axes').map(([name,values])=>['inputs.'+name,values])),
    ...(time!==undefined && {time}),...(seed!==undefined && {seed})};
  const rows=broadcast(axes,{mode:'cartesian',limit});
  if (!rows.length) throw new RangeError('Graph sweep axes must contain at least one value each');
  const digits=Math.max(3,String(rows.length).length);
  return {cases:rows.map(({time,seed,...values},i)=>({
    id:idPrefix+'-'+String(i+1).padStart(digits,'0'),
    inputs:Object.fromEntries(Object.entries(values).map(([key,value])=>[key.slice(7),value])),
    ...(time!==undefined && {time}),...(seed!==undefined && {seed})
  })), report:{mode:'cartesian',axes:Object.keys(axes).sort().map(name=>({name,count:axes[name].length})),
    count:rows.length,limit}};
}

function cacheReport(frame) {
  const nodes = {};
  function collect(result, prefix, cached) {
    for (const [name,status] of Object.entries(result.status)) {
      const hit=cached || status==='cached';
      nodes[prefix+name]=hit ? 'cached' : 'evaluated';
      const nested=result.inspectGroup(name);
      if (nested) collect(nested,prefix+name+'/',hit);
    }
  }
  collect(frame,'',false);
  const hits=Object.values(nodes).filter(status=>status==='cached').length;
  return {hits,misses:Object.keys(nodes).length-hits,nodes};
}

function createGraphProject(source, { kit=require('../index.js').load(), baseDir=process.cwd(), operations={}, adapters={}, sourceFile }={}) {
  const {graph,data,mediaGraph}=kit.KIT.procedural;
  const host=createGraphHost(adapters,{kit});
  const {broadcast}=graph.arrays;
  const groupOperators=[...graph.arrays.groupOperators,...kit.KIT.procedural.animationGraph.groupOperators];
  const project=data.freeze(data.clone(source));
  const {format:kind,version:revision,groups:definitions={},assets:assetDefinitions={},exports:exportsSpec={},
    assertions:assertionSpecs=[],time=0,seed=0,...root}=fields(project,
    ['format','version','inputs','nodes','outputs','groups','assets','exports','assertions','time','seed'],'graph project');
  if (kind!==format || revision!==version) throw new TypeError('Expected ink-studio/graph-project version 1');
  const spec=graphSpec(root,'project graph',groupOperators);
  const paths=new Set(sourceFile ? [path.resolve(sourceFile)] : []);
  const groupSpecs=new Map(named(definitions,'groups').map(([name,value])=>{
    if (typeof value==='string' && value.length) {
      const file=path.resolve(baseDir,value);
      paths.add(file);
      const {format,version,...spec}=JSON.parse(fs.readFileSync(file,'utf8'));
      if (format!=='ink-studio/graph-group' || version!==1)
        throw new TypeError('Expected ink-studio/graph-group version 1 in '+value);
      return [name,graphSpec(spec,'group '+name,groupOperators)];
    }
    return [name,graphSpec(value,'group '+name,groupOperators)];
  }));
  const assets=new Map(named(assetDefinitions,'assets').map(([name,definition])=>{
    const {format,file,type,codec,options}=fields(definition,
      definition?.format==='codec' ? ['format','file','type','codec','options'] : ['format','file'],'graph asset '+name);
    if (!['png','json','wav','inputs','codec'].includes(format) || typeof file!=='string' || !file)
      throw new TypeError('Graph assets need a PNG, JSON, WAV, input recording or hosted codec file');
    const full=path.resolve(baseDir,file);
    paths.add(full);
    if ((format==='wav' || format==='codec') && fs.statSync(full).size>WAV.maxBytes)
      throw new RangeError('Graph media asset exceeds its byte budget');
    const bytes=fs.readFileSync(full);
    let value, kind;
    if (format==='png') {
      const {w,h,data,max}=PNG.raster(bytes);
      value={width:w,height:h,data:max===255 ? data : Uint8Array.from(data,n=>Math.round(n*255/max))};
      kind='raster';
    } else if (format==='wav') {
      value=WAV.decode(bytes);
      kind='audio';
    } else if (format==='codec') {
      value=host.decode(codec,bytes,{type,file:full,options});
      kind=type;
    } else {
      const parsed=JSON.parse(bytes.toString('utf8'));
      value=format==='inputs' ? mediaGraph.recording(parsed) : data.freeze(data.clone(parsed));
    }
    return [name,{format,file,sha256:sha256(bytes),value,...(kind && {type:kind}),...(codec && {codec})}];
  }));
  const stock=nativeOperations(kit,assets);
  const ops={...stock,...Object.fromEntries(named(operations,'host operations'))};
  const groups=Object.create(null), preparedGroups=new Map(), visiting=new Set();

  function compile(spec) {
    let expandedNodes=Object.keys(spec.nodes).length;
    for (const {op,group} of Object.values(spec.nodes)) {
      const dependency=groupOperators.includes(op) ? group : op;
      if (groupSpecs.has(dependency)) expandedNodes+=compileGroup(dependency).expandedNodes;
    }
    if (expandedNodes>maxNodes) throw new RangeError('Expanded graph exceeds its '+maxNodes+' node budget');
    const compiled=graph.create(spec,{operations:ops,groups,planOnly:true}), plan=compiled.plan();
    for (const {id,op,inputs} of plan.nodes) {
      if (ops[op]!==stock[op] || !['pngAsset','jsonAsset','audioAsset','rasterAsset','inputAsset'].includes(op) ||
          inputs.name.source.kind!=='value') continue;
      const node=spec.nodes[id], definition=node.inputs?.name ?? node.params?.name;
      const name=record(definition) ? definition.value : definition;
      try { stock[op].run({name}); }
      catch (error) { throw new RangeError('Unknown graph asset '+name+' at '+id,{cause:error}); }
    }
    return {compiled,plan:{...plan,expandedNodes}};
  }

  function compileGroup(name) {
    if (preparedGroups.has(name)) return preparedGroups.get(name);
    if (visiting.has(name)) throw new Error('Graph group cycle at '+name);
    if (Object.hasOwn(ops,name) || Object.hasOwn(graph.operations??{},name))
      throw new Error('Graph group name conflicts with an operation: '+name);
    visiting.add(name);
    const spec=groupSpecs.get(name), {plan}=compile(spec);
    visiting.delete(name);
    const outputs=Object.fromEntries(Object.entries(plan.outputs).map(([key,link])=>[key,link.type]));
    groups[name]={...graph.group(spec,{operations:ops,groups,outputs}),expandedNodes:plan.expandedNodes};
    preparedGroups.set(name,plan);
    return plan;
  }

  for (const name of groupSpecs.keys()) compileGroup(name);
  const {compiled,plan:rootPlan}=compile(spec);
  const exports=named(exportsSpec,'exports').map(([name,definition])=>{
    const {output,format,encoding,type,codec,options}=fields(definition,definition?.format==='wav' ?
      ['output','format','encoding'] : definition?.format==='codec' ? ['output','format','type','codec','options'] :
      ['output','format'],'graph export '+name);
    if (!id(output) || !Object.hasOwn(rootPlan.outputs,output) || !['png','json','atlas','wav','codec'].includes(format))
      throw new TypeError('Graph export '+name+' needs a known output and png, json, atlas, wav or codec format');
    const port=rootPlan.outputs[output].type, compatible=kit.KIT.procedural.graphTypes.compatible;
    if (format==='png' && !compatible(port,'raster')) throw new TypeError('Graph PNG export '+name+' needs an image output');
    if (format==='atlas' && !compatible(port,'atlas')) throw new TypeError('Graph atlas export '+name+' needs an atlas output');
    if (format==='wav' && (!compatible(port,'audio') || encoding!==undefined && !WAV.encodings.includes(encoding)))
      throw new TypeError('Graph WAV export '+name+' needs audio and a supported PCM encoding');
    if (format==='codec' && (!['audio','raster'].includes(type) || !compatible(port,type) || !id(codec) ||
        options!==undefined && !record(options))) throw new TypeError('Graph codec export '+name+' needs typed media and a named codec');
    if (format==='codec') host.requireCodec(codec,'encode');
    return {name,output,format,...(encoding && {encoding}),...(codec && {type,codec,...(options && {options})})};
  });
  separateNames(exports.map(entry=>entry.name),'Graph exports');
  const assertions=prepareAssertions(assertionSpecs,rootPlan);
  const assetInfo=Object.fromEntries([...assets].map(([name,{value,...entry}])=>[name,{...entry,...(entry.type==='raster' &&
    {width:value.width,height:value.height}),...(entry.type==='audio' && {
      sampleRate:value.sampleRate,channels:value.channels,frames:value.samples.length/value.channels
    })}]));
  const projectHash=sha256(jsonBytes({project,groups:Object.fromEntries(groupSpecs),assets:assetInfo}));
  const header={format:reportFormat,version,projectHash};

  function clock(t,s) {
    if (!Number.isFinite(t) || !Number.isSafeInteger(s)) throw new TypeError('Graph time must be finite and seed must be an integer');
    return {time:t,seed:s};
  }
  clock(time,seed);
  const projectPlan={...header,kind:'plan',...rootPlan,time,seed,assets:assetInfo,exports,assertions:assertionSpecs,
    groups:Object.fromEntries(preparedGroups),hostOperations:Object.keys(operations).sort()};
  let executable, previous=new Map();

  function request(options={}) {
    const {inputs={},time:t=time,seed:s=seed}=fields(options,['inputs','time','seed'],'graph run options');
    const resolved=clock(t,s);
    for (const [name] of named(inputs,'input values'))
      if (!Object.hasOwn(rootPlan.inputs,name)) throw new RangeError('Unknown graph input '+name);
    return {...resolved,inputs:compiled.parameters(snapshotInputs(inputs,data.clone))};
  }

  function clear() {
    try { executable?.clear(); }
    finally {
      executable=undefined;
      previous=new Map();
    }
  }

  function evaluate({inputs,time,seed}) {
    const values=Object.fromEntries(Object.entries(inputs).map(([name,value])=>{
      const prior=previous.get(name);
      return [name,sameValue(prior,value) ? prior : value];
    }));
    try {
      executable??=graph.create(spec,{operations:ops,groups});
      const frame=executable.evaluate(values,{time,seed});
      previous=new Map(Object.entries(values));
      return {frame,report:{...header,time,seed,cache:cacheReport(frame),
        inputs:Object.fromEntries(Object.entries(values).map(([name,value])=>[name,describe(value)]))}};
    } catch (error) {
      try { clear(); } catch { /* Preserve the evaluation error after discarding this instance. */ }
      throw error;
    }
  }

  function encode(name,value,format,settings={}) {
    const result=format==='codec' ? host.encode(settings.codec,value,settings) : undefined;
    const bytes=result?.bytes ?? (format==='png' ? imageBytes(value) :
      format==='wav' ? WAV.encode(value,settings) : jsonBytes(value));
    return {file:'artifacts/'+name+'.'+(result?.extension ?? format),format,sha256:sha256(bytes),bytes};
  }

  function encodeAtlas(name,value) {
    const {spriteAtlasManifest}=require('./sprite-atlas.js'), location='artifacts/'+name+'/', images=new Map();
    const manifest=spriteAtlasManifest(value,(width,height,rgba)=>{
      const bytes=PNG.encode(width,height,rgba,4), hash=sha256(bytes), file='images/'+hash+'.png';
      images.set(file,{file:location+file,format:'png',sha256:hash,bytes});
      return file;
    });
    const bytes=jsonBytes(manifest);
    return [...images.values(),{file:location+'atlas.json',format:'json',sha256:sha256(bytes),bytes}];
  }

  function run(prepared) {
    const {frame,report}=evaluate(prepared);
    const checks=assertions.map(check=>check(frame)), passed=checks.every(check=>check.passed);
    const artifacts=exports.flatMap(({name,output,format,...settings})=>{
      const value=frame.outputs[output], encoded=format==='atlas' ? encodeAtlas(name,value) : [encode(name,value,format,settings)];
      return encoded.map(artifact=>({name,output,...artifact}));
    });
    return {outputs:frame.outputs,artifacts,report:{...report,kind:'run',passed,assertions:checks,
      outputs:Object.fromEntries(Object.entries(frame.outputs).map(([name,value])=>[name,describe(value)])),
      artifacts:artifacts.map(({bytes,...entry})=>({...entry,bytes:bytes.length}))}};
  }

  function inspect(target,options) {
    const {output,node,port='value'}=fields(target,['output','node','port'],'graph inspection target');
    if ((output===undefined)===(node===undefined) || output!==undefined && !id(output) ||
        node!==undefined && (typeof node!=='string' || !node.split('/').every(id) || !id(port)))
      throw new TypeError('Inspect one named graph output or one node and port');
    const {frame,report}=evaluate(request(options));
    const value=output!==undefined ? select(frame,output,[]).value : frame.preview(node,port);
    const {file,format,sha256,bytes}=preview(value)??{};
    return {value,artifacts:bytes ? [{file,format,sha256,bytes}] : [],
      report:{...report,kind:'inspect',target:output!==undefined ? {output} : {node,port},value:describe(value),
        artifacts:bytes ? [{file,format,sha256,bytes:bytes.length}] : []}};
  }

  function preview(value) {
    if (Number.isSafeInteger(value?.sampleRate) && value.samples) {
      try { return encode('preview',value,'wav'); }
      catch { /* Fall through to the generic data preview. */ }
    }
    if (Number.isSafeInteger(value?.width) && value.data) {
      try { return encode('preview',value,'png'); }
      catch { /* Numeric raster channels can be inspected as JSON. */ }
    }
    try { return encode('preview',value,'json'); }
    catch { return null; }
  }

  function planValue(value) {
    try { return data.clone(value); }
    catch { return describe(value); }
  }

  return Object.freeze({
    plan:inputs=>({
      ...data.clone(projectPlan),
      ...(inputs!==undefined && {resolvedInputs:Object.fromEntries(Object.entries(request({inputs}).inputs)
        .map(([name,value])=>[name,planValue(value)]))})
    }),
    validate(inputs) {
      if (inputs!==undefined) request({inputs});
      return {...header,kind:'validate',valid:true,nodes:rootPlan.expandedNodes,groups:preparedGroups.size};
    },
    run:options=>run(request(options)),
    inspect,
    batch(cases,defaults={}) {
      fields(defaults,['inputs','time','seed'],'graph batch defaults');
      if (defaults.inputs!==undefined) named(defaults.inputs,'batch input values');
      const sweep=Array.isArray(cases) ? null : sweepCases(cases,broadcast);
      const rows=sweep?.cases ?? cases;
      if (!rows.length) throw new TypeError('Graph batch needs a nonempty case array');
      const prepared=Array.from(rows,row=>{
        const {id:name,inputs={},...options}=fields(row,['id','inputs','time','seed'],'graph batch case');
        if (!id(name)) throw new TypeError('Graph batch case needs an ID');
        named(inputs,'case input values');
        return {name,request:request({...defaults,...options,inputs:{...defaults.inputs,...inputs}})};
      });
      separateNames(prepared.map(row=>row.name),'Graph batch cases');
      const results=prepared.map(row=>({id:row.name,...run(row.request)}));
      return {results,report:{...header,kind:'batch',passed:results.every(row=>row.report.passed),
        ...(sweep && {sweep:sweep.report}),
        cases:results.map(({id,report})=>({id,directory:'cases/'+id,...report}))}};
    },
    clear,
    sourceFiles:()=>[...paths]
  });
}

function readGraphProject(file, options={}) {
  const sourceFile=path.resolve(file);
  return createGraphProject(JSON.parse(fs.readFileSync(sourceFile,'utf8')),
    {...options,baseDir:path.dirname(sourceFile),sourceFile});
}

module.exports = { createGraphProject, readGraphProject };
