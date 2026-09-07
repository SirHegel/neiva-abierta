import * as T from 'three';
import { createWorld,updateTraffic } from './world.js';
import { createCollisionIndex,moveWithCollision,nearestRoad,safeExit,parseProgress } from './physics.js';

const $=id=>document.getElementById(id),canvas=$('world'),keys=new Set();
let world,data,blocked,active=false,started=false,driving=false,speed=0,yaw=0,pitch=.3,lookTime=0,clock=0,uiClock=0,lastTime=0,photoRequested=false;
let player={x:0,z:0},car={x:0,z:0,angle:0},destinations=[],near=null,walkDistance=0,dayIndex=0;
let stick={x:0,y:0},sprinting=false,lastDialogFocus=null;const dialogs=[...document.querySelectorAll('dialog')];
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
let progress;try{progress=parseProgress(localStorage.getItem('neiva-abierta.visits.v1'));}catch{progress=new Set();}
const toast=message=>{$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$('toast').hidden=true,4000);};
const resetInput=()=>{keys.clear();stick={x:0,y:0};sprinting=false;$('stick').style.transform='';};
function openDialog(id){if(!world&&id==='map-dialog')return;lastDialogFocus=document.activeElement;resetInput();active=false;$(id).showModal();if(id==='map-dialog')drawMap($('atlas'),true);}
for(const d of dialogs){d.querySelector('.close').addEventListener('click',()=>d.close());d.addEventListener('close',()=>{resetInput();active=started&&!dialogs.some(d=>d.open);lastDialogFocus?.focus();});d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});}
function saveVisit(id){if(progress.has(id))return;progress.add(id);try{localStorage.setItem('neiva-abierta.visits.v1',JSON.stringify([...progress]));}catch{}const count=destinations.filter(p=>progress.has(p.id)).length;$('progress').textContent=`${count} / ${destinations.length}`;updateQuest();if(id==='studio')toast('Encontraste el estudio de Jhon. Bienvenido.');else toast(`Nueva parada: ${destinations.find(p=>p.id===id)?.name||'Neiva'}`);if(count===destinations.length){$('quest-title').textContent='La ruta ya es tuya';$('quest-description').textContent='Sigue explorando los barrios del mapa.';}}
function start(){if(!world)return;started=active=true;document.body.classList.add('playing');$('intro').hidden=true;$('hud').hidden=false;$('menu-button').setAttribute('aria-label','Pausar juego');resetInput();const r=nearestRoad(player.x,player.z,data.roads,true);yaw=r.angle+Math.PI;pitch=.28;world.avatar.rotation.y=r.angle;cameraUpdate(1,true);canvas.focus();toast(world.mobile?'Palanca para moverte. Desliza la ciudad para mirar.':'WASD para caminar · arrastra para mirar · E para interactuar');}
function pause(){if(!world)return;if(!started)return;active=false;resetInput();$('intro').hidden=false;$('hud').hidden=true;$('play-label').textContent='Seguir explorando';$('play').focus();}
$('play').addEventListener('click',start);
$('menu-button').addEventListener('click',()=>{if(started&&active)pause();else if(started)start();else openDialog('about-dialog');});
for(const id of ['map-button','minimap-button','guide-button'])$(id).addEventListener('click',()=>openDialog('map-dialog'));
for(const id of ['about-button','coverage-button'])$(id).addEventListener('click',()=>openDialog('about-dialog'));

