import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadMaterials } from './materials.js';
import { loadActors } from './actors.js';
import { CityBatches,surface,roadSurface,loadFacades,buildBuildings,addBox,addStreetFurniture,random } from './architecture.js';
import { addVegetation } from './vegetation.js';
import { buildCathedral } from './landmarks.js';
import { pointInPolygon,nearestRoad,createCollisionIndex,segmentDistance } from './physics.js';

function sign(text,width,height){const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle='#183c32';ctx.fillRect(0,0,1024,192);ctx.fillStyle='#ecdfb9';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 76px Arial';ctx.fillText(text,512,96,950);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;return new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshStandardMaterial({map:texture,roughness:.6}));}
function makeStudio(scene,studio,pbr){
  const group=new T.Group();group.position.set(studio.x,0,studio.z);group.rotation.y=Math.PI;scene.add(group);
  const timber=pbr.plaster.clone();timber.color.set('#756452');const frame=new T.MeshStandardMaterial({color:'#273b32',metalness:.65,roughness:.36}),glass=pbr.glass.clone();glass.transmission=0;glass.metalness=.6;glass.color.set('#677d79');
  addBox(group,6,3.5,4,0,1.75,0,pbr.plaster);addBox(group,6.35,.16,4.3,0,3.56,0,pbr.roof);
  addBox(group,1.23,2.7,.13,-1,1.35,2.05,frame);addBox(group,1.08,2.5,.14,-1,1.29,2.13,timber);
  for(let i=0;i<6;i++)addBox(group,.14,2.48,.03,-1.42+i*.165,1.3,2.22,frame);
  addBox(group,.06,.35,.04,-.57,1.2,2.26,new T.MeshStandardMaterial({color:'#b9aa82',metalness:.95,roughness:.2}));
  addBox(group,1.95,1.56,.13,1.14,1.66,2.05,frame);addBox(group,1.78,1.38,.14,1.14,1.66,2.13,glass);addBox(group,.045,1.41,.16,1.14,1.66,2.18,frame);
  addBox(group,6.32,.14,1.1,0,2.99,2.48,frame);addBox(group,7,.14,6,0,.065,0,pbr.pavement);
  for(const x of [-2.86,2.86]){addBox(group,.075,2.95,.075,x,1.475,2.9,frame);const planter=new T.Mesh(new T.CylinderGeometry(.4,.3,.7,24),pbr.brick);planter.position.set(x,.42,2.75);group.add(planter);}
  const title=sign('JHON · DESARROLLO',4.2,.62);title.position.set(0,3.22,2.22);group.add(title);const subtitle=sign('ESTUDIO FICTICIO',2,.25);subtitle.position.set(.8,.43,2.09);group.add(subtitle);
  const warm=new T.PointLight('#ffdca8',12,5,2);warm.position.set(0,2.7,2.5);group.add(warm);
  return group;
}
function treePositions(data){
  const candidates=[];
  for(let i=0;i<data.parks.length;i++){const park=data.parks[i],xs=park.points.map(p=>p[0]),zs=park.points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),count=Math.min(65,Math.floor((maxX-minX)*(maxZ-minZ)/150));
    for(let j=0;j<count;j++){const x=minX+random(i*900+j)*(maxX-minX),z=minZ+random(i*900+j+18)*(maxZ-minZ);if(pointInPolygon(x,z,park.points)&&!(park.holes||[]).some(h=>pointInPolygon(x,z,h)))candidates.push([x,z]);}
  }
  for(let i=0;i<data.roads.length;i+=5){const r=data.roads[i];if(r.width<6)continue;for(let j=1;j<r.points.length;j+=4){const a=r.points[j-1],b=r.points[j],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<20)continue;const offset=r.width/2+3;candidates.push([(a[0]+b[0])/2-(b[1]-a[1])/d*offset,(a[1]+b[1])/2+(b[0]-a[0])/d*offset]);}}
  const roads=[];for(const r of data.roads)for(let i=1;i<r.points.length;i++){const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],d=Math.hypot(bx-ax,bz-az);if(d<.1)continue;const nx=-(bz-az)/d*(r.width/2+.7),nz=(bx-ax)/d*(r.width/2+.7);roads.push({points:[[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]]});}
  const blocked=createCollisionIndex([...data.buildings,...roads]);const focus=data.meta.focus,cathedral=data.buildings.find(b=>b.id==='way/313286677'),a=cathedral.points[0],b=cathedral.points[1],cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2;return candidates.filter(([x,z])=>!blocked(x,z,.5)&&segmentDistance(x,z,focus[0]-18,focus[1]-25,cx,cz)>7).slice(0,3800);
}

