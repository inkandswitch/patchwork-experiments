/* An explicit ray query over the same Gaussian coverage and media used by the renderers. */
(function(K){
  const P=K.procedural, {V}=K, R=ContributionRules;
  const valid=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  const smooth=(x,a,b)=>{const t=K.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const fract=x=>x-Math.floor(x);
  function pose(data,i,t,grow){
    const o=i*16, flags=Math.round(data[o+11]), k=flags&15, ph=data[o+12], sp=data[o+13], rg=data[o+14], ex=data[o+15];
    let x=data[o],y=data[o+1],z=data[o+2],a=data[o+3],scale=1,angle=0;
    if(k===1||k===7&&ex!==LightSchedule.emissionMarker)
      a*=k===1?.62+.38*Math.sin(t*sp+ph):.82+.18*Math.sin(t*sp+ph);
    if((k===2||k===3||k===15)&&rg){
      const q=fract(t*sp/rg+ph);
      if(k===2){y-=q*rg;a*=1-q*q;scale*=1+q*ex;}
      if(k===3){y+=q*rg;x+=Math.sin(q*7+ph*50)*.25*q;a*=(1-q)*smooth(q,0,.1);scale*=.6+q*ex;}
      if(k===15){y-=q*rg;x+=Math.sin(q*11+ph*40)*ex;z+=Math.cos(q*7+ph*23)*ex*.6;
        a*=smooth(q,0,.05)*(1-smooth(q,.92,1));}
    }
    if(k===5){
      angle=t*sp;
      const c=Math.cos(angle),s=Math.sin(angle),before=x;
      x=c*x+s*z;z=c*z-s*before;
    }
    if(k===6)y+=Math.sin(t*sp+ph)*rg;
    if(k===8){
      const f=.2+.8*Math.abs(Math.sin(t*sp+ph));x=rg+(x-rg)*f;z=ex+(z-ex)*f;y+=.14*Math.sin(t*sp*.31+ph);
    }
    if(k===9){
      const f=1+rg*Math.sin(t*sp+ph-y*ex);x*=f;z*=f;
    }
    if(k===10){
      const q=Math.hypot(x,z),w=Math.min(1,q*.22),f=1+rg*.6*w*Math.cos(t*sp*.7+ph+q*ex)/Math.max(q,.01);
      y+=rg*w*Math.sin(t*sp+ph-q*ex);x*=f;z*=f;
    }
    if(k===11){
      const before=x;
      x+=rg*Math.sin(t*sp+y*1.3+z*.9+ph);y+=rg*.6*Math.sin(t*sp*1.3+before*1.1+ph);
    }
    if(k===14){
      const h=Math.max(0,y-ex);
      x+=rg*h*Math.sin(t*sp+ph);z+=rg*.6*h*Math.sin(t*sp*.73+ph*1.7);
    }
    if(flags&512){
      const time=t*(grow?.rate??1),g=K.clamp(((grow?.loop>0?((time%grow.loop)+grow.loop)%grow.loop:time)-ex)/(grow?.fade??.5),0,1);
      if(!g)a=0;
      scale*=g*(2-g);
    }
    return {x,y,z,a,scale,angle};
  }
  function covariance(data,o,angle,scale){
    const A=data[o+4], B=data[o+5], C=data[o+6], D=data[o+8], E=data[o+9], F=data[o+10], s2=scale*scale;
    if(!angle)return [A*s2,B*s2,C*s2,D*s2,E*s2,F*s2];
    const c=Math.cos(angle),s=Math.sin(angle);
    return [(c*c*A+2*c*s*C+s*s*F)*s2,(c*B+s*E)*s2,((c*c-s*s)*C+c*s*(F-A))*s2,
      D*s2,(c*E-s*B)*s2,(s*s*A-2*c*s*C+c*c*F)*s2];
  }
  const tensor=([a,b,c,d,e,f],u,v)=>u[0]*(a*v[0]+b*v[1]+c*v[2])+u[1]*(b*v[0]+d*v[1]+e*v[2])+u[2]*(c*v[0]+e*v[1]+f*v[2]);
  function box(rows,indices,first,end){
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=first;i<end;i++){
      const o=indices[i]*10;
      for(let k=0;k<3;k++){
        const extent=3*Math.sqrt(rows[o+(k===0?4:k===1?7:9)]);
        min[k]=Math.min(min[k],rows[o+k]-extent);
        max[k]=Math.max(max[k],rows[o+k]+extent);
      }
    }
    return {min,max};
  }
  function orderedTree(rows,indices){
    if(!indices.length)return null;
    const full=box(rows,indices,0,indices.length), span=V.sub(full.max,full.min);
    const codes=new Uint32Array(rows.length/10);
    function mortonBits(v){
      v=(v|(v<<16))&0x030000ff;v=(v|(v<<8))&0x0300f00f;
      v=(v|(v<<4))&0x030c30c3;return (v|(v<<2))&0x09249249;
    }
    for(const i of indices){
      const o=i*10, n=[0,1,2].map(k=>K.clamp(Math.floor((rows[o+k]-full.min[k])*1023/Math.max(1e-8,span[k])),0,1023));
      codes[i]=mortonBits(n[0])|(mortonBits(n[1])<<1)|(mortonBits(n[2])<<2);
    }
    indices.sort((a,b)=>codes[a]-codes[b]||a-b);
    function branch(first,end){
      if(end-first<=12)return {...box(rows,indices,first,end),first,end};
      const mid=(first+end)>>>1,a=branch(first,mid),b=branch(mid,end);
      return {min:a.min.map((v,i)=>Math.min(v,b.min[i])),max:a.max.map((v,i)=>Math.max(v,b.max[i])),a,b};
    }
    return branch(0,indices.length);
  }

  function picker(world,{time=world.lookSnapshot?.time??0,sampleWithdrawal=world.sampleWithdrawal??0,
    splatCoverage=world.look?.splatCoverage,cutaway=world.look?.cutaway,camera}={}){
    const coverageMode=R.coverageMode(splatCoverage), defaultCutaway=Cutaway.prepare(cutaway);
    const {count,renderMetadata,opticalSplats}=world, marks=world.dataMarks?.snapshot();
    if(!(world.data instanceof Float32Array)||!Number.isSafeInteger(count)||count<0||world.data.length<count*16||!Number.isFinite(time))
      throw new TypeError('Picking needs a baked splat world and finite time');
    const opticalFrames=opticalSplats&&SplatFrames.create(world,time,K.M);
    const data=world.anim?.bones?K.bones.posed({...world,data:world.rest??world.data,posedBuf:undefined}):world.data;
    const rows=new Float32Array(count*10), selected=[];
    const back=new Set(world.back??[]),withdrawal=SampleCoverage.amount(sampleWithdrawal);
    for(let i=0;i<count;i++){
      const o=i*16,flags=Math.round(data[o+11]);
      if(data[o+3]<=0||data[o+1]<-30||back.has(i)||(flags&128)||!SampleCoverage.visible(flags,withdrawal))continue;
      const {x,y,z,a,angle,scale}=pose(data,i,time,world.grow);
      if(!(a>=R.minimum)||![x,y,z].every(Number.isFinite))continue;
      const cov=covariance(data,o,angle,scale);
      if(!cov.every(Number.isFinite)||cov[0]<0||cov[3]<0||cov[5]<0)continue;
      rows.set([x,y,z,a,...cov],i*10);selected.push(i);
    }
    const indices=Uint32Array.from(selected),tree=orderedTree(rows,indices);
    let provenance;
    function ray({origin,direction,maxDistance=100,threshold=R.minimum,limit=64,soft=false,water=true,accept,
      cutaway=defaultCutaway,camera:sectionCamera=camera}={}){
      if(!valid(origin)||!valid(direction)||V.len(direction)<=1e-8||!Number.isFinite(maxDistance)||maxDistance<=0||
          !Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isInteger(limit)||limit<1||limit>256||
          accept!==undefined&&typeof accept!=='function')
        throw new RangeError('A contribution ray needs XYZ origin, nonzero direction, positive distance and a bounded limit');
      const d=V.norm(direction), u=V.perp(d), v=V.cross(d,u), hits=[];
      const section=Cutaway.prepare(cutaway);
      let back;
      if(section?.range && sectionCamera){
        if(!valid(sectionCamera.eye)||!valid(sectionCamera.back)||V.len(sectionCamera.back)<=1e-8||
            !Number.isFinite(sectionCamera.setback??0))throw new TypeError('Cutaway picking needs a finite camera eye and back axis');
        back=V.norm(sectionCamera.back);
      }
      let visited=0;
      function visit(node){
        if(!node||P.spatial.rayBox(node,origin,d,maxDistance)===null)return;
        if(node.a){visit(node.a);visit(node.b);return;}
        for(let n=node.first;n<node.end;n++){
          const i=indices[n],o=i*10,px=rows[o]-origin[0],py=rows[o+1]-origin[1],pz=rows[o+2]-origin[2];
          const t=px*d[0]+py*d[1]+pz*d[2];
          if(t<=0||t>maxDistance)continue;
          visited++;
          const delta=[px,py,pz],x=V.dot(delta,u),y=V.dot(delta,v),cov=rows.subarray(o+4,o+10);
          const A=tensor(cov,u,u), B=tensor(cov,u,v), C=tensor(cov,v,v), det=A*C-B*B;
          if(!(det>0))continue;
          const density=rows[o+3], opt=i*OpticalMaterials.STRIDE, optical=opticalSplats?.[opt+3];
          const a=i*3, normals=renderMetadata?.normals;
          const normal=optical?opticalFrames(i).normal:normals&&[normals[a],normals[a+1],normals[a+2]];
          const f=normal&&V.dot(normal,d);
          const raw=Math.round(data[i*16+11]), packedEdge=world.materialPixelStyles?.[i*4]??0;
          const mode=R.materialCoverage(packedEdge,coverageMode), softCoverage=mode===R.softCoverage;
          let alpha=R.alpha(-.5*(C*x*x-2*B*x*y+A*y*y)/det,density,!soft&&!softCoverage&&density>=1,
            R.materialEdge(packedEdge),!soft&&R.continuous(mode,density,raw,optical));
          if(optical)alpha*=OpticalMaterials.slabOpacity(opticalSplats,opt,normal?f:1);
          if(alpha<R.minimum)continue;
          const target=(provenance??=TargetSelectors.index(world)).row(i);
          const at=Math.abs(f)>1e-7?V.dot(normal,delta)/f:t;
          let distance=at>0&&at<=maxDistance&&Math.abs(at-t)<=3*Math.sqrt(cov[0]+cov[3]+cov[5])?at:t;
          let point;
          if(section){
            const shift=(tensor(cov,d,u)*(C*x-B*y)+tensor(cov,d,v)*(A*y-B*x))/det;
            const reach=3*Math.sqrt(Math.max(0,tensor(cov,d,d)));
            distance=t-K.clamp(shift,-reach,reach);
            if(distance<=0||distance>maxDistance)continue;
            point=V.mad(origin,d,distance);
            const depth=back ? V.dot(V.sub(sectionCamera.eye,point),back)-(sectionCamera.setback??0) : distance;
            if(Cutaway.margin(section,...point,depth)<0)continue;
          }
          const dataMark = target.mark === undefined ? undefined : marks?.get(target.mark);
          const hit={kind:raw&256?'glass':'splat',index:i,...(world.splatIds?.[i]&&{id:world.splatIds[i]}),
            target,...(dataMark && { dataMark }),distance,point:point??V.mad(origin,d,distance),alpha,solid:!optical&&!softCoverage&&density>=1&&alpha>=.5&&!(raw&(16|256))};
          if(!accept||accept(hit))hits.push(hit);
        }
      }
      visit(tree);
      hits.sort((a,b)=>a.distance-b.distance||b.index-a.index);
      const layers=[], segments=[], media=[];
      if(water)for(const segment of world.water?.raySegments?.(origin,d,maxDistance,{mediumIds:true})??[]){
        const last=segments.at(-1);
        if(last&&last[2]===segment[2]&&last[4]===segment[4]&&(!segment[2].optical||last[3]===segment[3])&&Math.abs(last[1]-segment[0])<1e-8)last[1]=segment[1];
        else segments.push(segment.slice());
      }
      let cursor=0;
      for(const [enter,exit,style,surface,id] of segments){
        while(cursor<hits.length&&hits[cursor].distance<=enter)layers.push(hits[cursor++]);
        function volume(from,to){
          if(to<=from)return;
          const length=to-from, transmissionRGB=style.extinction.map(n=>Math.exp(-n*length));
          const alpha=1-V.dot(transmissionRGB,[.30,.55,.15]);
          const interval={kind:'water',id,distance:from,exit:to,point:V.mad(origin,d,from),alpha,transmissionRGB};
          media.push(interval);
          if(alpha>0)layers.push(interval);
        }
        function reflection(distance){
          const alpha=OpticalMaterials.waterReflection(style,origin[1],d[1],distance,surface);
          if(!alpha)return;
          const layer={kind:'water',id,distance,exit:distance,point:V.mad(origin,d,distance),alpha};
          media.push(layer);layers.push(layer);
        }
        if(d[1]<0)reflection(enter);
        let from=enter;
        while(cursor<hits.length&&hits[cursor].distance<exit){
          const hit=hits[cursor++];
          volume(from,hit.distance);layers.push(hit);from=hit.distance;
        }
        volume(from,exit);
        if(d[1]>0&&exit<maxDistance)reflection(exit);
      }
      while(cursor<hits.length)layers.push(hits[cursor++]);
      const result=R.reduce(layers,threshold);
      const dominant=result.contributions.reduce((best,hit)=>!best||hit.weight>best.weight?hit:best,null);
      const solid=result.contributions.find(hit=>hit.solid)??null;
      return {...result,contributions:result.contributions.slice(0,limit),dominant,solid,
        truncated:result.contributions.length>limit,media,visited};
    }
    return Object.freeze({ray});
  }
  P.contributions=Object.freeze({create:picker});
})(KIT);