function interact(){
  if(!active||!world)return;
  if(driving){const exit=safeExit(car,blocked);if(!exit){toast('No hay espacio para bajar. Mueve un poco el carro.');return;}driving=false;speed=0;player={...exit};world.avatar.visible=true;world.avatar.position.set(player.x,0,player.z);toast('De nuevo a pie.');return;}
  if(near?.type==='studio'){saveVisit('studio');openDialog('studio-dialog');return;}
  if(near?.type==='car'){driving=true;speed=0;player={x:car.x,z:car.z};world.avatar.visible=false;yaw=car.angle+Math.PI;toast('W / S: acelerar y reversa · A / D: girar · E: bajar');return;}
  if(near?.type==='place'){saveVisit(near.id);toast(`${near.name} · lugar registrado en el mapa`);return;}
  toast('Acércate al carro dorado, al estudio o a una parada.');
}
$('interact').addEventListener('click',interact);$('touch-interact').addEventListener('click',interact);
function teleport(x,z,label){
  const road=nearestRoad(x,z,data.roads);let target={x:road.x,z:road.z};
  if(blocked(target.x,target.z,.6)){let found=false;for(let radius=2;radius<40&&!found;radius+=2)for(let a=0;a<Math.PI*2;a+=.45){const tx=road.x+Math.sin(a)*radius,tz=road.z+Math.cos(a)*radius;if(!blocked(tx,tz,.6)){target={x:tx,z:tz};found=true;break;}}if(!found){toast('Ese punto no tiene un acceso libre. Prueba otro destino.');return;}}
  driving=false;speed=0;world.avatar.visible=true;player=target;world.avatar.position.set(player.x,0,player.z);yaw=road.angle+Math.PI;pitch=.3;
  // Bring the player's vehicle only onto a nearby clear drivable position.
  const carRoad=nearestRoad(target.x,target.z,data.roads,true);
  for(const offset of [10,-10,16,-16]){const cx=carRoad.x+Math.sin(carRoad.angle)*offset,cz=carRoad.z+Math.cos(carRoad.angle)*offset;if(!blocked(cx,cz,1.45)){car={x:cx,z:cz,angle:carRoad.angle};world.playerCar.position.set(cx,0,cz);world.playerCar.rotation.y=car.angle;break;}}
  resetInput();dialogs.forEach(d=>{if(d.open)d.close();});if(!started)start();else{active=true;$('intro').hidden=true;$('hud').hidden=false;}
  cameraUpdate(.01,true);toast(`Llegaste a ${label}. Tu carro está cerca.`);canvas.focus();
}
$('home-button').addEventListener('click',()=>teleport(world.spawn.x,world.spawn.z,'Calle 7, junto al Parque Santander'));
$('travel-neighborhood').addEventListener('click',()=>{const n=data?.neighborhoods.find(n=>n.id===$('neighborhoods').value);if(n)teleport(n.x,n.z,n.name);});

let quality=0;const qualityNames=['Auto','Ligera','Alta'];
function applyQuality(){if(!world)return;const ratio=quality===1?1:quality===2?Math.min(devicePixelRatio,2):Math.min(devicePixelRatio,world.mobile?1.3:1.6);world.renderer.setPixelRatio(ratio);world.renderer.shadowMap.enabled=quality!==1;world.renderer.setSize(innerWidth,innerHeight);$('quality-label').textContent=qualityNames[quality];}
$('quality-button').addEventListener('click',()=>{quality=(quality+1)%3;applyQuality();toast(`Calidad ${qualityNames[quality].toLowerCase()}`);});
$('time-button').addEventListener('click',()=>{dayIndex=(dayIndex+1)%3;const configs=[{name:'Tarde',sun:'#fff1cf',intensity:3.2,hemi:2.4,fog:'#b6c8b1',elevation:230,exposure:1.05},{name:'Atardecer',sun:'#ffc18a',intensity:2.3,hemi:1.5,fog:'#c4a58c',elevation:55,exposure:1.1},{name:'Mañana',sun:'#fff9ec',intensity:3.8,hemi:2.8,fog:'#b6d4d1',elevation:360,exposure:1.05}];const c=configs[dayIndex];world.sun.color.set(c.sun);world.sun.intensity=c.intensity;world.hemi.intensity=c.hemi;world.scene.fog.color.set(c.fog);world.renderer.toneMappingExposure=c.exposure;world.sun.userData.elevation=c.elevation;world.sky.material.uniforms.sunPosition.value.set(-160,c.elevation,100).normalize();$('time-label').textContent=c.name;});
$('photo-button').addEventListener('click',()=>{photoRequested=true;});

