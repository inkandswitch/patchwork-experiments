/* Bounded causal provenance for actual world decisions and signal samples. */
(function (K) {
  const W = K.world, {check,record,id,own,copy,equal} = W.data, freeze = K.procedural.data.freeze;
  const fanIn = 64, clipped = 'omitted', validRef = value => typeof value==='string' &&
    (value===clipped || /^c\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,6})$/.test(value));
  const parts = ref => ref.slice(2).split('.').map(Number);
  function earlier(a,b) {
    if (a===clipped) return true;
    const [ta,ia]=parts(a), [tb,ib]=parts(b);
    return ta<tb || ta===tb && ia<ib;
  }
  function refs(values) {
    const unique = [...new Set(values)];
    if (unique.length<=fanIn) return unique;
    return [...unique.filter(value=>value!==clipped).slice(0,fanIn-1),clipped];
  }
  function policy(value) {
    if (value===undefined || value===false) return null;
    check(value===true || record(value) && Object.keys(value).every(key=>key==='limit'||key==='inspection') &&
      (value.inspection===undefined||typeof value.inspection==='boolean'),
      'Causality needs true or a retention policy');
    const limit = value.limit ?? 2048;
    check(Number.isSafeInteger(limit) && limit>=1 && limit<=20000,'Causality limit must be 1–20000');
    return {limit,inspection:value.inspection===true};
  }
  const empty = freeze({nodes:[],dropped:0,outputs:{},inputs:{},manual:{},delays:{},buffers:{},actions:{}});
  const carries = (value,type) => type==='event' ? value.length>0 : type==='vec3' ? value.some(Boolean) : value!==0;

  function begin(previous,tick,ports,incoming,{limit,inspection}) {
    const pending=[], retained=new Map(previous.nodes.map(row=>[row.id,row]));
    let outputHeads={...previous.outputs}, staged={}, ordinal=0;
    const inputHeads={...previous.inputs}, manual={...previous.manual},
      delays={...previous.delays}, buffers={...previous.buffers}, actions={...previous.actions};
    const delayed={};
    const balanceHeads=inspection&&new Map(previous.nodes.filter(row=>row.type==='state'&&row.kind==='account-balance')
      .map(row=>[row.data.account,row]));
    function add(type,system,kind,data,parents=[],location={}) {
      const index=ordinal++, ref='c.'+tick+'.'+index;
      check(Array.isArray(parents) && parents.every(parent=>validRef(parent)&&earlier(parent,ref)),
        'Invalid or forward causal reference');
      const causes=refs(parents);
      const row=freeze({id:ref,tick,type,system,kind,data:copy(data),parents:causes,...location});
      const slot=index%limit;
      if (pending[slot]) retained.delete(pending[slot].id);
      pending[slot]=row;
      retained.set(ref,row);
      return ref;
    }
    function input(name,port,value,sample,location) {
      const parents=sample.parents, before=retained.get(inputHeads[port]);
      const data={value,source:sample.source??null,delay:sample.delay??0,sample:sample.mode??'hold'};
      if (before?.type==='input' && equal(before.data,data) && equal(before.parents,parents)) return before.id;
      const ref=add('input',name,'signal-sampled',data,parents,{port,...location});
      inputHeads[port]=ref;
      return ref;
    }
    function delayedRefs(port) {return delays[port]?.[0]??[];}
    function held(port,edge,live) {
      if (!edge) return manual[port]??[];
      if (edge.delay) return delayedRefs(port);
      const ref=(live?staged:outputHeads)[edge.from];
      return ref?[ref]:[];
    }
    function collect(port,parents) {
      if (parents.length) buffers[port]=refs([...(buffers[port]??[]),...parents]);
    }
    function consume(port) {
      const parents=buffers[port]??[];
      delete buffers[port];
      return parents;
    }
    function publish(port,value) {
      if (!staged[port]) return;
      for (const edge of reducers.get(port)??[]) {
        const type=ports.inputs[edge.to].type;
        if (!carries(value,type)) continue;
        if (edge.delay) delayed[edge.to]=refs([...(delayed[edge.to]??[]),staged[port]]);
        else collect(edge.to,[staged[port]]);
      }
    }
    const reducers=new Map();
    for (const edge of incoming.values()) if (W.rates.buffered(edge)) {
      if (!reducers.has(edge.from)) reducers.set(edge.from,[]);
      reducers.get(edge.from).push(edge);
    }

    function scope(system,values,sources,query,{root,substep,queryTick=tick,queryTime}={}) {
      const attached=Object.create(null), observed=Object.create(null);
      const location=substep===undefined?{}:{substep};
      const actionCauses=root?[root]:own(actions,system)?actions[system]:[];
      function sample(key) {
        check(own(values,key),'Unknown causal input '+system+'/'+key);
        const port=system+'/'+key;
        return observed[key]??=input(system,port,values[key],sources[key],location);
      }
      const all = () => refs([...actionCauses,...Object.keys(values).map(sample)]);
      const api=Object.freeze({
        input:sample,
        previous(key) {return outputHeads[system+'/'+key]??null;},
        record(kind,data,{inputs=[],causes=[],outputs=[]}={}) {
          check(id(kind) && record(data) && [inputs,causes,outputs].every(Array.isArray) &&
            causes.every(validRef) && outputs.every(key=>own(ports.outputs,system+'/'+key)),'Invalid causal decision');
          const ref=add('decision',system,kind,data,[...actionCauses,...inputs.map(sample),...causes],location);
          for(const key of outputs) attached[key]=ref;
          return ref;
        },
        read(field,at,args) {
          const result=query.probe(field,at,{...args,explain:true});
          const ref=add('reading',system,'field-read',{field,at:at??null,queryTick,...(queryTime!==undefined && {queryTime}),result},
            [],location);
          return {result,cause:ref};
        }
      });
      return {api, emitParents:all, all, attached, location};
    }
    function output(system,key,value,source,previousValue) {
      const port=system+'/'+key, before=outputHeads[port], cause=source.attached[key];
      const type=ports.outputs[port].type;
      const pulse=(type==='event'||reducers.get(port)?.some(edge=>edge.sample==='sum')) && carries(value,type);
      const held=before&&!cause&&!pulse&&equal(previousValue,value);
      if (held && retained.has(before)) staged[port]=before;
      else staged[port]=add('output',system,'signal-published',{value},cause?[cause]:held?[before]:source.all(),
        {port,basis:cause?'decision':held?'held':'observed-inputs',...source.location});
    }
    function completePhase() {
      Object.assign(outputHeads,staged);
      staged={};
    }
    function balance(before,after,transfer,at) {
      const {name:account,resource,units}=after, system=W.data.endpoint(account)[0];
      const last=balanceHeads.get(account);
      const detail={account,resource,units,at};
      const prior=last&&equal(last.data.balance,before.balance)?last.id:
        add('state',system,'balance-before-transfer',{...detail,balance:before.balance},[],{basis:'observed'});
      const balance=after.balance, ref=add('state',system,'account-balance',{...detail,balance,
        previous:before.balance},[prior,transfer],{basis:'settled-transfer'});
      balanceHeads.set(account,{id:ref,data:{balance}});
    }
    function finish() {
      completePhase();
      for (const [port,descriptor] of Object.entries(ports.inputs))
        if (descriptor.type==='event') delete manual[port];
      for (const edge of incoming.values()) if (edge.delay) {
        const parents=W.rates.buffered(edge)?delayed[edge.to]??[]:
          outputHeads[edge.from]?[outputHeads[edge.from]]:[];
        delays[edge.to]=[...delays[edge.to].slice(1),parents];
      }
      const start=ordinal>limit?ordinal%limit:0;
      const all=previous.nodes.concat(pending.slice(start),pending.slice(0,start));
      return freeze({nodes:all.slice(-limit),dropped:previous.dropped+previous.nodes.length+ordinal-Math.min(limit,all.length),
        outputs:outputHeads,inputs:inputHeads,manual,delays,buffers,actions});
    }

    return {scope,output,completePhase,publish,collect,consume,held,delayedRefs,finish,...(inspection&&{balance}),
      ran:name=>{delete actions[name];},
      action(system,ref) {actions[system]=refs([...(own(actions,system)?actions[system]:[]),ref]);},
      manual(port,ref,append) {manual[port]=append?refs([...(manual[port]??[]),ref]):[ref];},
      command:(system,item)=>add('command',system,'scheduled-command',{action:item.action,args:item.args,
        ...(item.id!==undefined && {commandId:item.id})}),
      event:(row,causes,location,basis)=>add('event',row.system,row.kind,row,causes,{event:row.id,basis,...location})};
  }

  function initial(ports,incoming,values,{limit}) {
    const nodes=[], outputs={}, inputs={}, manual={}, delays={}, defaults={};
    function root(type,port,value) {
      const ref='c.0.'+nodes.length;
      nodes.push({id:ref,tick:0,type,system:port.split('/')[0],kind:'initial-signal',port,data:{value},parents:[]});
      return ref;
    }
    for (const [port,descriptor] of Object.entries(ports.inputs)) {
      inputs[port]=root('input',port,descriptor.default);
      if (!incoming.has(port)) manual[port]=[inputs[port]];
    }
    for (const port of Object.keys(ports.outputs)) outputs[port]=root('output',port,values[port]);
    for (const edge of incoming.values()) if (edge.delay) {
      const value=ports.outputs[edge.from].default;
      const parents=W.rates.buffered(edge)?[]:[equal(value,values[edge.from])?outputs[edge.from]:
        defaults[edge.from]??=root('default',edge.from,value)];
      delays[edge.to]=Array(edge.delay).fill(parents);
    }
    return freeze({...empty,nodes:nodes.slice(-limit),dropped:Math.max(0,nodes.length-limit),outputs,inputs,manual,delays});
  }

  function validate(state,tick,ports,incoming,systems,{limit}) {
    check(record(state) && Array.isArray(state.nodes) && state.nodes.length<=limit &&
      Number.isSafeInteger(state.dropped) && state.dropped>=0,'Malformed causal checkpoint');
    const before='c.'+(tick+1)+'.0';
    const reference=value=>validRef(value)&&earlier(value,before);
    const references=list=>Array.isArray(list)&&list.length<=fanIn&&list.every(reference);
    let prior;
    for(const row of state.nodes) {
      check(record(row) && row.id!==clipped && reference(row.id) && (!prior||earlier(prior,row.id)) &&
        parts(row.id)[0]===row.tick && id(row.system) && id(row.kind) && record(row.data) &&
        references(row.parents) && row.parents.every(ref=>earlier(ref,row.id)),'Invalid saved causal node');
      prior=row.id;
    }
    for(const [bag,keys,match,complete] of [
      [state.outputs,ports.outputs,reference,true],[state.inputs,ports.inputs,reference,true],
      [state.manual,ports.inputs,references,false],[state.buffers,ports.inputs,references,false],
      [state.actions,systems,references,false]
    ]) check(record(bag) && (!complete||Object.keys(bag).length===Object.keys(keys).length) &&
      Object.entries(bag).every(([key,value])=>own(keys,key)&&match(value)),'Invalid saved causal references');
    const delayed=[...incoming.values()].filter(edge=>edge.delay);
    check(record(state.delays) && Object.keys(state.delays).length===delayed.length && delayed.every(edge=>
      Array.isArray(state.delays[edge.to]) && state.delays[edge.to].length===edge.delay &&
      state.delays[edge.to].every(references)),'Invalid saved delayed causal references');
  }

  function trace(state,world,tick,args,entity) {
    const {id:ref,event,port,kind,system,direction,atTick=tick,maxDepth=32,limit=256}=args;
    const key=port===undefined?null:W.data.portOf(world,port);
    const portType=direction??(key!==null&&own(state.outputs,key)?'output':'input');
    check([ref,event,port,kind].filter(value=>value!==undefined).length===1 &&
      [ref,event,port,kind,system,entity].every(value=>value===undefined || typeof value==='string') &&
      (direction===undefined || key!==null&&['input','output'].includes(direction)) &&
      Number.isSafeInteger(atTick)&&atTick>=0&&atTick<=tick && Number.isSafeInteger(maxDepth)&&maxDepth>=0&&maxDepth<=256 &&
      Number.isSafeInteger(limit)&&limit>=1&&limit<=2000,
    'Causal trace needs one of id, event, port or kind and a bounded tick or traversal limit');
    const root=state.nodes.findLast(row=>row.tick<=atTick && (system===undefined||row.system===system) &&
      (entity===undefined||[row.data.entity,row.data.body,row.data.place].includes(entity)) &&
      (ref!==undefined?row.id===ref:event!==undefined?row.event===event:key!==null?row.port===key&&row.type===portType:row.kind===kind));
    if (!root) return W.query.missing(state.dropped?'No matching retained cause':'No matching cause','missing');
    const {status,...graph}=walk(state,[root.id],maxDepth,limit);
    return W.query.ok({status,root:root.id,...graph});
  }
  function walk(state,roots,maxDepth,limit) {
    const byId=new Map(state.nodes.map(row=>[row.id,row])), nodes=[], gaps=[], edges=[], visited=new Set();
    const queue=roots.map(ref=>[ref,0,null]);
    for(let i=0;i<queue.length;i++){
      const [ref,depth,child]=queue[i], row=byId.get(ref);
      if(child) edges.push({effect:child,cause:ref});
      if(visited.has(ref))continue;
      const reason=ref===clipped?'fan-in':!row?'retention':depth>maxDepth?'depth':nodes.length>=limit?'node-budget':null;
      if(reason){gaps.push({id:ref,reason});continue;}
      visited.add(ref);
      nodes.push(row);
      for(const parent of row.parents)queue.push([parent,depth+1,ref]);
    }
    return {status:gaps.length?'partial':'complete',nodes,edges,
      gaps:[...new Map(gaps.map(row=>[row.id,row])).values()],dropped:state.dropped};
  }
  W.causality=Object.freeze({policy,begin,initial,validate,trace,walk});
})(KIT);
