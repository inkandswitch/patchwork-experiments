/* Native splat frames for authored surface sampling and lighting. */
const SplatFrames = (() => {
  let surface;
  try { surface = SurfaceLook; } catch { surface = require('./surface-look.js'); }
  function covariance(data, q, basis, M, transpose = M.tr(basis)) {
    const [xx, xy, xz, yy, yz, zz] = [4, 5, 6, 8, 9, 10].map(k => data[q + k]);
    return M.mul(M.mul(basis, [xx, xy, xz, xy, yy, yz, xz, yz, zz]), transpose);
  }

  function create(world, time, M) {
    const { renderMetadata, pix, surfaceData, anim, data, rest, reconstructionPose } = world;
    const rig = anim?.rig, bones = anim?.bones;
    const matrices = new Map();
    function sample(i) {
      const offset = i * 3, p = i * 8, surfaceOffset = i * surface.STRIDE, q = i * 16;
      const fragment = reconstructionPose?.poses.get(i);
      let normal;
      if (pix?.[p]) normal = [pix[p + 3], pix[p + 4], pix[p + 5]];
      else if (renderMetadata?.normals?.[offset] || renderMetadata?.normals?.[offset + 1] || renderMetadata?.normals?.[offset + 2])
        normal = Array.from(renderMetadata.normals.subarray(offset, offset + 3));
      else if (surfaceData?.[surfaceOffset])
        normal = [surfaceData[surfaceOffset + 1], surfaceData[surfaceOffset + 2], surfaceData[surfaceOffset + 3]];


      const packed = Math.round(data[q + 11]), kind = packed % 16;
      const part = rig?.free?.[i] ? 0 : rig?.bid[i] || 0;
      const restData=rest||data,restKind = Math.round(restData[q + 11]) % 16;
      const skinned = bones && (kind === 12 || kind === 13 || !(packed & 32768) && (restKind === 12 || restKind === 13));
      const skinRows = kind === 12 || kind === 13 ? data : restData;
      const matrix = part ? rig.M : skinned ? bones : null;
      const bone = part || (skinned ? skinRows[q + 12] : 0);
      const blend = skinned ? skinRows[q + 14] : 0;
      const second = blend ? skinRows[q + 13] : 0;

      if (matrix) {
        const key = [part ? 'rig' : 'bones', bone, second, blend].join(',');
        if (!matrices.has(key)) {
          const rows = matrix.slice(bone * 12, bone * 12 + 9);
          if (blend) for (let j = 0; j < 9; j++) rows[j] += (matrix[second * 12 + j] - rows[j]) * blend;
          const inverse = Math.abs(M.det(rows)) > 1e-8 ? M.inv(rows) : null;
          matrices.set(key, inverse && { basis: rows, inverse, normal: M.tr(inverse) });
        }
      }
      const transform = matrix ? matrices.get([part ? 'rig' : 'bones', bone, second, blend].join(',')) : null;
      const angle = kind === 5 ? time * data[q + 13] : 0;
      const c = Math.cos(angle), s = Math.sin(angle);
      if (normal && transform) normal = M.app(transform.normal, normal);
      if (normal && angle) normal = [c * normal[0] + s * normal[2], normal[1], c * normal[2] - s * normal[0]];
      const length = normal && Math.hypot(...normal);
      return { normal: length > 1e-8 ? normal.map(value => value / length) : null,
        rest: (fragment ? reconstructionPose.base : skinned ? restData :
          anim?.base instanceof Float32Array ? anim.base : rest || data).subarray(q, q + 3),
        position() {
          let x = data[q], y = data[q + 1], z = data[q + 2];
          const ph = data[q + 12], sp = data[q + 13], rg = data[q + 14], ex = data[q + 15];
          if (kind === 5) [x, z] = [c * x + s * z, c * z - s * x];
          else if ((kind === 2 || kind === 3 || kind === 15) && rg) {
            const tick = time * sp / rg + ph, phase = tick - Math.floor(tick);
            y += (kind === 3 ? 1 : -1) * phase * rg;
            if (kind === 3) x += Math.sin(phase * 7 + ph * 50) * .25 * phase;
            if (kind === 15) {
              x += Math.sin(phase * 11 + ph * 40) * ex;
              z += Math.cos(phase * 7 + ph * 23) * ex * .6;
            }
          }
          else if (kind === 6) y += Math.sin(time * sp + ph) * rg;
          else if (kind === 8) {
            const flap = .2 + .8 * Math.abs(Math.sin(time * sp + ph));
            x = rg + (x - rg) * flap;
            z = ex + (z - ex) * flap;
            y += .14 * Math.sin(time * sp * .31 + ph);
          } else if (kind === 9) {
            const scale = 1 + rg * Math.sin(time * sp + ph - y * ex);
            x *= scale;
            z *= scale;
          } else if (kind === 10) y += rg * Math.min(1, Math.hypot(x, z) * .22) * Math.sin(time * sp + Math.hypot(x, z) * ex);
          else if (kind === 11) {
            x += rg * Math.sin(time * sp + y * 1.3 + z * .9 + ph);
            y += rg * .6 * Math.sin(time * sp * 1.3 + x * 1.1 + ph);
          } else if (kind === 14) {
            const spread = rg * Math.max(0, y - ex);
            x += spread * Math.sin(time * sp + ph);
            z += spread * .6 * Math.sin(time * sp * .73 + ph * 1.7);
          } else if ((kind === 12 || kind === 13) && bones) {
            const component = (bone, axis) => bones[bone * 12 + axis * 3] * x +
              bones[bone * 12 + axis * 3 + 1] * y + bones[bone * 12 + axis * 3 + 2] * z + bones[bone * 12 + 9 + axis];
            [x, y, z] = [0, 1, 2].map(axis => component(ph, axis) * (1 - rg) + (rg ? component(sp, axis) * rg : 0));
            if (kind === 13) {
              x += .022 * Math.sin(time * 1.9 + y * 1.3 + z * .9 + 1);
              y += .0132 * Math.sin(time * 2.47 + x * 1.1 + 1);
            }
          }
          return [x, y, z];
        },
        opacity() {
          let alpha=data[q+3];
          const ph=data[q+12],sp=data[q+13],rg=data[q+14];
          const smooth=(a,b,x)=>{x=Math.max(0,Math.min(1,(x-a)/(b-a)));return x*x*(3-2*x);};
          if(kind===1)alpha*=.62+.38*Math.sin(time*sp+ph);
          else if(kind===7)alpha*=.82+.18*Math.sin(time*sp+ph);
          else if((kind===2||kind===3||kind===15)&&rg){
            const tick=time*sp/rg+ph,u=tick-Math.floor(tick);
            alpha*=kind===2?1-u*u:kind===3?(1-u)*smooth(0,.1,u):smooth(0,.05,u)*(1-smooth(.92,1,u));
          }
          return alpha;
        },
        covariance(out = new Float64Array(6)) {
          let A=null,scale=1;
          if(kind===5)A=[c,0,s,0,1,0,-s,0,c];
          else if((kind===12||kind===13)&&bones)A=bones.subarray(data[q+12]*12,data[q+12]*12+9);
          if((kind===2||kind===3)&&data[q+14]){
            const tick=time*data[q+13]/data[q+14]+data[q+12],phase=tick-Math.floor(tick);
            scale=kind===3?.6+phase*data[q+15]:1+phase*data[q+15];
          }
          const C=[data[q+4],data[q+5],data[q+6],data[q+5],data[q+8],data[q+9],data[q+6],data[q+9],data[q+10]];
          const result=A?covariance(data,q,A,M):C,k=scale*scale;
          out[0]=result[0]*k;out[1]=result[1]*k;out[2]=result[2]*k;
          out[3]=result[4]*k;out[4]=result[5]*k;out[5]=result[8]*k;
          return out;
        },
        basis() {
          const orbit = angle ? [c, 0, s, 0, 1, 0, -s, 0, c] : null;
          const posed = transform?.basis;
          return { anchor: fragment?.rotation ?? (orbit && posed ? M.mul(orbit, posed) : orbit || posed || M.id()),
            covariance: kind === 12 || kind === 13 ? posed : orbit };

        },
        localOffset(x, y, z) {
          const offset = [c * x - s * z, y, c * z + s * x];
          if (fragment?.transpose) return M.app(fragment.transpose, offset);
          return transform ? M.app(transform.inverse, offset) : offset;
        }
      };
    }
    return sample;
  }
  return Object.freeze({ create, covariance });
})();
if (typeof module !== 'undefined') module.exports = SplatFrames;