export async function createWorld(canvas,data,onProgress){
  const mobile=matchMedia('(pointer:coarse)').matches;
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.15:1.4));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;
  const context=renderer.getContext(),gpuInfo=context.getExtension('WEBGL_debug_renderer_info');
  const gpuName=gpuInfo?context.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL):'';
  // Unknown/integrated/mobile devices keep the real lighting and models, without a second geometry pass.
  const automaticAO=!mobile&&/NVIDIA|GeForce|Radeon RX|Radeon Pro/i.test(gpuName);
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(54,innerWidth/innerHeight,.15,mobile?450:700);scene.fog=new T.Fog('#c1c8c8',mobile?230:400,mobile?440:680);
  onProgress('Cargando materiales fotográficos y modelos detallados');
  const [pbr,actors]=await Promise.all([loadMaterials(renderer,(_,message)=>onProgress('Materiales · '+message)),loadActors()]);
  // The daylight HDR is bright: a strong image-based fill erases visible shadow contrast.
  scene.environment=pbr.environment;scene.environmentIntensity=.22;scene.background=pbr.sky;scene.backgroundIntensity=.8;scene.environmentRotation.y=scene.backgroundRotation.y=.65;
  const hemi=new T.HemisphereLight('#d8e5ed','#8d8170',.18);scene.add(hemi);
  const sun=new T.DirectionalLight('#fff3df',3.2);sun.position.set(-100,180,120);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.camera.left=-80;sun.shadow.camera.right=80;sun.shadow.camera.top=80;sun.shadow.camera.bottom=-80;sun.shadow.camera.near=1;sun.shadow.camera.far=550;sun.shadow.bias=-.00003;sun.shadow.normalBias=.008;sun.shadow.radius=2;sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
  const groundGeometry=new T.PlaneGeometry(50000,50000);const guv=groundGeometry.attributes.uv;for(let i=0;i<guv.count;i++)guv.setXY(i,guv.getX(i)*50000,guv.getY(i)*50000);groundGeometry.rotateX(-Math.PI/2);const ground=new T.Mesh(groundGeometry,pbr.ground);ground.position.y=-.16;ground.receiveShadow=true;scene.add(ground);
  onProgress('Trazando las calles y sus materiales');const batches=new CityBatches(scene);pbr.asphalt.side=pbr.pavement.side=pbr.ground.side=T.DoubleSide;
  pbr.asphalt.color.set('#c4c8c5');pbr.asphalt.normalScale.set(.35,.35);pbr.asphalt.envMapIntensity=.35;
  const paint=new T.MeshStandardMaterial({color:'#d2c7a4',roughness:.95,side:T.DoubleSide}),water=new T.MeshPhysicalMaterial({color:'#789596',roughness:.25,metalness:.35,clearcoat:.8,side:T.DoubleSide,envMapIntensity:1.1});
  for(const r of data.roads){const p=r.points[0];if(!p)continue;const pedestrian=/footway|path|steps|cycleway|pedestrian/.test(r.type);batches.add(roadSurface(r.points,r.width+2.5,-.012),pbr.pavement,...p);batches.add(roadSurface(r.points,r.width,.005),pedestrian?pbr.pavement:pbr.asphalt,...p);if(!pedestrian&&r.width>=7)batches.add(roadSurface(r.points,.105,.011),paint,...p);}
  for(const w of data.water){if(w.points.length<2)continue;batches.add(w.polygon?surface(w.points,.012,w.holes):roadSurface(w.points,w.width||10,.012),water,...w.points[0]);}
  for(const p of data.parks){if(p.points.length>2)batches.add(surface(p.points,-.025,p.holes),pbr.ground,...p.points[0]);}
  onProgress('Construyendo fachadas, aleros y cubiertas');const facades=await loadFacades(pbr);await new Promise(r=>setTimeout(r,0));buildBuildings(data,batches,pbr,facades);batches.finish();
  const cathedral=data.buildings.find(b=>b.id==='way/313286677');if(cathedral)buildCathedral(scene,cathedral,pbr);
  onProgress('Añadiendo follaje y mobiliario de calle');const trees=treePositions(data);pbr.foliage.color.set('#bdcda7');pbr.foliage.envMapIntensity=.35;pbr.foliage.normalScale.set(.25,.25);pbr.foliage.alphaTest=.55;addVegetation(scene,trees,pbr);addStreetFurniture(scene,data,pbr);
  const asPoint=v=>Array.isArray(v)?{x:v[0],z:v[1]}:v;
  const spawn=asPoint(data.meta.spawn),studio=asPoint(data.meta.studio),carPosition=asPoint(data.meta.car),road=nearestRoad(spawn.x,spawn.z,data.roads,true);
  makeStudio(scene,studio,pbr);const beacon=new T.Mesh(new T.TorusGeometry(.52,.027,6,40),new T.MeshBasicMaterial({color:'#d5fa77'}));beacon.position.set(studio.x,4.3,studio.z);beacon.rotation.x=Math.PI/2;scene.add(beacon);
  const playerCar=actors.makeCar('#ac8947');playerCar.position.set(carPosition.x,0,carPosition.z);playerCar.rotation.y=road.angle;scene.add(playerCar);
  const avatar=actors.makeCharacter();avatar.position.set(spawn.x,0,spawn.z);avatar.rotation.y=road.angle;scene.add(avatar);
  const traffic=[],localRoads=data.roads.filter(r=>r.width>=7&&r.points.length>1&&Math.hypot(r.points[0][0]-spawn.x,r.points[0][1]-spawn.z)<1800);
  for(let i=0;i<Math.min(mobile?3:6,localRoads.length);i++){const r=localRoads[Math.floor(random(i+4)*localRoads.length)],car=actors.makeCar(['#cecec6','#3a4550','#735445','#243d3c'][i%4]);scene.add(car);traffic.push({mesh:car,points:r.points,segment:0,t:random(i),speed:3+random(i+8)*5});}
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const ao=new GTAOPass(scene,camera,innerWidth,innerHeight,undefined,{radius:2.5,distanceExponent:1,thickness:.7,samples:8});ao.blendIntensity=.65;composer.addPass(ao);composer.addPass(new OutputPass());
  const aoRender=ao.render.bind(ao);ao.render=(...args)=>{const hidden=[];scene.traverse(o=>{if(o.isMesh&&o.visible&&!Array.isArray(o.material)&&(o.material?.alphaTest>0||o.material?.transmission>.1)){hidden.push(o);o.visible=false;}});const shadowAutoUpdate=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;try{aoRender(...args);}finally{renderer.shadowMap.autoUpdate=shadowAutoUpdate;hidden.forEach(o=>o.visible=true);}};
  let quality=0;const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight);};
  const setQuality=q=>{quality=q;renderer.setPixelRatio(q===1?1:Math.min(devicePixelRatio,q===2?1.7:mobile?1.15:1.4));renderer.shadowMap.enabled=true;ao.enabled=q===2||(q===0&&automaticAO);resize();};setQuality(0);
  renderer.info.autoReset=false;const render=dt=>{renderer.info.reset();if(!ao.enabled)renderer.render(scene,camera);else composer.render(dt);};
  const setTime=index=>{const settings=[['#fff3df',3.2,.18,.8,.94,.22],['#ffd2a0',2.4,.11,.6,1.02,.14],['#fff9f0',3.6,.22,.95,.91,.26]][index];sun.color.set(settings[0]);sun.intensity=settings[1];hemi.intensity=settings[2];scene.backgroundIntensity=settings[3];renderer.toneMappingExposure=settings[4];scene.environmentIntensity=settings[5];};
  return {scene,camera,renderer,composer,sun,hemi,avatar,playerCar,traffic,spawn,studio,beacon,road,mobile,treeCount:trees.length,pbr,render,resize,setQuality,setTime,updateCharacter:actors.updateCharacter,visualVersion:'0.2-photographic'};
}
export function updateTraffic(traffic,dt,player){
  for(const car of traffic){const a=car.points[car.segment],b=car.points[car.segment+1];if(!b)continue;const l=Math.hypot(b[0]-a[0],b[1]-a[1]),distance=Math.hypot(car.mesh.position.x-player.x,car.mesh.position.z-player.z);car.mesh.visible=distance<250;if(distance>8)car.t+=dt*car.speed/Math.max(l,1);if(car.t>=1){car.t=0;car.segment++;if(car.segment>=car.points.length-1){car.points=[...car.points].reverse();car.segment=0;}}const pa=car.points[car.segment],pb=car.points[car.segment+1],len=Math.hypot(pb[0]-pa[0],pb[1]-pa[1])||1;car.mesh.position.set(pa[0]+(pb[0]-pa[0])*car.t+(pb[1]-pa[1])/len*1.5,0,pa[1]+(pb[1]-pa[1])*car.t-(pb[0]-pa[0])/len*1.5);car.mesh.rotation.y=Math.atan2(pb[0]-pa[0],pb[1]-pa[1]);}
}
