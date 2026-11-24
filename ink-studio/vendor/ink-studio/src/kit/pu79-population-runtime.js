/* Commit civic changes before reservations and orders consume the live roster. */
(function(K){
  const W=K.world,{check}=W.data;
  function bind({systems,chunks,transfers}){
    const boards=Object.entries(systems).filter(([,provider])=>provider.populationBoard);
    if(!boards.length)return null;
    const owners=new Set(), accounts=new Map(transfers.describe().map(row=>[row.name,row]));
    for(const [name,{populationBoard:{spec,checkActor}}] of boards){
      check(!chunks?.managed.has(name),'Population clocks run outside simulation chunks');
      for(const roster of spec.rosters){
        check(systems[roster]?.populationActor&&!owners.has(roster),'Population roster is unknown or already bound '+roster);
        owners.add(roster);
      }
      for(const district of Object.values(spec.districts)){
        for(const [resource,account] of Object.entries(district.supply??{})){
          const row=accounts.get(account);
          check(row&&['integer','number'].includes(row.type)&&row.resource===resource&&row.units===spec.resources[resource],
            'Population supply account has incompatible resource or units '+account);
        }
      }
      checkActor((roster,species)=>systems[roster].populationActor.check(species));
    }

    function run(states,ctx){
      let snapshot;
      const representations=new Map();
      const query=()=>snapshot??=ctx.query();
      const solver=name=>systems[name].populationActor;
      const detailed=name=>ctx.detail(name,states[name]);
      const read=({system,agent,generation})=>solver(system).read(detailed(system),agent,generation);
      function write(system,state){
        if(!representations.has(system))representations.set(system,states[system]);
        states[system]=ctx.root(state);
        snapshot=undefined;
      }
      function remove(ref){
        const {system}=ref, state=detailed(system);
        if(!solver(system).read(state,ref.agent,ref.generation))return;
        write(system,solver(system).remove(state,ref,ctx.context(system,query())));
      }
      function spawn({system,...args}){
        const provider=solver(system);
        const prepared=provider.spawn(detailed(system),args,ctx.context(system,query()));
        if(prepared.reason)return {reason:prepared.reason.replace(/^recruit-/,'actor-')};
        write(system,prepared.state);
        const live=provider.read(states[system],args.agent);
        return {actor:{system,agent:live.id,generation:live.generation}};
      }
      for(const [name,{populationBoard}] of boards){
        const before=states[name];
        const next=populationBoard.update(before,{tick:ctx.tick,emit:ctx.emit(name),query,read,remove,spawn});
        if(next!==before){
          states[name]=ctx.root(next);
          snapshot=undefined;
        }
      }
      for(const [system,previous] of representations)states[system]=ctx.retain(system,previous,states[system]);
    }
    return {run};
  }
  W.populationRuntime=Object.freeze({bind});
})(KIT);
