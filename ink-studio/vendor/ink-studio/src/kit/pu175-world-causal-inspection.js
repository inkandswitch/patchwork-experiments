/* Locate recorded causal evidence by world entity or spatial selection. */
(function (K) {
  const W=K.world, {check,record,id,vector,own,equal}=W.data;
  const axesBySize={1:'x',2:'xz',3:'xyz'}, axisNames=['x','y','z','xy','xz','yz','xyz'];
  const overlaps=K.procedural.spatialDependencies.overlaps;

  function area(raw,axes) {
    if(!record(raw))return null;
    const space=raw.axes??axes;
    if(!axisNames.includes(space)||!vector(raw.min,space.length)||!vector(raw.max,space.length)||
      raw.min.some((value,i)=>value>raw.max[i]))return null;
    return {axes:space,min:raw.min,max:raw.max};
  }
  function around(point,radius=0) {
    return {axes:'xyz',min:point.map(n=>n-radius),max:point.map(n=>n+radius)};
  }
  function selection(site,query) {
    if(vector(site))site={point:site};
    check(record(site)&&[site.entity,site.bounds,site.point].filter(value=>value!==undefined).length===1,
      'Causal inspection needs an entity, point or bounds');
    if(site.bounds!==undefined){
      const bounds=area(site.bounds,axesBySize[site.bounds?.min?.length]);
      check(bounds,'Invalid causal inspection bounds');
      const point=[0,0,0];
      for(let i=0;i<bounds.axes.length;i++)point['xyz'.indexOf(bounds.axes[i])]=bounds.min[i]/2+bounds.max[i]/2;
      return {kind:'region',bounds,point};
    }
    if(site.entity!==undefined){
      check(id(site.entity)&&(site.socket===undefined||id(site.socket)),'Invalid causal inspection entity or socket');
      const point=query.target(site)?.point??null;
      return {kind:'entity',entity:site.entity,...(site.socket!==undefined&&{socket:site.socket}),point,
        bounds:point&&around(point)};
    }
    const {point,radius=0}=site;
    check(vector(point)&&Number.isFinite(radius)&&radius>=0&&radius<=1e6,'Invalid causal inspection point or radius');
    return {kind:'region',point,bounds:around(point,radius)};
  }

  function inspect(view,query,accounts,site,args={}) {
    const {world,tick=0,causality:state}=view;
    const {fields=site?.entity!==undefined?['world/position']:[],ports=[],since=0,maxRoots=12,maxDepth=24,limit=140}=args;
    check([fields,ports].every(list=>Array.isArray(list)&&list.length<=16&&Array.from(list).every(v=>typeof v==='string'))&&
      Number.isSafeInteger(since)&&since>=0&&since<=tick&&Number.isSafeInteger(maxRoots)&&maxRoots>=1&&maxRoots<=64&&
      Number.isSafeInteger(maxDepth)&&maxDepth>=0&&maxDepth<=256&&Number.isSafeInteger(limit)&&limit>=maxRoots&&limit<=2000,
    'Invalid causal inspection fields, ports or traversal limits');
    const target=selection(site,query);
    const sameEntity=(entity,socket)=>target.kind==='entity'&&entity===target.entity&&
      (socket===undefined||target.socket===undefined||socket===target.socket);
    function matchAnchor(at,resolve=false) {
      if(!at)return null;
      if(sameEntity(at.entity,at.socket))return 'entity';
      const point=vector(at)?at:vector(at.point)?at.point:resolve?W.worksites.frame(query,at)?.point:null;
      return point&&target.bounds&&overlaps(target.bounds,around(point))?'overlap':null;
    }
    const accountTable=new Map(accounts.map(account=>[account.name,account]));
    const physical=(name,at)=>({kind:'account',name,sample:query.probe('world/account',{}, {account:name}),at});
    const located=accounts.filter(row=>matchAnchor(row.at,true));
    const conditions=[
      ...fields.map(name=>({kind:'field',name,sample:query.probe(name,target.kind==='entity'?
        {entity:target.entity,...(target.socket!==undefined&&{socket:target.socket})}:target.point,{explain:true})})),
      ...ports.map(name=>({kind:'port',name,sample:query.probe('world/signal',{}, {port:name})})),
      ...located.slice(0,64).map(row=>physical(row.name,row.at))
    ];
    const scope={tick,time:view.time??tick*world.dt,target,conditions,omittedAccounts:Math.max(0,located.length-64)};
    if(!state)return W.query.ok({...scope,status:'disabled',roots:[],nodes:[],edges:[],gaps:[],dropped:0});
    const roots=[], keys=new Set(), byId=new Map(state.nodes.map(row=>[row.id,row]));
    function root(ref,match,key) {
      if(!ref||roots.length>=maxRoots||keys.has(key)||roots.some(row=>row.id===ref))return;
      keys.add(key);
      roots.push({id:ref,match});
    }
    for(const condition of conditions)if(condition.kind==='port'&&condition.sample.status==='ok'){
      const port=W.data.portOf(world,condition.name), ref=state.outputs[port]??state.inputs[port];
      if(byId.get(ref)?.tick>=since)root(ref,'port','port:'+port);
      else if(ref&&since===0&&!byId.has(ref))root(ref,'port','port:'+port);
    }
    const latestAccounts=new Map();
    for(const node of state.nodes)if(node.kind==='account-balance'&&node.type==='state')latestAccounts.set(node.data.account,node);
    for(const condition of conditions)if(condition.kind==='account'&&condition.sample.status==='ok'){
      const last=latestAccounts.get(condition.name);
      if(last?.tick>=since&&equal(last.data.balance,condition.sample.value.balance))root(last.id,'account','account:'+condition.name);
    }
    function locate(node) {
      const {data,system,kind}=node, details=node.type==='command'?data.args??{}:data;
      const name=details.body, body=typeof name==='string'&&world.systems[system]?.config?.bodies?.[name];
      if([details.entity,details.body,details.place,body?.entity].some(entity=>sameEntity(entity))||
        Array.isArray(details.paths)&&details.paths.some(path=>Array.isArray(path)&&path[0]==='entities'&&sameEntity(path[1])))return 'entity';
      const at=details.at??details.point??details.position;
      const anchored=matchAnchor(at)??matchAnchor(details.result?.provenance?.worldPoint);
      if(anchored)return anchored;
      if(kind==='transfer'&&[details.from,details.to].some(name=>matchAnchor(accountTable.get(name)?.at)))return 'account';
      const descriptor=kind==='field-edit'?query.field(system+'/'+details.field)?.spatial:null;
      const raw=details.bounds??details.region?.bounds;
      const water=world.systems[system]?.kind==='water';
      const axes=descriptor?.axes??(raw?.min?.length===3?'xyz':water?'xz':undefined);
      const affected=descriptor&&descriptor.space!=='world'?null:area(raw,axes);
      return affected&&target.bounds&&overlaps(target.bounds,affected)?'overlap':null;
    }
    for(let i=state.nodes.length-1;i>=0&&roots.length<maxRoots;i--){
      const node=state.nodes[i];
      if(node.tick<since)break;
      if(node.type==='state'&&node.kind!=='account-balance')continue;
      if(!['state','event','command','decision','reading'].includes(node.type))continue;
      const match=locate(node);
      if(!match)continue;
      const key=node.type==='state'?'account:'+node.data.account:node.type+':'+node.system+':'+
        (node.data.action??node.kind)+':'+(node.data.account??node.data.entity??node.data.field??'');
      root(node.id,match,key);
    }
    return W.query.ok({...scope,roots,...W.causality.walk(state,roots.map(row=>row.id),maxDepth,limit),
      ...(!roots.length&&{status:'unrecorded'})});
  }
  W.causalInspection=Object.freeze({inspect});
})(KIT);
