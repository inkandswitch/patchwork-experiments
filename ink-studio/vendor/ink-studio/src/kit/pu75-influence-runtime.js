/* Match willing agents with reachable offers and settle funded rewards once. */
(function(K){
  const W=K.world, Q=W.query, {check,own}=W.data;
  const {rank,byBid,compare}=W.influenceChoices;
  const terminal=new Set(['completed','withdrawn','expired']);
  const orderEvents={ 'order-succeeded':'succeeded','order-failed':'failed','order-cancelled':'cancelled' };
  const ownerToken=owner=>owner.system+'/'+owner.agent+'/'+owner.generation+'/'+owner.sequence;
  const agentToken=({system,row})=>system+'/'+row.id;
  const byPosting=(a,b)=>a.posted-b.posted||compare(a.id,b.id);

  function bind({systems,transfers,chunks}){
    const boards=new Map(), clients=new Map();
    for(const [name,provider] of Object.entries(systems)){
      if(!provider.influenceBoard)continue;
      check(!chunks?.managed.has(name),'Influence boards must run outside simulation chunks');
      const spec=provider.influenceBoard, escrow=name+'/escrow';
      if(spec.funding){
        const {from}=transfers.validate({from:spec.funding.treasury,to:escrow,amount:1,mode:'exact'});
        check(!from.ownerOnly,'Influence treasury must accept public transfers');
      }
      boards.set(name,{...spec,escrow});
      clients.set(name,[]);
    }
    for(const [system,provider] of Object.entries(systems)){
      const adapter=provider.influenceResponder;
      if(!adapter)continue;
      const name=adapter.config.board, board=boards.get(name);
      check(board,'Unknown public influence board '+name);
      for(const {agent,profile,wallet} of adapter.config.members){
        for(const template of profile.templates){
          check(board.catalog.has(template),'Unknown public influence template '+template);
          const at=board.catalog.get(template).at??[0,0,0];
          adapter.check({agent,order:board.orderFor(template,at)});
        }
        if(wallet){
          check(board.funding,'Influence wallet requires a funded board');
          const {to}=transfers.validate({from:board.escrow,to:wallet,amount:1,mode:'exact'});
          check(!to.ownerOnly,'Influence wallets must accept public transfers');
        }
      }
      clients.get(name).push({system,adapter});
    }
    if(!boards.size)return null;

    function run(states,ctx){
      let orderResults;
      function result(owner){
        const current=systems[owner.system]?.influenceResponder?.status(states[owner.system],owner);
        if(current!==undefined)return current;
        if(!orderResults){
          orderResults=new Map();
          for(const row of [...ctx.previousEvents,...ctx.events])
            if(own(orderEvents,row.kind)&&row.agent!==undefined)orderResults.set(ownerToken(row),orderEvents[row.kind]);
        }
        return orderResults.get(ownerToken(owner));
      }
      for(const [name,board] of boards){
        const state=states[name];
        if(!state.requests.length&&!Object.values(state.offers).some(row=>!terminal.has(row.status)))continue;
        const offers={...state.offers}, {tick}=ctx, emit=ctx.emit(name);
        let serial=state.serial, scan=state.scan, changed=state.requests.length>0, forceScan=false;
        const refunded=new Set();
        function put(row){offers[row.id]=row;changed=true;}
        function movement(from,to,amount){
          if(!amount)return true;
          return ctx.transfer(name,{from,to,amount,mode:'exact'})?.status==='full';
        }
        function reserve(delta){
          return delta===0||delta>0?
            movement(board.funding?.treasury,board.escrow,delta):
            movement(board.escrow,board.funding?.treasury,-delta);
        }
        function detail(row){return {offer:row.id,revision:row.revision,template:row.template};}
        function remove(row,closeAs){
          if(refunded.has(row.id))return;
          refunded.add(row.id);
          if(reserve(-row.reward)){
            const {closeAs:prior,...rest}=row;
            put({...rest,status:closeAs,closed:tick});
            emit('offer-'+closeAs,detail(row));
          }else if(row.status!=='refundable'){
            put({...row,status:'refundable',closeAs});
            emit('offer-payment-wait',{...detail(row),kindOfPayment:'refund'});
          }
        }
        function reject(offer,reason){emit('offer-rejected',{offer,reason});}

        for(const {key,args} of state.requests){
          const old=own(offers,args.offer)?offers[args.offer]:undefined;
          if(key==='post'){
            if(old&&!terminal.has(old.status)){reject(args.offer,'offer-active');continue;}
            if(!old&&Object.keys(offers).length>=512){reject(args.offer,'offer-capacity');continue;}
            if(args.expires!==undefined&&args.expires<=tick){reject(args.offer,'deadline-passed');continue;}
            const reward=args.reward??0;
            if(!reserve(reward)){reject(args.offer,'funding-unavailable');continue;}
            check(Number.isSafeInteger(serial+1),'Influence revision exhausted');
            const row={id:args.offer,template:args.template,at:args.at??board.catalog.get(args.template).at,
              priority:args.priority??0,reward,posted:tick,revision:++serial,status:'open',
              ...(args.expires!==undefined&&{expires:args.expires})};
            put(row);
            emit('offer-posted',{...detail(row),priority:row.priority,reward});
          }else if(key==='amend'){
            if(old?.status!=='open'||old.expires!==undefined&&tick>=old.expires){reject(args.offer,'offer-not-open');continue;}
            const reward=args.reward??old.reward;
            if(!reserve(reward-old.reward)){reject(args.offer,'funding-unavailable');continue;}
            const {retryAt,...base}=old;
            const row={...base,priority:args.priority??old.priority,reward};
            put(row);
            emit('offer-amended',{...detail(row),priority:row.priority,reward});
          }else if(old?.status==='open')remove(old,'withdrawn');
          else if(old?.status==='assigned'&&!old.withdrawn){
            put({...old,withdrawn:true});
            emit('offer-withdrawn',{...detail(old),accepted:true});
          }else reject(args.offer,'offer-not-open');
          forceScan=true;
        }

        for(const row of Object.values(offers).sort(byPosting)){
          if(row.status==='open'&&tick>=(row.expires??Infinity))remove(row,'expired');
          else if(row.status==='refundable')remove(row,row.closeAs);
          else if(['payable','assigned'].includes(row.status)){
            const outcome=row.status==='payable'?'succeeded':result(row.owner);
            if(outcome==='active')continue;
            if(outcome==='succeeded'){
              if(movement(board.escrow,row.owner.wallet,row.reward)){
                put({...row,status:'completed',closed:tick,paid:row.reward});
                emit('offer-completed',{...detail(row),owner:row.owner,paid:row.reward});
              }else if(row.status!=='payable'){
                put({...row,status:'payable'});
                emit('offer-payment-wait',{...detail(row),kindOfPayment:'reward'});
              }
            }else{
              emit('offer-released',{...detail(row),owner:row.owner,reason:outcome??'order-unavailable'});
              if(row.withdrawn||tick>=(row.expires??Infinity))remove(row,row.withdrawn?'withdrawn':'expired');
              else {
                const {owner,...rest}=row;
                put({...rest,status:'open',retryAt:tick+board.retryTicks});
              }
            }
          }
        }

        const open=Object.values(offers).filter(row=>row.status==='open'&&(row.retryAt??0)<=tick).sort(byPosting);
        if(open.length&&(forceScan||scan.tick===null||tick-scan.tick>=board.interval)){
          const query=ctx.query(), pairs=[], responses=[];
          let truncated=false;
          function note(offer,responder,reason,extra={}){
            if(responses.length<128)responses.push({offer:offer.id,revision:offer.revision,reason,
              ...(responder&&{system:responder.system,agent:responder.row.id,generation:responder.row.generation}),...extra});
            else truncated=true;
          }
          for(const row of open){
            const position=query.target(row.at)?.point;
            if(!position){note(row,null,'target-unavailable');continue;}
            const blocked=(board.catalog.get(row.template).requires??[]).find(rule=>{
              const read=query.probe(rule.field,rule.at??position,rule.args);
              return read.status!=='ok'||!Q.condition(rule.when,read.value);
            });
            if(blocked)note(row,null,'condition-unmet',{field:blocked.field});
            else pairs.push({...row,position});
          }
          const responders=pairs.length?clients.get(name).flatMap(({system,adapter})=>ctx.detailed(system)?
            adapter.rows(states[system]).map(row=>({...row,system,adapter})):[]):[];
          const ranked=rank(responders,pairs,{maxPairs:board.maxPairs,cursor:forceScan?0:scan.cursor,report:note});
          const ordered=ranked.bids.sort(byBid), size=ordered.length;
          const start=size&&!forceScan?scan.routeCursor%size:0;
          const busy=new Set();
          let routes=0, examined=0;
          for(;examined<size;examined++){
            const {offer,responder,score,distance}=ordered[(start+examined)%size];
            if(busy.has(agentToken(responder))||offers[offer.id].status!=='open')continue;
            if(offer.reward){
              const wallet=ctx.balance(responder.wallet);
              if(!wallet||wallet.max!==null&&wallet.max-wallet.balance<offer.reward){
                note(offer,responder,'wallet-capacity',{score,distance});continue;
              }
            }
            if(routes===board.routeBudget)break;
            routes++;
            const {system,adapter,row,wallet}=responder;
            const route=adapter.route(row,offer.position,ctx.context(system,query));
            if(route!=='ok'){note(offer,responder,'unreachable',{score,distance,route});continue;}
            const order=board.orderFor(offer.template,offer.at,'offer.'+offer.revision+'.'+tick);
            const issued=adapter.issue(states[system],row,order,ctx.context(system,query));
            states[system]=ctx.root(issued.state);
            const owner={system,agent:row.id,generation:row.generation,sequence:issued.sequence,...(wallet&&{wallet})};
            const {retryAt,...current}=offers[offer.id];
            put({...current,status:'assigned',owner,accepted:tick,score});
            note(offer,responder,'accepted',{score,distance});
            emit('offer-assigned',{...detail(offer),owner,priority:offer.priority,reward:offer.reward,score,at:offer.position});
            busy.add(agentToken(responder));
          }
          changed=true;
          const routeLimited=examined<size;
          scan={tick,limited:ranked.limited||routeLimited,truncated,cursor:ranked.cursor,
            routeCursor:routeLimited?(start+examined)%size:0,responses};
        }
        if(changed)states[name]=ctx.root({...states[name],serial,offers,requests:[],scan});
      }
    }
    return {run};
  }

  W.influenceRuntime=Object.freeze({bind});
})(KIT);
