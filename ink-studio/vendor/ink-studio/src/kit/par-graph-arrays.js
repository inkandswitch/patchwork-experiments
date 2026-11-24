/* Explicit array alignment and reusable group operations in typed graphs. */
(function (K) {
  const P = K.procedural;
  const {validator,compatible} = P.graphTypes;
  const modes = ['zip','cycle','hold','cartesian','cartesianReverse'];
  const operators = ['array.map','array.filter','array.reduce','array.sort'];
  const maxRows = 100000;

  function broadcast(arrays, {mode,limit=maxRows}={}) {
    if (!modes.includes(mode) || !Number.isSafeInteger(limit) || limit<1 || limit>maxRows)
      throw new RangeError('Array broadcast needs an explicit mode and a limit from 1 to '+maxRows);
    if (!validator('record')(arrays)) throw new TypeError('Array broadcast needs named arrays');
    const keys=Object.keys(arrays).sort(), axes=keys.map(key=>arrays[key]);
    if (!axes.length || !axes.every(Array.isArray)) throw new TypeError('Array broadcast needs at least one named array');
    const sizes=axes.map(axis=>axis.length);
    if (mode==='zip' && sizes.some(n=>n!==sizes[0])) throw new RangeError('Zip requires equal array lengths');
    if (sizes.includes(0)) return [];
    const product=mode==='cartesian' || mode==='cartesianReverse';
    let count=1;
    if (product) {
      for (const size of sizes) {
        count*=size;
        if (count>limit) throw new RangeError('Array broadcast exceeds its '+limit+' row budget');
      }
    } else {
      for (const size of sizes) count=Math.max(count,size);
      if (count>limit) throw new RangeError('Array broadcast exceeds its '+limit+' row budget');
    }
    if (count*axes.length>1000000) throw new RangeError('Array broadcast exceeds its cell budget');
    const strides=[];
    if (mode==='cartesian') {
      let stride=1;
      for (let i=sizes.length-1; i>=0; i--) {
        strides[i]=stride;
        stride*=sizes[i];
      }
    } else if (mode==='cartesianReverse') {
      let stride=1;
      for (const size of sizes) {
        strides.push(stride);
        stride*=size;
      }
    }
    return Array.from({length:count},(_,i)=>Object.fromEntries(keys.map((key,j)=>{
      const size=sizes[j];
      const index=product ? Math.floor(i/strides[j])%size : mode==='hold' ? Math.min(i,size-1) : i%size;
      return [key,axes[j][index]];
    })));
  }

  function stableSort(items, key, direction='asc') {
    if (!['asc','desc'].includes(direction)) throw new RangeError('Array sort direction must be asc or desc');
    if (!Array.isArray(items) || items.length>maxRows) throw new RangeError('Array sort needs at most '+maxRows+' items');
    let type;
    const rows=items.map((item,index)=>{
      const value=key(item,index);
      type??=typeof value;
      if (typeof value!==type || typeof value!=='string' && !Number.isFinite(value))
        throw new TypeError('Array sort keys must all be finite numbers or all strings');
      return {item,index,value};
    });
    const sign=direction==='asc' ? 1 : -1;
    return rows.sort((a,b)=>a.value===b.value ? a.index-b.index : a.value<b.value ? -sign : sign).map(row=>row.item);
  }

  const socketType = socket => typeof socket==='string' ? socket : socket?.type;

  function groupOperation(spec, groups) {
    const group=typeof spec.group==='string' && Object.hasOwn(groups,spec.group) && groups[spec.group];
    const sorting=spec.op==='array.sort', reducing=spec.op==='array.reduce', filtering=spec.op==='array.filter';
    if (!group && sorting && spec.group===undefined) return {
      inputs:{items:'array',direction:{type:'string',default:'asc'}}, outputs:{value:'array'},
      run({items,direction}) { return {value:stableSort(items,item=>item,direction)}; }
    };
    if (typeof group?.instantiate!=='function') throw new TypeError(spec.op+' needs a registered graph group');
    const item=socketType(group.inputs?.item), index=socketType(group.inputs?.index);
    const value=socketType(group.outputs?.value), accumulator=socketType(group.inputs?.accumulator);
    if (!validator(item) || !validator(value) || index!==undefined && !compatible('number',index))
      throw new TypeError(spec.op+' groups need item input, value output and an optional numeric index');
    if (reducing ? !validator(accumulator) || !compatible(value,accumulator) : accumulator!==undefined)
      throw new TypeError('Only array.reduce groups need a compatible accumulator input and value output');
    if (filtering && !compatible(value,'boolean')) throw new TypeError('Array filter groups must return a boolean');
    if (sorting && !compatible(value,'number') && !compatible(value,'string'))
      throw new TypeError('Array sort groups must return number or string keys');
    const extra=Object.fromEntries(Object.entries(group.inputs).filter(([key])=>!['item','index','accumulator'].includes(key)));
    if (Object.hasOwn(extra,'items') || reducing && Object.hasOwn(extra,'initial') || sorting && Object.hasOwn(extra,'direction'))
      throw new TypeError('Array group input conflicts with an array operation port');
    const type='array<'+item+'>';
    const inputs={items:type,...extra,...(reducing && {initial:accumulator}),
      ...(sorting && {direction:{type:'string',default:'asc'}})};
    return {inputs,outputs:{value:reducing ? accumulator : 'array<'+(sorting || filtering ? item : value)+'>'},time:true,
      run({items,...args},context) {
        const {time,seed}=context, cost=Math.max(1,group.expandedNodes??1);
        if (items.length*cost>maxRows) throw new RangeError('Array operation exceeds its '+maxRows+' node visit budget');
        const start=reducing ? args.initial : undefined, order=sorting ? args.direction : undefined;
        if (reducing) delete args.initial;
        if (sorting) delete args.direction;
        const evaluate=group.instantiate();
        const apply=(item,i,accumulator)=>evaluate({...args,item,...(index && {index:i}),
          ...(reducing && {accumulator})},{time,seed:P.data.hash(String(i),seed)}).value;
        try {
          if (reducing) return {value:items.reduce((acc,item,i)=>apply(item,i,acc),start)};
          if (sorting) return {value:stableSort(items,apply,order)};
          if (filtering) return {value:items.filter((item,i)=>{
            const keep=apply(item,i);
            if (typeof keep!=='boolean') throw new TypeError('Array filter groups must return a boolean');
            return keep;
          })};
          return {value:items.map((item,i)=>apply(item,i))};
        } finally {
          evaluate.clear?.();
        }
      }
    };
  }

  const operations = Object.fromEntries(operators.map(name=>[name,{specialize:groupOperation}]));
  operations['array.broadcast']={
    inputs:{arrays:'record',mode:'string',limit:{type:'number',default:maxRows}},outputs:{value:'array<record>'},
    run({arrays,mode,limit}) { return {value:broadcast(arrays,{mode,limit})}; }
  };
  operations['data.typed']={specialize({type}){
    if (!validator(type)) throw new TypeError('Unknown data.typed port type '+type);
    return {inputs:{value:type},outputs:{value:type},run({value}){return {value};}};
  }};
  operations['data.record']={specialize({inputs,params}){
    const keys=Object.keys({...params,...inputs});
    return {inputs:Object.fromEntries(keys.map(key=>[key,'any'])),outputs:{value:'record'},
      run(value){return {value};}};
  }};
  operations['data.get']={
    inputs:{record:'record',key:'string'},outputs:{value:'any'},
    run({record,key}) {
      if (!Object.hasOwn(record,key)) throw new RangeError('Missing graph record key '+key);
      return {value:record[key]};
    }
  };
  operations['data.collect']={
    inputs:{source:'record',keys:'array<string>'},outputs:{value:'array'},
    run({source,keys}) {
      return {value:keys.map(key=>{
        if (!Object.hasOwn(source,key)) throw new RangeError('Missing graph record key '+key);
        return source[key];
      })};
    }
  };
  operations['atlas.compile']={
    inputs:{source:'atlas'},outputs:{value:'atlas'},
    run({source}) { return {value:K.sprite.atlas(source)}; }
  };

  P.graph.arrays=Object.freeze({broadcast, stableSort, groupOperators:Object.freeze(operators), operations:Object.freeze(operations)});
})(KIT);
