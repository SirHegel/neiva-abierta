import * as T from 'three';
import { createWorld,updateTraffic } from './world-realistic.js';
import { createCollisionIndex,moveWithCollision,nearestRoad,safeExit,parseProgress } from './physics.js';
import { createLookController,normalizeSensitivity,WALK_SPEED } from './controls.js';
import { applyUrbanSurvey } from './urban-data.js';
import { createRoadIndex,createFeatureIndex,inspectBuildingRay } from './spatial.js';
import { createMapView } from './map-view.js';
import { createFixedStepper,stepWalk,settleWalkMotion,stepVehicle,settleVehicleMotion,createObservationStops,createObservationTour,guideToDestination } from './gameplay.js';
import { applyCartographicCorrections,buildingCollisionPolygons } from './cartographic-corrections.js';
import { buildingRecord,streetViewUrl } from './building-inspection.js';

const $=id=>document.getElementById(id),canvas=$('world'),keys=new Set();
let world,data,survey,roadIndex,buildingIndex,mapView,tour,blocked,active=false,started=false,driving=false,speed=0,yaw=0,pitch=.12,lookTime=0,clock=0,uiClock=0,lastTime=0,photoRequested=false,movementSpeed=0;
let player={x:0,z:0},car={x:0,z:0,angle:0},previousPlayer={x:0,z:0},previousCar={x:0,z:0,angle:0},visualPlayer={x:0,z:0},walkMotion={vx:0,vz:0},vehicleMotion={speed:0,angle:0,steerAngle:0},selectedDestination=null,destinations=[],near=null,walkDistance=0,dayIndex=0;
let stick={x:0,y:0},sprinting=false,lastDialogFocus=null,resumeAfterDialog=false,joystickPointer=null;const dialogs=[...document.querySelectorAll('dialog')];
const simulation=createFixedStepper();
const frameMetrics={frames:0,fps:0,frameMs:0,updateMs:0,simulation:null};let sampleTime=0,sampleFrames=0,lastRendered=0;
const roadAt=(x,z,drivable=false)=>roadIndex.nearest(x,z,drivable);
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
const touchInput=matchMedia('(pointer:coarse)');
let sensitivity=1;try{sensitivity=normalizeSensitivity(JSON.parse(localStorage.getItem('neiva-abierta.controls.v1'))?.sensitivity??1);}catch{}
let progress;try{progress=parseProgress(localStorage.getItem('neiva-abierta.visits.v2'));}catch{progress=new Set();}
const toast=message=>{$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$('toast').hidden=true,4000);};
const look=createLookController({canvas,isActive:()=>active&&!dialogs.some(d=>d.open),isTouch:()=>touchInput.matches,onPause:()=>pause(),onLook:(x,y)=>{yaw-=x*(touchInput.matches?.0045:.0026)*sensitivity;pitch=Math.max(-.3,Math.min(1.05,pitch+y*(touchInput.matches?.003:.0022)*sensitivity));lookTime=clock;},onMode:mode=>{document.body.classList.toggle('mouse-locked',mode==='locked');$('look-status').textContent=mode==='locked'?'Mouse activo · Esc para soltar':mode==='free'?'Mouse sin captura · clic en la ciudad para reintentar':mode==='pending'?'Activando mouse…':'Mouse para mirar';if(mode==='free')toast('El navegador no capturó el mouse. Muévelo sobre la ciudad sin pulsar; haz clic para reintentar.');}});
function setSprint(value){sprinting=value&&!driving&&active;$('run-button').setAttribute('aria-pressed',String(sprinting));$('run-label').textContent=sprinting?'Caminar':'Correr';$('run-button').setAttribute('aria-label',sprinting?'Dejar de correr':'Activar carrera');}
const resetInput=()=>{keys.clear();stick={x:0,y:0};joystickPointer=null;movementSpeed=0;setSprint(false);look.reset();simulation.reset();walkMotion={vx:0,vz:0};previousPlayer={...player};previousCar={...car};visualPlayer={...player};vehicleMotion={speed,angle:car.angle,steerAngle:0};lastTime=0;$('stick').style.transform='';};
function openDialog(id){if(!world&&id==='map-dialog')return;if($(id).open)return;if(!dialogs.some(d=>d.open)){lastDialogFocus=document.activeElement;resumeAfterDialog=active;}active=false;resetInput();look.release();$(id).showModal();if(id==='map-dialog')drawMap($('atlas'),true);}
function closeDialog(dialog,resume=true){const shouldResume=resume&&resumeAfterDialog;resumeAfterDialog=false;dialog.close();if(shouldResume&&!dialogs.some(d=>d.open))start();else{if(started)pause();else lastDialogFocus?.focus();}}
for(const d of dialogs){d.querySelector('.close').addEventListener('click',()=>closeDialog(d));d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(d,false);});d.addEventListener('close',()=>{if(!dialogs.some(d=>d.open)&&!active){resetInput();if(started)pause();}});d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d);}});}
function saveVisit(id){if(progress.has(id))return;progress.add(id);try{localStorage.setItem('neiva-abierta.visits.v2',JSON.stringify([...progress]));}catch{}const count=destinations.filter(p=>progress.has(p.id)).length;$('progress').textContent=`${count} / ${destinations.length}`;updateQuest();if(id==='studio')toast('Encontraste el estudio de Jhon. Bienvenido.');else toast(`Nueva parada: ${destinations.find(p=>p.id===id)?.name||'Neiva'}`);if(count===destinations.length){$('quest-title').textContent='La ruta ya es tuya';$('quest-description').textContent='Sigue explorando los barrios del mapa.';}}
function start(){if(!world||dialogs.some(d=>d.open))return;const first=!started;started=active=true;document.body.classList.add('playing');$('intro').hidden=true;$('hud').hidden=false;$('menu-button').setAttribute('aria-label','Pausar juego');resetInput();if(first){const r=roadAt(player.x,player.z,true);yaw=r.angle+Math.PI;pitch=.12;world.avatar.rotation.y=r.angle;cameraUpdate(1,true);}canvas.focus();look.request();if(first)toast(touchInput.matches?'Palanca para moverte · toca Correr · desliza la ciudad para mirar.':'Mueve el mouse para mirar · WASD caminar · Shift correr · M mapa · Esc pausa.');}
function pause(){if(!world||!started)return;active=false;resumeAfterDialog=false;resetInput();look.release();$('intro').hidden=false;$('hud').hidden=true;$('play-label').textContent='Seguir explorando';$('menu-button').setAttribute('aria-label','Continuar juego');if(!dialogs.some(d=>d.open))$('play').focus();}
$('play').addEventListener('click',start);
$('menu-button').addEventListener('click',()=>{if(started&&active)pause();else if(started)start();else openDialog('about-dialog');});
for(const id of ['map-button','minimap-button','guide-button','route-guide'])$(id).addEventListener('click',()=>openDialog('map-dialog'));
for(const id of ['about-button','coverage-button'])$(id).addEventListener('click',()=>openDialog('about-dialog'));
$('controls-button').addEventListener('click',()=>openDialog('controls-dialog'));
$('sensitivity').value=String(sensitivity);$('sensitivity-value').value=`${sensitivity.toFixed(1)}×`;
$('sensitivity').addEventListener('input',e=>{sensitivity=normalizeSensitivity(e.target.value);$('sensitivity-value').value=`${sensitivity.toFixed(1)}×`;try{localStorage.setItem('neiva-abierta.controls.v1',JSON.stringify({sensitivity}));}catch{}});
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('Este navegador no ofrece pantalla completa.');}catch{toast('No se pudo activar la pantalla completa. Puedes seguir jugando.');}}
$('fullscreen-button').addEventListener('click',toggleFullscreen);

