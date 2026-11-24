/* Ordered, renderer-independent coverage for paint and erasure. */
(function(K) {
  const P=K.procedural||K.authoring;

  function paintMixer(supplied) {
    if(!Array.isArray(supplied))throw new Error('Paint mixing needs an ordered layer array');
    const ids=new Set();
    const layers=supplied.map(layer=>{
      const {id,operation='add',coverage}=layer||{};
      if(typeof id!=='string'||!id||ids.has(id)||!['add','erase'].includes(operation)||typeof coverage!=='function')
        throw new Error('Paint layers need unique IDs, operations and coverage functions');
      ids.add(id);
      return {id,operation,coverage};
    });

    function opacity(layer,x,y) {
      const value=layer.coverage(x,y);
      if(!Number.isFinite(value)||value<0||value>1)throw new Error('Paint coverage must be in 0..1');
      return value;
    }

    function pick(x,y,rank) {
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(rank)||rank<0||rank>=1)
        throw new Error('Paint mixing needs finite coordinates and a rank in [0, 1)');
      let remaining=1;
      for(let i=layers.length-1;i>=0&&remaining>0;i--){
        const layer=layers[i],weight=remaining*opacity(layer,x,y);
        if(rank<weight)return layer.operation==='add'?layer.id:null;
        rank-=weight;
        remaining-=weight;
      }
      return null;
    }

    function sample(x,y) {
      if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Paint mixing needs finite coordinates');
      const contributions=[];
      let remaining=1,background=0;
      for(let i=layers.length-1;i>=0&&remaining>0;i--){
        const layer=layers[i],weight=remaining*opacity(layer,x,y);
        if(weight===0)continue;
        if(layer.operation==='add')contributions.push({id:layer.id,weight});
        else background+=weight;
        remaining-=weight;
      }
      return {contributions,background:background+remaining};
    }

    return Object.freeze({pick,sample});
  }

  (P.materials||(P.materials={})).paintMixer=paintMixer;
})(KIT);
