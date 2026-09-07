import * as T from 'three';
import {random} from './architecture.js';

/** Instanced leaf cutouts and branched trunks in 150 m cells, O(number of trees). */
export function addVegetation(scene,locations,pbr){
  const cells=new Map();for(const p of locations){const key=`${Math.floor(p[0]/150)},${Math.floor(p[1]/150)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}
  const bark=pbr.plaster.clone();bark.color.set('#76685a');bark.roughness=1;bark.normalScale.set(.45,.45);
  const trunkGeometry=new T.CylinderGeometry(.10,.23,1,8,3),branchGeometry=new T.CylinderGeometry(.018,.09,1,6,2);
  const leafGeometry=new T.PlaneGeometry(1,1);const uv=leafGeometry.attributes.uv;
  // Crop the upper-right branch from the photographic atlas with UV coordinates.
  for(let i=0;i<uv.count;i++)uv.setXY(i,.17+uv.getX(i)*.83,.47+uv.getY(i)*.53);
  const dummy=new T.Object3D(),up=new T.Vector3(0,1,0),end=new T.Vector3(),origin=new T.Vector3(),direction=new T.Vector3();
  let seed=0;
  for(const points of cells.values()){
    const trunks=new T.InstancedMesh(trunkGeometry,bark,points.length),branches=new T.InstancedMesh(branchGeometry,bark,points.length*7),leaves=new T.InstancedMesh(leafGeometry,pbr.foliage,points.length*49);
    points.forEach(([x,z],i)=>{const id=seed++,scale=.8+random(id)*.6,height=4.0*scale;dummy.position.set(x,height/2,z);dummy.rotation.set(.04*(random(id)-.5),0,.035*(random(id+2)-.5));dummy.scale.set(scale,height,scale);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      for(let b=0;b<7;b++){const angle=b*2.399+random(id)*3.14,radius=(1.25+random(id+b)*1.15)*scale;origin.set(x,height*.65,z);end.set(x+Math.cos(angle)*radius,height+.5+random(id+b+6)*1.6*scale,z+Math.sin(angle)*radius);direction.subVectors(end,origin);dummy.position.copy(origin).addScaledVector(direction,.5);dummy.quaternion.setFromUnitVectors(up,direction.clone().normalize());dummy.scale.set(scale,direction.length(),scale);dummy.updateMatrix();branches.setMatrixAt(i*7+b,dummy.matrix);
        for(let l=0;l<7;l++){const j=i*49+b*7+l;dummy.position.copy(end);dummy.position.x+=(random(id*77+j)-.5)*2*scale;dummy.position.y+=(random(id*31+j)-.5)*1.3*scale;dummy.position.z+=(random(id*91+j)-.5)*2*scale;dummy.rotation.set((random(j+4)-.5)*2.3,angle+random(j)*4,random(j+1)*Math.PI);dummy.scale.set((1.1+random(j)*.5)*scale,(.9+random(j+3)*.4)*scale,1);dummy.updateMatrix();leaves.setMatrixAt(j,dummy.matrix);leaves.setColorAt(j,new T.Color().setHSL(.24+random(j+19)*.045,.10+random(j)*.10,.76+random(j+3)*.12));}
      }
    });trunks.castShadow=branches.castShadow=leaves.castShadow=true;trunks.receiveShadow=branches.receiveShadow=leaves.receiveShadow=true;scene.add(trunks,branches,leaves);
  }
}