function interact(){
  if(!active||!world)return;
  // E must use the current position, including immediately after travelling.
  updateHUD();
  if(driving){const exit=safeExit(car,blocked);if(!exit){toast('No hay espacio para bajar. Mueve un poco el carro.');return;}driving=false;speed=0;player={...exit};world.avatar.visible=true;world.avatar.position.set(player.x,0,player.z);resetInput();toast('De nuevo a pie.');return;}
  if(near?.type==='studio'){saveVisit('studio');openDialog('studio-dialog');return;}
  if(near?.type==='car'){driving=true;speed=0;player={x:car.x,z:car.z};resetInput();world.avatar.visible=false;yaw=car.angle+Math.PI;toast(touchInput.matches?'Palanca para acelerar y girar · botón Freno · E para bajar.':'W / S acelerar y reversa · A / D girar · Espacio frenar · E bajar');return;}
  if(near?.type==='place'){observePlace(near.id);return;}
  toast('Acércate al carro dorado, al estudio o a una parada.');
}
$('interact').addEventListener('click',interact);$('touch-interact').addEventListener('click',interact);
function resolveAccess(destination){
  const road=roadAt(destination.x,destination.z);
  if(!blocked(road.x,road.z,.65))return {x:road.x,z:road.z};
  for(let radius=2;radius<=40;radius+=2)for(let angle=0;angle<Math.PI*2;angle+=.4){const p={x:road.x+Math.sin(angle)*radius,z:road.z+Math.cos(angle)*radius};if(!blocked(p.x,p.z,.65))return p;}
  return null;
}
function observePlace(id){
  const result=tour?.observe(id,player,{onFoot:!driving});if(!result?.ok)return;
  saveVisit(id);const stop=result.stop;
  $('observation-title').textContent=stop.name;$('observation-text').textContent=stop.text;$('observation-focus').textContent=stop.focus;
  $('observation-sources').replaceChildren();
  for(const source of stop.references){const element=document.createElement(source.url?'a':'span');element.textContent=source.title;if(source.url){element.href=source.url;element.target='_blank';element.rel='noreferrer';}$('observation-sources').append(element);}
  openDialog('observation-dialog');
}
function selectDestination(destination){selectedDestination=destination;if(!tour?.select(destination.id))tour?.select(null);updateQuest();toast(`Destino: ${destination.name}. La flecha indica la dirección, en línea recta.`);}
$('next-stop').addEventListener('click',()=>{const next=destinations.find(p=>!progress.has(p.id));if(next)selectDestination(next);closeDialog($('observation-dialog'));});
function inspectBuilding(){
  if(!world||!active)return;
  const direction=world.camera.getWorldDirection(new T.Vector3()),hit=inspectBuildingRay(buildingIndex,world.camera.position,direction,95);
  if(!hit){toast('Mira hacia un edificio cercano y pulsa Ver edificio.');return;}
  const record=buildingRecord(hit.building,data.meta.origin),fmt=n=>n.toLocaleString('es-CO',{maximumFractionDigits:1});
  $('building-title').textContent=record.name;
  $('building-id').textContent=record.id;
  const measures=[['Huella en el mapa',`${fmt(record.area)} m²`],['Rectángulo envolvente',`${fmt(record.width)} × ${fmt(record.depth)} m`],['Altura representada',`${fmt(record.height)} m · ${record.heightEstimated?'estimada':'etiqueta OSM'}`],['Origen de la huella',record.footprintOrigin]];
  $('building-measures').replaceChildren();for(const [label,value] of measures){const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;row.append(term,description);$('building-measures').append(row);}
  $('building-height-origin').textContent=record.heightOrigin+'. Las medidas se calculan sobre esta cartografía; no son mediciones de campo ni prueban una fachada idéntica.';
  $('building-source').href=record.sourceUrl;$('building-streetview').href=streetViewUrl(player,record.center,data.meta.origin);
  openDialog('building-dialog');
}
$('inspect-button').addEventListener('click',inspectBuilding);
function teleport(x,z,label){
  const road=roadAt(x,z);let target={x:road.x,z:road.z};
  if(blocked(target.x,target.z,.6)){let found=false;for(let radius=2;radius<40&&!found;radius+=2)for(let a=0;a<Math.PI*2;a+=.45){const tx=road.x+Math.sin(a)*radius,tz=road.z+Math.cos(a)*radius;if(!blocked(tx,tz,.6)){target={x:tx,z:tz};found=true;break;}}if(!found){toast('Ese punto no tiene un acceso libre. Prueba otro destino.');return;}}
  driving=false;speed=0;world.avatar.visible=true;player=target;world.avatar.position.set(player.x,0,player.z);yaw=road.angle+Math.PI;pitch=.12;
  // Bring the player's vehicle only onto a nearby clear drivable position.
  const carRoad=roadAt(target.x,target.z,true);
  for(const offset of [10,-10,16,-16]){const cx=carRoad.x+Math.sin(carRoad.angle)*offset,cz=carRoad.z+Math.cos(carRoad.angle)*offset;if(!blocked(cx,cz,1.45)){car={x:cx,z:cz,angle:carRoad.angle};world.playerCar.position.set(cx,0,cz);world.playerCar.rotation.y=car.angle;break;}}
  resetInput();resumeAfterDialog=false;dialogs.forEach(d=>{if(d.open)d.close();});start();
  cameraUpdate(.01,true);toast(`Llegaste a ${label}. Tu carro está cerca.`);canvas.focus();
}
$('home-button').addEventListener('click',()=>teleport(world.spawn.x,world.spawn.z,'Calle 7, junto al Parque Santander'));
$('travel-neighborhood').addEventListener('click',()=>{const n=data?.neighborhoods.find(n=>n.id===$('neighborhoods').value);if(n)teleport(n.x,n.z,n.name);});

