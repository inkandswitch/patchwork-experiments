/* Balanced, entropic transport for splat correspondences and barycentric trajectories. */
(function (K) {
  const P=K.procedural,V=K.V,M=P.motion,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    point=p=>Array.isArray(p)&&p.length===3&&p.every(v=>number(v,-1e6,1e6)),
    distance2=(a,b)=>a.reduce((d,v,i)=>d+(v-b[i])**2,0);
  function prepare(input,normalize){
    if(!Array.isArray(input)||!integer(input.length,1,2048))throw new Error('Transport needs bounded nonempty splat sets');
    const ids=new Set(),samples=Array.from(input,(raw,i)=>{
      const {id=String(i),position,normal,color,weight=1,feature}=Array.isArray(raw)?{position:raw}:raw??{};
      if(typeof id!=='string'||!id||id.length>240||ids.has(id)||!point(position)||
        (normal!==undefined&&(!point(normal)||V.len(normal)<1e-9))||
        (color!==undefined&&(!point(color)||!color.every(v=>number(v,0,1))))||
        (feature!==undefined&&(typeof feature!=='string'||feature.length>240))||!number(weight,1e-10,1e10))
        throw new Error('Transport samples need unique IDs, finite positions and positive mass');
      ids.add(id);
      return P.data.freeze({id,position:position.slice(),normal:normal?V.norm(normal):null,color:color?.slice()??null,
        feature:feature??null,weight});
    });
    const total=samples.reduce((sum,s)=>sum+s.weight,0),mass=Float64Array.from(samples,s=>s.weight/total),
      bounds=P.spatial.boxOf(samples.map(s=>s.position)),
      coordinates=normalize==='bounds'?samples.map(({position})=>position.map((v,i)=>
        (v-bounds.min[i])/Math.max(1e-3,bounds.max[i]-bounds.min[i]))):samples.map(s=>s.position);
    return {samples,mass,coordinates};
  }

  function transportSplats(a0,b0,{
    normalize='none',epsilon=0.038,iterations=110,tolerance=0.000005,
    positionWeight=1,normalWeight=0.18,colorWeight=0.22,featureWeight=0.6,
    cost,maxWork=128000000
  }={}){
    if(!['none','bounds'].includes(normalize)||!number(epsilon,1e-8,1e6)||!integer(iterations,1,1000)||
      !number(tolerance,1e-10,0.1)||![positionWeight,normalWeight,colorWeight,featureWeight].every(v=>number(v,0,1e6))||
      (cost!==undefined&&typeof cost!=='function')||!integer(maxWork,1,420000000))
      throw new Error('Transport needs finite cost scales and bounded iteration controls');
    const A=prepare(a0,normalize),B=prepare(b0,normalize),[rows,columns]=[A.samples.length,B.samples.length],
      count=rows*columns,finishWork=count*7;
    if(count>1400000||maxWork<finishWork+count*5)
      throw new Error('Transport exceeds its matrix or initial work budget');
    const kernel=new Float64Array(count),u=new Float64Array(rows),v=new Float64Array(columns),
      logA=A.mass.map(Math.log),logB=B.mass.map(Math.log);
    for(const [i,a] of A.samples.entries())for(const [j,b] of B.samples.entries()){
      const loss=cost?cost(a,b,i,j):
        positionWeight*distance2(A.coordinates[i],B.coordinates[j])+
        (a.normal&&b.normal?normalWeight*Math.max(0,1-V.dot(a.normal,b.normal)):0)+
        (a.color&&b.color?colorWeight*distance2(a.color,b.color):0)+
        (a.feature!==null&&b.feature!==null&&a.feature!==b.feature?featureWeight:0);
      if(!Number.isFinite(loss)||loss<0||loss/epsilon>1e14)
        throw new Error('Transport costs must be finite and within the regularized numeric range');
      kernel[i*columns+j]=-loss/epsilon;
    }
    const mass=new Float64Array(count),sumA=new Float64Array(rows),sumB=new Float64Array(columns);
    let work=count,passes=0,status='limit',residual=Infinity;
    function sums(){
      sumA.fill(0);sumB.fill(0);
      for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
        const k=i*columns+j,p=Math.exp(kernel[k]+u[i]+v[j]);
        mass[k]=p;sumA[i]+=p;sumB[j]+=p;
      }
      let error=0;
      for(let i=0;i<rows;i++)error=Math.max(error,Math.abs(sumA[i]-A.mass[i]));
      for(let j=0;j<columns;j++)error=Math.max(error,Math.abs(sumB[j]-B.mass[j]));
      work+=count;
      return error;
    }
    for(let pass=0;pass<iterations;pass++){
      if(work+count*4+finishWork>maxWork){status='budget';break;}
      for(let i=0;i<rows;i++){
        let peak=-Infinity,sum=0;
        const at=i*columns;
        for(let j=0;j<columns;j++)peak=Math.max(peak,kernel[at+j]+v[j]);
        for(let j=0;j<columns;j++)sum+=Math.exp(kernel[at+j]+v[j]-peak);
        u[i]=logA[i]-peak-Math.log(sum);
      }
      for(let j=0;j<columns;j++){
        let peak=-Infinity,sum=0;
        for(let i=0;i<rows;i++)peak=Math.max(peak,kernel[i*columns+j]+u[i]);
        for(let i=0;i<rows;i++)sum+=Math.exp(kernel[i*columns+j]+u[i]-peak);
        v[j]=logB[j]-peak-Math.log(sum);
      }
      passes++;work+=count*4;
      if(passes%5===0&&work+count+finishWork<=maxWork){
        residual=sums();
        if(residual<=tolerance){status='ok';break;}
      }
    }
    residual=sums();
    if(residual<=tolerance)status='ok';

    // Round the finite approximation to feasible marginal masses before deriving target positions.
    sumB.fill(0);
    for(let i=0;i<rows;i++){
      const scale=sumA[i]>A.mass[i]?A.mass[i]/sumA[i]:1;
      for(let j=0;j<columns;j++)sumB[j]+=(mass[i*columns+j]*=scale);
    }
    sumA.fill(0);
    for(let j=0;j<columns;j++){
      const scale=sumB[j]>B.mass[j]?B.mass[j]/sumB[j]:1;
      sumB[j]=0;
      for(let i=0;i<rows;i++){
        const weight=(mass[i*columns+j]*=scale);
        sumA[i]+=weight;
        sumB[j]+=weight;
      }
    }
    const missingA=A.mass.map((p,i)=>Math.max(0,p-sumA[i])),missingB=B.mass.map((p,j)=>Math.max(0,p-sumB[j])),
      missing=missingB.reduce((sum,v)=>sum+v,0),
      forward=Array.from({length:rows},()=>[0,0,0]),reverse=Array.from({length:columns},()=>[0,0,0]);
    sumA.fill(0);sumB.fill(0);
    let objective=0;
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const k=i*columns+j,p=mass[k]+(missing>0?missingA[i]*missingB[j]/missing:0);
      mass[k]=p;
      sumA[i]+=p;sumB[j]+=p;
      objective+=p*(-kernel[k]*epsilon);
      for(let axis=0;axis<3;axis++){
        forward[i][axis]+=B.samples[j].position[axis]*p;
        reverse[j][axis]+=A.samples[i].position[axis]*p;
      }
    }
    for(let i=0;i<rows;i++)forward[i]=sumA[i]?V.mul(forward[i],1/sumA[i]):A.samples[i].position.slice();
    for(let j=0;j<columns;j++)reverse[j]=sumB[j]?V.mul(reverse[j],1/sumB[j]):B.samples[j].position.slice();
    work+=count*3;
    return Object.freeze({status,rows,columns,mass,rowMass:A.mass,columnMass:B.mass,
      forward:P.data.freeze(forward),reverse:P.data.freeze(reverse),objective,residual,
      work:Object.freeze({passes,visits:work})});
  }
  M.transportSplats=transportSplats;
})(KIT);