window.addEventListener('keydown',e=>{
  if(dialogs.some(d=>d.open)||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;
  if(e.code==='Escape'){e.preventDefault();if(started){active?pause():start();}return;}
  if(!active)return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE','KeyM'].includes(e.code))e.preventDefault();
  if(!e.repeat&&e.code==='KeyE')interact();if(!e.repeat&&e.code==='KeyM')openDialog('map-dialog');keys.add(e.code);
});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{resetInput();if(active)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){resetInput();if(active)pause();}});
let pointer=null;
canvas.addEventListener('pointerdown',e=>{if(!active)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!active||pointer?.id!==e.pointerId)return;yaw-=(e.clientX-pointer.x)*.004;pitch=Math.max(.08,Math.min(1.1,pitch+(e.clientY-pointer.y)*.003));pointer.x=e.clientX;pointer.y=e.clientY;lookTime=clock;});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>pointer=null);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
let joystickPointer=null;
function moveStick(e){if(e.pointerId!==joystickPointer)return;const r=$('joystick').getBoundingClientRect(),dx=(e.clientX-r.left-r.width/2)/43,dy=(e.clientY-r.top-r.height/2)/43,l=Math.max(1,Math.hypot(dx,dy));stick={x:dx/l,y:dy/l};$('stick').style.transform=`translate(${stick.x*34}px,${stick.y*34}px)`;}
$('joystick').addEventListener('pointerdown',e=>{if(!active)return;joystickPointer=e.pointerId;$('joystick').setPointerCapture(e.pointerId);moveStick(e);});$('joystick').addEventListener('pointermove',moveStick);
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(event,()=>{joystickPointer=null;stick={x:0,y:0};$('stick').style.transform='';});
$('run-button').addEventListener('pointerdown',e=>{sprinting=true;$('run-button').setPointerCapture(e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])$('run-button').addEventListener(event,()=>sprinting=false);

function cameraUpdate(dt,snap=false){
  if(!world)return;const {camera,spawn}=world;
  let target,pos;
  if(!started){const angle=.9+(reduced?0:clock*.015);const focus=data.meta.focus||[spawn.x,spawn.z];target=new T.Vector3(focus[0],10,focus[1]);pos=new T.Vector3(focus[0]+Math.sin(angle)*200,135,focus[1]+Math.cos(angle)*200);}
  else{const distance=driving?10.5:7.3;target=new T.Vector3(player.x,driving?1.45:1.35,player.z);let actual=distance;
    for(let d=1.5;d<distance;d+=.5){const cx=player.x+Math.sin(yaw)*d,cz=player.z+Math.cos(yaw)*d;if(blocked(cx,cz,.15)){actual=Math.max(1.2,d-.5);break;}}
    pos=new T.Vector3(player.x+Math.sin(yaw)*actual*Math.cos(pitch),target.y+Math.sin(pitch)*actual+1,player.z+Math.cos(yaw)*actual*Math.cos(pitch));}
  camera.position.lerp(pos,snap?1:1-Math.exp(-dt*8));camera.lookAt(target);
  world.sun.position.set(player.x-160,world.sun.userData.elevation||230,player.z+100);world.sun.target.position.set(player.x,0,player.z);world.sun.target.updateMatrixWorld();
}
function update(dt){
  if(!world)return;
  if(active){
    let forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-stick.y;
    let sideways=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+stick.x;
    forward=Math.max(-1,Math.min(1,forward));sideways=Math.max(-1,Math.min(1,sideways));
    if(driving){
      speed+=forward*dt*9;speed*=Math.exp(-dt*(forward?.24:1.45));speed=Math.max(-7,Math.min(24,speed));if(keys.has('Space'))speed*=Math.exp(-dt*8);
      car.angle-=sideways*dt*1.65*Math.min(Math.abs(speed)/5,1)*Math.sign(speed||1);
      const ox=car.x,oz=car.z;moveWithCollision(car,Math.sin(car.angle)*speed*dt,Math.cos(car.angle)*speed*dt,blocked,1.45);const moved=Math.hypot(car.x-ox,car.z-oz);if(moved<Math.abs(speed)*dt*.45)speed*=.4;
      player={x:car.x,z:car.z};world.playerCar.position.set(car.x,0,car.z);world.playerCar.rotation.y=car.angle;
      if(clock-lookTime>2){const desired=car.angle+Math.PI;let delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));yaw+=delta*(1-Math.exp(-dt*2));}
    }else{
      const l=Math.max(1,Math.hypot(forward,sideways)),velocity=(keys.has('ShiftLeft')||keys.has('ShiftRight')||sprinting)?6.3:3.2;
      const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*sideways)/l*velocity*dt,dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*sideways)/l*velocity*dt;
      const ox=player.x,oz=player.z;
      const walkingBlocked=(x,z,r)=>blocked(x,z,r)||Math.hypot(x-car.x,z-car.z)<1.55;
      moveWithCollision(player,dx,dz,walkingBlocked);const moved=Math.hypot(player.x-ox,player.z-oz);walkDistance+=moved;
      world.avatar.position.set(player.x,0,player.z);if(moved>.001){const desired=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(desired-world.avatar.rotation.y),Math.cos(desired-world.avatar.rotation.y));world.avatar.rotation.y+=delta*(1-Math.exp(-dt*12));}
      const swing=moved>.001?Math.sin(walkDistance*3.1)*.58:0;world.avatar.userData.limbs.forEach((limb,i)=>limb.rotation.x=swing*(i%2?1:-1)*(i>1?-.8:1));
    }
    updateTraffic(world.traffic,dt,player);
  }
  world.beacon.rotation.z=clock*.5;world.beacon.position.y=5.2+Math.sin(clock*2)*.15;
  cameraUpdate(dt);
  if(clock-uiClock>.18){uiClock=clock;updateHUD();drawMap($('minimap'),false);}
}
function updateHUD(){
  if(!data||!started)return;const r=nearestRoad(player.x,player.z,data.roads);$('location').textContent=r.distance<35?r.name:nearestNeighborhood()?.name||'Neiva';$('mode').textContent=driving?`Conduciendo · ${Math.round(Math.abs(speed)*3.6)} km/h`:'A pie · sin afán';
  const ds=Math.hypot(player.x-world.studio.x,player.z-world.studio.z),dc=Math.hypot(player.x-car.x,player.z-car.z);
  near=ds<12?{type:'studio'}:dc<6?{type:'car'}:null;
  for(const p of destinations.filter(p=>p.id!=='studio')){const d=Math.hypot(player.x-p.x,player.z-p.z);if(d<55&&!progress.has(p.id))saveVisit(p.id);if(d<35&&!near)near={...p,type:'place'};}
  $('interact').hidden=!driving&&!near;$('interact-text').textContent=driving?'Bajar del carro':near?.type==='studio'?'Visitar el estudio de Jhon':near?.type==='car'?'Conducir el carro':near?.name||'Explorar';
  $('touch-interact').setAttribute('aria-label',$('interact-text').textContent);
}
function nearestNeighborhood(){return data.neighborhoods.reduce((best,n)=>!best||Math.hypot(n.x-player.x,n.z-player.z)<Math.hypot(best.x-player.x,best.z-player.z)?n:best,null);}
function drawMap(target,full){
  if(!world)return;const ctx=target.getContext('2d'),w=target.width,h=target.height;
  const extent=data.meta.extent;const min=extent.min,max=extent.max;
  const scale=full?Math.min((w-50)/(max[0]-min[0]),(h-50)/(max[1]-min[1])):.28;
  const center=full?[(min[0]+max[0])/2,(min[1]+max[1])/2]:[player.x,player.z];
  const toX=x=>(x-center[0])*scale+w/2,toZ=z=>(z-center[1])*scale+h/2;
  ctx.fillStyle='#18312b';ctx.fillRect(0,0,w,h);
  const path=(points,close=false)=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(toX(p[0]),toZ(p[1])):ctx.moveTo(toX(p[0]),toZ(p[1])));if(close)ctx.closePath();};
  for(const p of data.parks){path(p.points,true);ctx.fillStyle='#35513b';ctx.fill();}
  for(const r of data.roads){if(!full&&r.points.every(p=>Math.abs(p[0]-player.x)>650||Math.abs(p[1]-player.z)>550))continue;path(r.points);ctx.strokeStyle='#708473';ctx.lineWidth=Math.max(full?.55:1,r.width*scale*.6);ctx.stroke();}
  ctx.fillStyle='#a5ac8b88';for(const b of data.buildings){if(!full&&Math.hypot(b.points[0][0]-player.x,b.points[0][1]-player.z)>700)continue;path(b.points,true);ctx.fill();}
  for(const r of data.water){path(r.points,r.polygon);ctx.fillStyle=ctx.strokeStyle='#3c7374';ctx.lineWidth=Math.max(2,(r.width||10)*scale);r.polygon?ctx.fill():ctx.stroke();}
  for(const p of destinations){const x=toX(p.x),z=toZ(p.z);ctx.fillStyle=p.id==='studio'?'#e7f89a':'#b6d8c0';ctx.beginPath();ctx.arc(x,z,full?5:4,0,Math.PI*2);ctx.fill();if(full){ctx.font='13px Arial';ctx.fillText(p.name,x+9,z+4);}}
  const x=toX(player.x),z=toZ(player.z);ctx.save();ctx.translate(x,z);ctx.rotate((driving?car.angle:world.avatar.rotation.y)*-1);ctx.fillStyle='#d5fa77';ctx.strokeStyle='#19342a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(-6,-6);ctx.lineTo(0,-3);ctx.lineTo(6,-6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function updateQuest(){const next=destinations.find(p=>!progress.has(p.id));$('quest-title').textContent=next?(next.id==='studio'?'Encuentra el pequeño estudio':next.name):'La ruta ya es tuya';$('quest-description').textContent=next?(next.id==='studio'?'Una puerta abierta para tu próxima idea.':'Tu siguiente parada. El mapa te lleva hasta su acceso.'):'Sigue explorando los barrios del mapa.';}
