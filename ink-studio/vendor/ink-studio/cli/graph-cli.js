const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const files = require('./asset-files.js');
const { readGraphProject } = require('./graph-project.js');
const host = require('./graph-host-command.js');

const flags = {
  validate:['inputs','json'], plan:['inputs','json'],
  inspect:['inputs','at','seed','out','output','node','port','json'],
  run:['inputs','at','seed','out','json'], batch:['inputs','at','seed','out','json'],
  session:['protocol','out']
};

async function send(value, compact=false) {
  if (!process.stdout.write(JSON.stringify(value,null,compact ? undefined : 2)+'\n')) await once(process.stdout,'drain');
}

function save(directory, result, inputs) {
  const artifacts=result.results ? result.results.flatMap(row=>[
    ...row.artifacts.map(artifact=>({...artifact,file:path.join('cases',row.id,artifact.file)})),
    {file:path.join('cases',row.id,'report.json'),document:row.report}
  ]) : result.artifacts;
  const output=[...artifacts,{file:'report.json',document:result.report}];
  const sources=inputs.map(file=>fs.statSync(file));
  const locations=output.map(entry=>{
    const file=path.resolve(directory,entry.file), stat=fs.statSync(file,{throwIfNoEntry:false});
    if (stat && sources.some(source=>source.dev===stat.dev && source.ino===stat.ino))
      throw new Error('Graph outputs must be separate from source files');
    return {file,entry};
  });
  for (const {file,entry} of locations) {
    if (entry.bytes) files.write(file,entry.bytes);
    else files.json(file,entry.document);
  }
}

async function session(project, directory, inputs) {
  const reader=createInterface({input:process.stdin,terminal:false,crlfDelay:Infinity});
  let sequence=0;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      let request;
      sequence++;
      try {
        request=JSON.parse(line);
        if (!request || Object.getPrototypeOf(request)!==Object.prototype) throw new TypeError('Expected an NDJSON request object');
        const {id,op,...options}=request;
        if (id!==undefined && typeof id!=='string' && !Number.isSafeInteger(id))
          throw new TypeError('Session ID must be a string or integer');
        const empty=()=>{ if (Object.keys(options).length) throw new TypeError('Unexpected options for '+op); };
        if (op==='quit' || op==='clear' || op==='plan') {
          empty();
          if (op==='clear') project.clear();
          await send({id,code:0,...(op==='plan' && {report:project.plan()})},true);
          if (op==='quit') break;
          continue;
        }
        let result;
        if (op==='inspect') {
          const {output,node,port,...settings}=options;
          result=project.inspect({output,node,port},settings);
        } else if (op==='run') result=project.run(options);
        else throw new TypeError('Unknown graph session operation '+op);
        const folder=directory && 'request-'+sequence;
        if (folder) save(path.join(directory,folder),result,inputs);
        await send({id,code:result.report.passed===false ? 2 : 0,report:result.report,...(folder && {folder})},true);
      } catch (error) {
        const id=request?.id;
        await send({...(typeof id==='string' || Number.isSafeInteger(id) ? {id} : {}),code:1,error:error.message},true);
      }
    }
  } finally {
    reader.close();
    process.stdin.pause();
    project.clear();
  }
}

module.exports = async function graphCommand(pos,opt,settings) {
  const [mode,file,caseFile]=pos;
  if (Object.hasOwn(host.commands,mode)) return send(await host.execute(pos,opt,settings),opt.json);
  if (!Object.hasOwn(flags,mode) || pos.length!==(mode==='batch'?3:2) ||
      Object.entries(opt).some(([key,value])=>key!=='adapters' && !flags[mode].includes(key) || (key==='json' ? value!==true : typeof value!=='string' || !value.trim())) ||
      opt.port!==undefined && opt.node===undefined || opt.protocol!==undefined && opt.protocol!=='ndjson')
    throw new TypeError('Use graph validate|plan|inspect|run|batch|session <project.json> [cases-or-sweep.json]. See ink-studio help');
  settings=await host.adapters(opt.adapters,settings);
  const project=readGraphProject(file,settings), sources=project.sourceFiles();
  if (settings.adapterFile) sources.push(settings.adapterFile);
  let inputs, result;
  if (opt.inputs!==undefined) {
    const file=path.resolve(opt.inputs);
    inputs=JSON.parse(fs.readFileSync(file,'utf8'));
    sources.push(file);
  }
  const run={...(opt.inputs!==undefined && {inputs}),...(opt.at!==undefined && {time:Number(opt.at)}),
    ...(opt.seed!==undefined && {seed:Number(opt.seed)})};
  const output=opt.out===undefined ? undefined : path.resolve(opt.out);
  if (mode==='validate') return send(project.validate(inputs),opt.json);
  if (mode==='plan') return send(project.plan(inputs),opt.json);
  if (mode==='session') return session(project,output,sources);
  if (mode==='inspect') result=project.inspect({output:opt.output,node:opt.node,port:opt.port},run);
  else if (mode==='batch') {
    const cases=path.resolve(caseFile);
    sources.push(cases);
    result=project.batch(JSON.parse(fs.readFileSync(cases,'utf8')),run);
  } else result=project.run(run);
  if (output) save(output,result,sources);
  await send(result.report,opt.json);
  if (result.report.passed===false) process.exitCode=2;
};
