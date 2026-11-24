/* Durable postings, authored order templates, and a board-owned escrow account. */
(function(K){
  const W=K.world, Q=W.query, {check,record,id,vector,own,endpoint}=W.data;
  const {keys,magnitude,integer,compare}=W.influenceChoices;
  const tick=n=>integer(n,0,10000000);
  const amount=n=>integer(n,0,1e9);
  const statuses=['open','assigned','payable','refundable','completed','withdrawn','expired'];
  const atOK=value=>vector(value)||keys(value,['entity','socket'])&&id(value.entity)&&
    (value.socket===undefined||id(value.socket));
  const lifecycle=['offer-posted','offer-amended','offer-assigned','offer-released','offer-completed',
    'offer-withdrawn','offer-expired','offer-rejected','offer-payment-wait','transfer'];

  function board(config){
    check(keys(config,['templates','funding','interval','routeBudget','maxPairs','retryTicks']),
      'Invalid public influence config');
    const {templates,funding,interval=8,routeBudget=24,maxPairs=4096,retryTicks=30}=config;
    check(record(templates)&&integer(Object.keys(templates).length,1,128)&&integer(interval,1,3600)&&
      integer(routeBudget,1,128)&&integer(maxPairs,1,65536)&&integer(retryTicks,1,3600),'Invalid influence limits');
    if(funding!==undefined){
      check(keys(funding,['treasury','resource','units'])&&id(funding.resource)&&typeof funding.units==='string'&&
        funding.units.trim().length>0,'Invalid influence funding account');
      endpoint(funding.treasury);
    }
    const fields=new Set(), catalog=new Map(Object.entries(templates).map(([name,raw])=>{
      check(id(name)&&keys(raw,['at','order','target','requires'])&&(raw.at===undefined||atOK(raw.at))&&
        record(raw.order)&&id(raw.order.task)&&!own(raw.order,'id')&&(raw.target===undefined||id(raw.target))&&
        Array.isArray(raw.requires??[])&&(raw.requires??[]).length<=12,'Invalid influence template '+name);
      for(const rule of raw.requires??[]){
        check(keys(rule,['field','args','at','when'])&&typeof rule.field==='string'&&rule.field.length>0&&
          (rule.args===undefined||record(rule.args))&&(rule.at===undefined||atOK(rule.at))&&record(rule.when),
          'Invalid influence requirement '+name);
        Q.condition(rule.when,undefined);
        fields.add(rule.field);
      }
      return [name,raw];
    }));

    function orderFor(template,at,label){
      const {order,target}=catalog.get(template);
      return {...order,...(target&&{targets:{...order.targets,[target]:at}}),...(label!==undefined&&{id:label})};
    }
    function spec(args){
      check(keys(args,['offer','template','at','priority','reward','expires'])&&id(args.offer)&&catalog.has(args.template)&&
        atOK(args.at??catalog.get(args.template).at)&&magnitude(args.priority??0)&&amount(args.reward??0)&&
        (!args.reward||funding)&&(args.expires===undefined||tick(args.expires)&&args.expires>0),
        'Invalid influence posting');
    }
    function checkAction(key,args){
      if(key==='post'){spec(args);return;}
      check(id(args.offer),'Invalid influence offer ID');
      if(key==='withdraw')check(keys(args,['offer']),'Invalid influence withdrawal');
      else check(keys(args,['offer','priority','reward'])&&(own(args,'priority')||own(args,'reward'))&&
        (args.priority===undefined||magnitude(args.priority))&&
        (args.reward===undefined||amount(args.reward)&&(!args.reward||funding)),'Invalid influence amendment');
    }
    function validateState(state){
      check(record(state)&&integer(state.serial,0,Number.MAX_SAFE_INTEGER)&&record(state.offers)&&
        Object.keys(state.offers).length<=512&&Array.isArray(state.requests)&&state.requests.length===0&&
        integer(state.escrow,0,Number.MAX_SAFE_INTEGER)&&record(state.scan)&&
        (state.scan.tick===null||tick(state.scan.tick))&&typeof state.scan.limited==='boolean'&&
        typeof state.scan.truncated==='boolean'&&integer(state.scan.cursor,0,Number.MAX_SAFE_INTEGER)&&
        integer(state.scan.routeCursor,0,Number.MAX_SAFE_INTEGER)&&Array.isArray(state.scan.responses)&&
        state.scan.responses.length<=128,'Invalid saved influence board');
      let obligated=0;
      const seen=new Set();
      for(const [name,row] of Object.entries(state.offers)){
        check(record(row)&&row.id===name&&statuses.includes(row.status)&&
          integer(row.revision,1,state.serial)&&!seen.has(row.revision)&&tick(row.posted)&&
          (row.retryAt===undefined||integer(row.retryAt,1,10003600))&&
          (row.withdrawn===undefined||row.withdrawn===true)&&
          (row.closeAs===undefined||['withdrawn','expired'].includes(row.closeAs)),
          'Invalid saved influence offer '+name);
        spec({offer:row.id,template:row.template,at:row.at,priority:row.priority,reward:row.reward,
          ...(row.expires!==undefined&&{expires:row.expires})});
        if(['assigned','payable','completed'].includes(row.status)){
          const owner=row.owner;
          check(record(owner)&&id(owner.system)&&id(owner.agent)&&integer(owner.generation,1,Number.MAX_SAFE_INTEGER)&&
            integer(owner.sequence,1,Number.MAX_SAFE_INTEGER)&&(!row.reward||typeof owner.wallet==='string'),
            'Invalid saved influence assignee '+name);
          if(row.reward)endpoint(owner.wallet);
        }
        if(['open','assigned','payable','refundable'].includes(row.status))obligated+=row.reward;
        seen.add(row.revision);
      }
      check(obligated===state.escrow,'Influence escrow does not match outstanding rewards');
    }
    const actions=Object.fromEntries(['post','amend','withdraw'].map(key=>[key,(state,args)=>{
      check(state.requests.length<1024,'Influence request budget exceeded');
      return {...state,requests:[...state.requests,{key,args}]};
    }]));
    const offers={type:'record',qualified:true,selector:true,read({state,args,query}){
      function report(row){
        const point=query.target(row.at)?.point;
        return {...row,...(point&&{position:point})};
      }
      if(args.offer!==undefined)return own(state.offers,args.offer)?Q.ok(report(state.offers[args.offer])):
        Q.missing('Unknown influence offer','missing');
      return Q.ok(Object.fromEntries(Object.values(state.offers).map(report).filter(row=>Q.condition(args.where,row))
        .sort((a,b)=>compare(a.id,b.id)).map(row=>[row.id,row])));
    }};
    return {initial:()=>({serial:0,escrow:0,offers:{},requests:[],
        scan:{tick:null,limited:false,truncated:false,cursor:0,routeCursor:0,responses:[]}}),
      shareCheckpoint:true,validateState,checkAction,actions,contract:{emits:lifecycle},
      ...(funding&&{accounts:{escrow:{type:'integer',resource:funding.resource,units:funding.units,ownerOnly:true,
        read:state=>({balance:state.escrow}),write:(state,escrow)=>({...state,escrow})}}}),
      checkFields(query){for(const field of fields)check(query.field(field),'Unknown influence requirement '+field);},
      fields:{offers,scan:{type:'record',qualified:true,read:({state})=>Q.ok(state.scan)},
        templates:{type:'record',qualified:true,read:()=>Q.ok(templates)}},
      influenceBoard:{catalog,funding,interval,routeBudget,maxPairs,retryTicks,orderFor}
    };
  }
  W.runtime.register('influence',board);
})(KIT);