let quality=0,weather='after-rain',weatherBusy=false;const qualityNames=['Auto','Ligera','Alta'];
function applyQuality(){if(!world)return;world.setQuality(quality);$('quality-label').textContent=qualityNames[quality];}
$('quality-button').addEventListener('click',()=>{quality=(quality+1)%3;applyQuality();toast(`Calidad ${qualityNames[quality].toLowerCase()}`);});
$('time-button').addEventListener('click',()=>{dayIndex=(dayIndex+1)%3;world.setTime(dayIndex);$('time-label').textContent=['Tarde','Atardecer','Mañana'][dayIndex];});
$('photo-button').addEventListener('click',()=>{photoRequested=true;});
$('weather-button').addEventListener('click',async()=>{if(weatherBusy||typeof world?.setWeather!=='function')return;weatherBusy=true;$('weather-button').disabled=true;try{const next=weather==='clear'?'after-rain':'clear';await world.setWeather(next);weather=world.weather?.mode||next;$('weather-label').textContent=weather==='clear'?'Seco':'Tras lluvia';toast(weather==='clear'?'La ciudad bajo el sol.':'La ciudad después de la lluvia.');}catch{toast('No se pudo cambiar el ambiente. Puedes seguir explorando.');}finally{weatherBusy=false;$('weather-button').disabled=false;}});

