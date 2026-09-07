import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {freezeStaticScene,adaptiveResolution} from '../src/render-performance.js';

test('static transform caching preserves scenery positions while dynamic actor descendants keep moving',()=>{
  const scene=new T.Scene(),building=new T.Group(),wall=new T.Object3D(),actor=new T.Group(),bone=new T.Object3D();
  building.position.set(5,2,7);wall.position.set(2,1,3);building.add(wall);actor.add(bone);scene.add(building,actor);
  scene.updateMatrixWorld(true);const original=wall.matrixWorld.clone();
  freezeStaticScene(scene,[actor]);bone.position.y=3;actor.position.x=4;scene.updateMatrixWorld();
  assert.deepEqual(wall.matrixWorld.elements,original.elements);assert.deepEqual(bone.getWorldPosition(new T.Vector3()).toArray(),[4,3,0]);
  assert.equal(wall.matrixAutoUpdate,false);assert.equal(bone.matrixAutoUpdate,true);
});
test('automatic resolution responds to sustained frame cost and never counts an intentional pause',()=>{
  const previous=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;
  try{
    const applied=[],resolution=adaptiveResolution({mobile:false,setPixelRatio:value=>applied.push(value)});resolution.setQuality(0);
    for(let time=100;time<=5100;time+=50)resolution.sample(time);
    assert.ok(resolution.stats.pixelRatio<1);assert.ok(resolution.stats.pixelRatio>=.7);
    const before=resolution.stats.pixelRatio;resolution.pause();
    resolution.sample(60000);for(let i=1;i<=75;i++)resolution.sample(60000+i*16.667);
    assert.equal(resolution.stats.pixelRatio,before,'resume ignores time spent in the paused preview');
  }finally{if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;}
});
test('explicit high quality remains stable during slow frames',()=>{
  const previous=globalThis.devicePixelRatio;globalThis.devicePixelRatio=2;
  try{const resolution=adaptiveResolution({mobile:true,setPixelRatio:()=>{}});resolution.setQuality(2);for(let time=100;time<=10000;time+=70)resolution.sample(time);assert.equal(resolution.stats.pixelRatio,1.7);}
  finally{if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;}
});