function setupDestinations(){
  const find=re=>data.places.find(p=>re.test(p.name));
  const santander=find(/Santander/i),malecon=find(/Malecon Río|Malecón/i),music=find(/Parque de la M[uú]sica/i);
  destinations=[{id:'studio',name:'El estudio de Jhon',x:world.studio.x,z:world.studio.z},santander,malecon,music].filter(Boolean);
  if(destinations.length<4)for(const p of data.places.filter(p=>/Caracolí|EL MOHAN|Edificio Nacional/.test(p.name))){if(destinations.length>=4)break;destinations.push(p);}
  for(const p of destinations){const button=document.createElement('button'),label=document.createElement('span');button.textContent=p.name;label.textContent='↗';button.append(label);button.addEventListener('click',()=>teleport(p.x,p.z,p.name));$('destinations').append(button);}
  for(const n of [...data.neighborhoods].sort((a,b)=>a.name.localeCompare(b.name,'es'))){const option=document.createElement('option');option.value=n.id;option.textContent=n.name;$('neighborhoods').append(option);}
  $('progress').textContent=`${destinations.filter(p=>progress.has(p.id)).length} / ${destinations.length}`;updateQuest();
}
window.addEventListener('resize',()=>{if(!world)return;world.camera.aspect=innerWidth/innerHeight;world.camera.updateProjectionMatrix();world.renderer.setSize(innerWidth,innerHeight);});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();toast('Se perdió la conexión gráfica. Recarga la página para volver a jugar.');});
async function boot(){
  try{
    const response=await fetch('/data/neiva.json');if(!response.ok)throw new Error('No se pudo cargar el mapa');data=await response.json();
    world=await createWorld(canvas,data,message=>$('load-status').textContent=message);
    const {min,max}=data.meta.extent;const studio=world.studio;
    const polygons=[...data.buildings,...data.water.filter(w=>w.polygon),{points:[[studio.x-3,studio.z-2],[studio.x+3,studio.z-2],[studio.x+3,studio.z+2],[studio.x-3,studio.z+2]]}];
    const solid=createCollisionIndex(polygons,{minX:min[0],maxX:max[0],minZ:min[1],maxZ:max[1]});
    // Bridges remain traversable over water; building collision still applies.
    const buildingsOnly=createCollisionIndex([...data.buildings,polygons.at(-1)],{minX:min[0],maxX:max[0],minZ:min[1],maxZ:max[1]});
    const bridgeRoads=data.roads.filter(r=>r.bridge);
    blocked=(x,z,r)=>{if(!solid(x,z,r))return false;if(bridgeRoads.length&&!buildingsOnly(x,z,r)){const br=nearestRoad(x,z,bridgeRoads);if(br.distance<(br.width/2-r))return false;}return true;};
    player={...world.spawn};car={x:world.playerCar.position.x,z:world.playerCar.position.z,angle:world.playerCar.rotation.y};setupDestinations();
    const date=new Date(data.meta.fetchedAt).toLocaleDateString('es-CO',{timeZone:'America/Bogota'});$('map-stats').textContent=`Cartografía consultada: ${date}. ${data.roads.length.toLocaleString('es-CO')} vías, ${data.buildings.length.toLocaleString('es-CO')} huellas de edificios y ${data.neighborhoods.length} etiquetas de barrios en este recorte. Edificios combinados de OSM y Overture; las huellas detectadas automáticamente y las alturas estimadas se identifican en la descarga.`;
    $('loading').hidden=true;$('play').disabled=false;$('play-label').textContent='Entrar a la ciudad';cameraUpdate(1,true);
    // Small read-only diagnostics interface for reproducible browser checks.
    window.neiva={snapshot:()=>({ready:true,active,driving,player:{...player},car:{...car},studio:{...world.studio},spawn:{...world.spawn},near:near?.type||null,progress:[...progress],roads:data.roads.length,buildings:data.buildings.length,triangles:world.renderer.info.render.triangles,calls:world.renderer.info.render.calls}),isBlocked:(x,z,r)=>blocked(x,z,r)};
    requestAnimationFrame(frame);
  }catch(error){console.error(error);$('loading').hidden=true;$('play-label').textContent='Recargar ciudad';$('play').disabled=false;$('play').replaceWith($('play').cloneNode(true));$('play').addEventListener('click',()=>location.reload());$('load-status').textContent='';$('intro').querySelector('.intro-description').textContent='No se pudo iniciar el entorno 3D. Prueba un navegador con WebGL 2 o recarga la página.';toast('La ciudad no pudo cargarse. Puedes volver a intentarlo.');}
}
function frame(time){const dt=Math.min((time-lastTime)/1000||.016,.05);lastTime=time;clock+=dt;if(!document.hidden){update(dt);world.renderer.render(world.scene,world.camera);if(photoRequested){photoRequested=false;const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='neiva-abierta.png';a.click();toast('Foto guardada. La imagen muestra esta interpretación de Neiva.');}}requestAnimationFrame(frame);}
boot();