window.addEventListener('keydown',e=>{
  if(dialogs.some(d=>d.open)||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;
  if(['Space','Enter'].includes(e.code)&&document.activeElement?.tagName==='BUTTON')return;
  if(e.code==='Escape'){if(active){e.preventDefault();pause();}return;}
  if(!active)return;
  if(e.code==='Tab'){pause();return;}
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE','KeyM','KeyC','KeyF','KeyL','KeyQ','KeyP','KeyH','KeyT','KeyI','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();
  if(e.code==='KeyE'){if(!e.repeat)interact();return;}
  if(e.code==='KeyM'){if(!e.repeat)openDialog('map-dialog');return;}
  if(e.code==='KeyI'){if(!e.repeat)inspectBuilding();return;}
  if(e.code==='KeyC'){if(!e.repeat)openDialog('controls-dialog');return;}
  if(e.code==='KeyF'){if(!e.repeat)toggleFullscreen();return;}
  const toolKey={KeyL:'weather-button',KeyQ:'quality-button',KeyP:'photo-button',KeyH:'home-button',KeyT:'time-button'}[e.code];if(toolKey){if(!e.repeat)$(toolKey).click();return;}
  keys.add(e.code);
});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{resetInput();if(active)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){resetInput();if(active)pause();}});
function moveStick(e){if(!active||e.pointerId!==joystickPointer)return;const r=$('joystick').getBoundingClientRect(),radius=(r.width-40)/2,dx=(e.clientX-r.left-r.width/2)/radius,dy=(e.clientY-r.top-r.height/2)/radius,l=Math.hypot(dx,dy),gain=l<.12?0:(Math.min(1,l)-.12)/(.88*l);stick={x:dx*gain,y:dy*gain};$('stick').style.transform=`translate(${stick.x*radius}px,${stick.y*radius}px)`;}
$('joystick').addEventListener('pointerdown',e=>{if(!active||joystickPointer!==null)return;e.preventDefault();joystickPointer=e.pointerId;$('joystick').setPointerCapture(e.pointerId);moveStick(e);});$('joystick').addEventListener('pointermove',moveStick);
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(event,e=>{if(e.pointerId!==joystickPointer)return;joystickPointer=null;stick={x:0,y:0};$('stick').style.transform='';});
$('run-button').addEventListener('click',()=>{if(active&&!driving)setSprint(!sprinting);});
$('brake-button').addEventListener('pointerdown',e=>{if(!active||!driving)return;e.preventDefault();keys.add('Space');$('brake-button').setPointerCapture(e.pointerId);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('brake-button').addEventListener(event,()=>keys.delete('Space'));

function cameraUpdate(dt,snap=false){
  if(!world)return;const {camera}=world;const cameraPlayer=snap?player:visualPlayer;
  let target,pos;
  if(!started){const focus=data.meta.focus,drift=reduced?0:Math.sin(clock*.07)*1.1;target=new T.Vector3(-917.4,13,-63.8);pos=new T.Vector3(focus[0]-18+drift,2.5,focus[1]-25);}
  else{const distance=driving?7.6:4.7;let shoulder=driving?0:.55;if(blocked(cameraPlayer.x+Math.cos(yaw)*shoulder,cameraPlayer.z-Math.sin(yaw)*shoulder,.2))shoulder=0;target=new T.Vector3(cameraPlayer.x+Math.cos(yaw)*shoulder,driving?1.25:1.45,cameraPlayer.z-Math.sin(yaw)*shoulder);let actual=distance;
    for(let d=.55;d<distance;d+=.3){const cx=target.x+Math.sin(yaw)*d*Math.cos(pitch),cz=target.z+Math.cos(yaw)*d*Math.cos(pitch);if(blocked(cx,cz,.18)){actual=Math.max(.4,d-.3);break;}}
    pos=new T.Vector3(target.x+Math.sin(yaw)*actual*Math.cos(pitch),Math.max(.45,target.y+Math.sin(pitch)*actual),target.z+Math.cos(yaw)*actual*Math.cos(pitch));}
  camera.position.lerp(pos,snap?1:1-Math.exp(-dt*14));camera.lookAt(target);
  world.sun.position.set(player.x-160,world.sun.userData.elevation||230,player.z+(started?100:-140));world.sun.target.position.set(player.x,0,player.z);world.sun.target.updateMatrixWorld();
}
function simulate(dt){
  previousPlayer={...player};previousCar={...car};
  const forward=Math.max(-1,Math.min(1,(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-stick.y));
  const sideways=Math.max(-1,Math.min(1,(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+stick.x));
  if(driving){
    const motion=stepVehicle(vehicleMotion,{throttle:forward,steer:sideways,brake:keys.has('Space')},dt),ox=car.x,oz=car.z;
    moveWithCollision(car,motion.dx,motion.dz,blocked,1.45);
    vehicleMotion=settleVehicleMotion(motion,car.x-ox,car.z-oz,dt);speed=vehicleMotion.speed;car.angle=vehicleMotion.angle;player={x:car.x,z:car.z};
    if(clock-lookTime>2){const desired=car.angle+Math.PI,delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));yaw+=delta*(1-Math.exp(-dt*2));}
  }else{
    const motion=stepWalk(walkMotion,{forward,sideways,yaw,sprint:sprinting||keys.has('ShiftLeft')||keys.has('ShiftRight')},dt),ox=player.x,oz=player.z;
    moveWithCollision(player,motion.dx,motion.dz,(x,z,r)=>blocked(x,z,r)||Math.hypot(x-car.x,z-car.z)<1.55);
    walkMotion=settleWalkMotion(motion,player.x-ox,player.z-oz,dt);movementSpeed=walkMotion.movingSpeed;walkDistance+=Math.hypot(player.x-ox,player.z-oz);
    if(movementSpeed>.03){const desired=Math.atan2(player.x-ox,player.z-oz),delta=Math.atan2(Math.sin(desired-world.avatar.rotation.y),Math.cos(desired-world.avatar.rotation.y));world.avatar.rotation.y+=delta*(1-Math.exp(-dt*12));}
  }
  updateTraffic(world.traffic,dt,player);
}
function update(elapsed){
  if(!world)return;const dt=Math.min(elapsed,.1);
  if(active){
    const state=simulation.advance(elapsed,simulate),alpha=state.alpha;frameMetrics.simulation=state;
    visualPlayer={x:previousPlayer.x+(player.x-previousPlayer.x)*alpha,z:previousPlayer.z+(player.z-previousPlayer.z)*alpha};
    world.avatar.position.set(visualPlayer.x,0,visualPlayer.z);
    world.playerCar.position.set(previousCar.x+(car.x-previousCar.x)*alpha,0,previousCar.z+(car.z-previousCar.z)*alpha);
    world.playerCar.rotation.y=previousCar.angle+Math.atan2(Math.sin(car.angle-previousCar.angle),Math.cos(car.angle-previousCar.angle))*alpha;
  }else visualPlayer={...player};
  if(!driving)world.updateCharacter(world.avatar,dt,active?movementSpeed:0);
  world.beacon.rotation.z=clock*.5;world.beacon.position.y=4.3+Math.sin(clock*2)*.15;
  cameraUpdate(dt);
  if(started&&(clock-uiClock>.2||!uiClock)){uiClock=clock;updateHUD();drawMap($('minimap'),false);}
}
function updateHUD(){
  if(!data||!started)return;
  const r=roadAt(player.x,player.z);$('location').textContent=r.distance<35?r.name:nearestNeighborhood()?.name||'Neiva';$('mode').textContent=driving?`Conduciendo · ${Math.round(Math.abs(speed)*3.6)} km/h`:movementSpeed>WALK_SPEED+.2?'Corriendo':movementSpeed>.08?'Caminando':sprinting?'Carrera activada':'A pie';
  $('run-button').hidden=driving;$('brake-button').hidden=!driving;
  const ds=Math.hypot(player.x-world.studio.x,player.z-world.studio.z),dc=Math.hypot(player.x-car.x,player.z-car.z),observation=tour?.nearby(player,{onFoot:!driving});
  near=ds<12?{type:'studio'}:dc<6?{type:'car'}:observation?{type:'place',id:observation.stop.id,name:observation.stop.name}:null;
  $('interact').hidden=!driving&&!near;$('interact-text').textContent=driving?'Bajar del carro':near?.type==='studio'?'Visitar el estudio de Jhon':near?.type==='car'?'Conducir el carro':near?.type==='place'?`Observar ${near.name}`:'Explorar';
  $('touch-interact').setAttribute('aria-label',$('interact-text').textContent);$('touch-interact').disabled=!driving&&!near;
  updateQuest();
}
function nearestNeighborhood(){return data.neighborhoods.reduce((best,n)=>!best||Math.hypot(n.x-player.x,n.z-player.z)<Math.hypot(best.x-player.x,best.z-player.z)?n:best,null);}
function drawMap(target,full){mapView?.draw(target,{full,player,heading:driving?car.angle:world.avatar.rotation.y,selectedId:selectedDestination?.id});}
function updateQuest(){
  const next=selectedDestination||destinations.find(p=>!progress.has(p.id));
  $('quest-title').textContent=next?.name||'La ruta ya es tuya';
  if(!next){$('quest-description').textContent='Sigue explorando los barrios del mapa.';$('route-guide').hidden=true;return;}
  const stop=tour?.selected()||{...next,point:next.point||next,interactionRadius:next.id==='studio'?12:18},guide=guideToDestination(player,stop,driving?car.angle:yaw+Math.PI);
  $('quest-description').textContent=next.id==='studio'?'Un espacio ficticio para conocer el trabajo de Jhon.':'Acércate a pie y pulsa E para observar el lugar.';
  if(guide){$('route-guide').hidden=false;$('route-arrow').style.transform=`rotate(${guide.relativeAngle}rad)`;$('route-name').textContent=next.name;$('route-distance').textContent=`${guide.distanceLabel} · ${guide.arrived?(driving?'Baja para observar':'Estás cerca'):guide.directionLabel}`;$('route-guide').setAttribute('aria-label',`${next.name}: ${guide.distanceLabel}, ${guide.directionLabel}. Distancia en línea recta.`);}
}
function setupDestinations(){
  const find=re=>data.places.find(p=>re.test(p.name));
  const santander=find(/Santander/i),malecon=find(/Malecon Río|Malecón/i),music=find(/Parque de la M[uú]sica/i);
  const civic=['way/312876443','way/313286677','way/313286678','way/313286683'].map(id=>data.places.find(place=>place.id===id));
  destinations=[{id:'studio',name:'El estudio de Jhon',x:world.studio.x,z:world.studio.z},santander,malecon,music,...civic].filter(Boolean);
  if(destinations.length<4)for(const p of data.places.filter(p=>/Caracolí|EL MOHAN|Edificio Nacional/.test(p.name))){if(destinations.length>=4)break;destinations.push(p);}
  const stops=createObservationStops(destinations,{survey,resolveAccess});tour=createObservationTour(stops,progress);
  for(const destination of destinations){const stop=stops.find(s=>s.id===destination.id);if(stop)destination.point=stop.point;
    const row=document.createElement('div'),guide=document.createElement('button'),travel=document.createElement('button');row.className='destination-row';
    guide.className='destination-guide';guide.textContent=destination.name;guide.setAttribute('aria-label',`Guiar hacia ${destination.name}`);guide.dataset.destination=destination.id;
    travel.className='destination-travel';travel.textContent='Viajar ↗';travel.setAttribute('aria-label',`Viajar a ${destination.name}`);travel.dataset.destination=destination.id;
    guide.addEventListener('click',()=>{selectDestination(destination);closeDialog($('map-dialog'));});
    travel.addEventListener('click',()=>{selectDestination(destination);const point=destination.point||destination;teleport(point.x,point.z,destination.name);});row.append(guide,travel);$('destinations').append(row);
  }
  mapView=createMapView(data,destinations);
  for(const n of [...data.neighborhoods].sort((a,b)=>a.name.localeCompare(b.name,'es'))){const option=document.createElement('option');option.value=n.id;option.textContent=n.name;$('neighborhoods').append(option);}
  $('progress').textContent=`${destinations.filter(p=>progress.has(p.id)).length} / ${destinations.length}`;updateQuest();
}
window.addEventListener('resize',()=>world?.resize());
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();toast('Se perdió la conexión gráfica. Recarga la página para volver a jugar.');});
async function boot(){
  try{
    const [response,surveyResponse,correctionsResponse]=await Promise.all([fetch('/data/neiva.json'),fetch('/data/neiva-survey.json'),fetch('/data/neiva-corrections.json')]);if(!response.ok||!surveyResponse.ok||!correctionsResponse.ok)throw new Error('No se pudo cargar el mapa y su revisión urbana');survey=await surveyResponse.json();data=applyUrbanSurvey(applyCartographicCorrections(await response.json(),await correctionsResponse.json()),survey);roadIndex=createRoadIndex(data.roads);buildingIndex=createFeatureIndex(data.buildings);
    world=await createWorld(canvas,data,message=>$('load-status').textContent=message);
    const {min,max}=data.meta.extent;const studio=world.studio;
    const trunks=(world.civic?.treeLocations||[]).map(([x,z,scale])=>({points:Array.from({length:12},(_,i)=>[x+Math.cos(i*Math.PI/6)*.24*(scale||1),z+Math.sin(i*Math.PI/6)*.24*(scale||1)])}));
    const urbanColliders=[...(data.meta.gameplayColliders||[]),...trunks];
    const buildingSolids=data.buildings.flatMap(buildingCollisionPolygons);
    const polygons=[...buildingSolids,...data.water.filter(w=>w.polygon),...urbanColliders,{points:[[studio.x-3,studio.z-2],[studio.x+3,studio.z-2],[studio.x+3,studio.z+2],[studio.x-3,studio.z+2]]}];
    const solid=createCollisionIndex(polygons,{minX:min[0],maxX:max[0],minZ:min[1],maxZ:max[1]});
    // Bridges remain traversable over water; building collision still applies.
    const buildingsOnly=createCollisionIndex([...buildingSolids,...urbanColliders,polygons.at(-1)],{minX:min[0],maxX:max[0],minZ:min[1],maxZ:max[1]});
    const bridgeRoads=data.roads.filter(r=>r.bridge);
    blocked=(x,z,r)=>{if(!solid(x,z,r))return false;if(bridgeRoads.length&&!buildingsOnly(x,z,r)){const br=nearestRoad(x,z,bridgeRoads);if(br.distance<(br.width/2-r))return false;}return true;};
    player={...world.spawn};car={x:world.playerCar.position.x,z:world.playerCar.position.z,angle:world.playerCar.rotation.y};setupDestinations();
    const date=new Date(data.meta.fetchedAt).toLocaleDateString('es-CO',{timeZone:'America/Bogota'});$('map-stats').textContent=`Cartografía consultada: ${date}. ${data.roads.length.toLocaleString('es-CO')} vías, ${data.buildings.length.toLocaleString('es-CO')} huellas de edificios y ${data.neighborhoods.length} etiquetas de barrios en este recorte. Edificios combinados de OSM y Overture; las huellas detectadas automáticamente y las alturas estimadas se identifican en la descarga.`;
    $('loading').hidden=true;$('play').disabled=false;$('play-label').textContent='Entrar a la ciudad';cameraUpdate(1,true);
    // Small read-only diagnostics interface for reproducible browser checks.
    window.neiva={snapshot:()=>({ready:true,visualVersion:world.visualVersion,active,driving,carSpeed:speed,weather:world.weather?.mode||weather,player:{...player},car:{...car},studio:{...world.studio},spawn:{...world.spawn},near:near?.type||null,progress:[...progress],route:selectedDestination?.id||null,observationStops:tour?destinations.map(p=>({id:p.id,point:p.point||null})):[],performance:structuredClone({...frameMetrics,renderer:world.performanceMetrics,map:mapView?.stats(),roadIndex:{...roadIndex.stats}}),controls:{...look.snapshot(),sensitivity,sprinting:!driving&&(sprinting||keys.has('ShiftLeft')||keys.has('ShiftRight')),movementSpeed,yaw,pitch,camera:world.camera.position.toArray()},roads:data.roads.length,buildings:data.buildings.length,triangles:world.renderer.info.render.triangles,calls:world.renderer.info.render.calls}),isBlocked:(x,z,r)=>blocked(x,z,r)};
    requestAnimationFrame(frame);
  }catch(error){console.error(error);$('loading').hidden=true;$('play-label').textContent='Recargar ciudad';$('play').disabled=false;$('play').replaceWith($('play').cloneNode(true));$('play').addEventListener('click',()=>location.reload());$('load-status').textContent='';$('intro').querySelector('.intro-description').textContent='No se pudo iniciar el entorno 3D. Prueba un navegador con WebGL 2 o recarga la página.';toast('La ciudad no pudo cargarse. Puedes volver a intentarlo.');}
}
function frame(time){
  const elapsed=lastTime?Math.max(0,(time-lastTime)/1000):1/60;lastTime=time;
  if(!document.hidden){
    // Paused scenes need only a gentle preview; physics receives wall time only while active.
    if(active||time-lastRendered>=1000/15||photoRequested){
      const visualElapsed=active?elapsed:Math.max(1/60,(time-lastRendered)/1000);lastRendered=time;clock+=visualElapsed;
      const before=performance.now();update(visualElapsed);frameMetrics.updateMs=performance.now()-before;
      world.render(Math.min(visualElapsed,.1),{active});
      if(active){sampleFrames++;frameMetrics.frames++;frameMetrics.frameMs=elapsed*1000;if(time-sampleTime>=1000){frameMetrics.fps=sampleFrames*1000/(time-sampleTime);sampleTime=time;sampleFrames=0;}}
      else{sampleTime=time;sampleFrames=0;}
      if(photoRequested){photoRequested=false;const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='neiva-abierta.png';a.click();toast('Foto guardada. La imagen muestra esta interpretación de Neiva.');}
    }
  }
  requestAnimationFrame(frame);
}
boot();
