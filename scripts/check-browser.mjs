import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const origin=process.env.GAME_TEST_URL||'http://127.0.0.1:4173';
const artifactDir=resolve(process.env.GAME_TEST_ARTIFACT_DIR||'artifacts');
await mkdir(artifactDir,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:process.env.HEADLESS==='1',args:['--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl','--disable-features=Vulkan',...(process.env.HEADLESS==='1'?['--enable-gpu','--use-gl=angle','--use-angle=gl']:[])]});
const results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=page=>page.evaluate(()=>neiva.snapshot());
const nativeLockFallbacks=[];
async function locked(page){
  try{
    await page.waitForFunction(()=>{const s=neiva.snapshot();return s.active&&(s.controls.mode==='locked'||(s.controls.mode==='free'&&s.controls.error));},{timeout:15000});
    const before=await state(page);
    if(before.controls.mode==='free'){
      assert.equal(before.controls.error?.name,'NotAllowedError');
      assert.match(before.controls.error?.message,/Too many pointer lock requests/);
      assert.equal(before.controls.locked,false);
      await page.mouse.move(700,450);const yaw=(await state(page)).controls.yaw;
      await page.mouse.move(735,450);assert.ok(Math.abs((await state(page)).controls.yaw-yaw)>.03,'el rechazo nativo conserva mouse sin botón');
      await page.mouse.move(700,450);
      nativeLockFallbacks.push({error:before.controls.error,hoverLook:true,automaticRecapture:false});
      // Chromium rate-limits bursty lock requests over a two-second window.
      // The game stays in fallback; only this subsequent user click retries.
      await sleep(2200);assert.equal((await state(page)).controls.locked,false);
      await page.mouse.click(700,450);
    }
    await page.waitForFunction(()=>neiva.snapshot().active&&neiva.snapshot().controls.mode==='locked'&&document.pointerLockElement===document.getElementById('world'),{timeout:15000});
  }catch(error){console.log('Captura del mouse fallida',JSON.stringify(await page.evaluate(()=>({snapshot:neiva.snapshot(),focus:document.activeElement?.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),status:document.getElementById('look-status').textContent})),null,2));throw error;}
}
function watch(page){
  const errors=[],http=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)http.push({url:response.url(),status:response.status()});});
  return {errors,http};
}
async function load(page){
  const start=Date.now();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  if(process.env.GAME_TEST_TRACE==='1')await page.evaluate(()=>{window.qaInput=[];for(const name of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchend','click'])document.addEventListener(name,e=>{window.qaInput.push({type:name,target:e.target.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY,touches:e.touches?.length});if(window.qaInput.length>60)window.qaInput.shift();},true);});
  await page.waitForFunction(()=>window.neiva?.snapshot().ready,{timeout:120000});
  assert.equal((await state(page)).visualVersion,'0.4-adaptive-city');
  return Date.now()-start;
}
async function waitDialog(page,id){
  await page.waitForSelector(`#${id}[open]`);
  await page.waitForFunction(()=>!document.pointerLockElement&&!neiva.snapshot().active);
}
async function destination(page,needle,touch=false,action='travel'){
  const index=await page.$$eval(`#destinations .destination-${action}`,(buttons,term)=>buttons.findIndex(button=>button.getAttribute('aria-label').includes(term)),needle);
  assert.ok(index>=0,`falta destino ${needle}`);
  const selector=`#destinations .destination-row:nth-child(${index+1}) .destination-${action}`;
  // Let the native unlock event settle while the user reads a destination.
  if(!touch)await sleep(700);
  await page[touch?'tap':'click'](selector);
  await page.waitForFunction(()=>neiva.snapshot().active&&!document.querySelector('dialog[open]'));
  if(!touch)await locked(page);
}
async function observe(page,id,name,touch=false){
  await page.waitForFunction(term=>neiva.snapshot().near==='place'&&document.getElementById('interact-text').textContent.includes(term),{timeout:15000},name);
  assert.equal((await state(page)).progress.includes(id),false,'acercarse o viajar no registra una observación');
  if(touch)await page.tap('#touch-interact');else await page.keyboard.press('KeyE');
  await waitDialog(page,'observation-dialog');
  assert.ok((await page.$eval('#observation-title',e=>e.textContent)).includes(name));
  assert.ok((await state(page)).progress.includes(id),'E registra la observación');
  assert.ok(await page.$$eval('#observation-sources > *',sources=>sources.length>0),'la ficha identifica su fuente');
  await page[touch?'tap':'click']('#observation-dialog .close');
  await page.waitForFunction(()=>neiva.snapshot().active);
  if(!touch)await locked(page);
}
async function aimAt(page,point,pitch=0){
  await page.mouse.move(720,480);
  const s=await state(page),desired=Math.atan2(s.player.x-point.x,s.player.z-point.z),delta=Math.atan2(Math.sin(s.controls.yaw-desired),Math.cos(s.controls.yaw-desired));
  await page.mouse.move(720+delta/(.0026*s.controls.sensitivity),480+(pitch-s.controls.pitch)/(.0022*s.controls.sensitivity),{steps:6});
  await sleep(350);
}
async function walkToCar(page){
  await page.keyboard.down('KeyW');
  try{await page.waitForFunction(()=>neiva.snapshot().near==='car',{timeout:60000});}
  catch(error){console.log('No se llegó al carro',await state(page));await page.screenshot({path:resolve(artifactDir,'failure-walk.png')});throw error;}
  finally{await page.keyboard.up('KeyW');}
}
try{
  if(process.env.GAME_TEST_DEVICE!=='mobile'){
  const page=await browser.newPage(),audit=watch(page);
  await page.setViewport({width:1440,height:960});
  const readyMs=await load(page);console.log('Ciudad lista',readyMs,'ms');
  await page.screenshot({path:resolve(artifactDir,'desktop-intro.png')});
  await page.click('#play');await locked(page);
  const initial=await state(page);
  assert.deepEqual(initial.progress,[],'la versión nueva no concede visitas al entrar');
  await sleep(500);const warmMap=(await state(page)).performance.map;
  await sleep(700);const cachedMap=(await state(page)).performance.map;
  assert.equal(cachedMap.tileBuilds,warmMap.tileBuilds);assert.equal(cachedMap.featuresPainted,warmMap.featuresPainted);
  assert.ok(cachedMap.tileHits>warmMap.tileHits);assert.ok(cachedMap.tileBytes<=4*1024*1024);
  await page.mouse.move(750,470);await page.mouse.move(830,490,{steps:3});
  await page.waitForFunction(yaw=>Math.abs(neiva.snapshot().controls.yaw-yaw)>.03,{},initial.controls.yaw);
  assert.equal((await state(page)).controls.locked,true);
  console.log('Pointer Lock y mouse sin botón comprobados');
  await page.keyboard.press('KeyH');await locked(page);
  await page.waitForFunction(()=>neiva.snapshot().near==='studio',{timeout:15000});
  await page.keyboard.press('KeyE');await waitDialog(page,'studio-dialog');
  assert.match(await page.$eval('#studio-dialog .primary',a=>a.href),/^mailto:alvarezruizj289@gmail.com/);
  await page.click('#studio-dialog .close');await locked(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(()=>neiva.snapshot().controls.movementSpeed>1.8,{timeout:30000});
  const walking=await state(page);assert.ok(walking.controls.movementSpeed<=2.05);
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(()=>neiva.snapshot().controls.movementSpeed>5.1,{timeout:30000});
  const running=await state(page);
  assert.ok(running.controls.movementSpeed>walking.controls.movementSpeed*2.5);
  assert.ok(running.controls.movementSpeed<=5.45);
  await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW');
  await page.waitForFunction(()=>neiva.snapshot().controls.movementSpeed<.05);
  await walkToCar(page);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>neiva.snapshot().driving);
  const beforeDrive=await state(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(([x,z])=>neiva.snapshot().carSpeed>3&&Math.hypot(neiva.snapshot().player.x-x,neiva.snapshot().player.z-z)>2,{timeout:60000},[beforeDrive.player.x,beforeDrive.player.z]);
  const accelerating=await state(page);
  await page.keyboard.up('KeyW');await page.keyboard.down('Space');
  await page.waitForFunction(()=>Math.abs(neiva.snapshot().carSpeed)<.4,{timeout:30000});
  const braked=await state(page);await page.keyboard.up('Space');
  assert.ok(Math.abs(braked.carSpeed)<Math.abs(accelerating.carSpeed)*.2);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>!neiva.snapshot().driving);
  const afterDrive=await state(page);
  assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),afterDrive.player),false);
  console.log('Caminar, correr, acelerar, frenar y bajar comprobados');
  await page.keyboard.down('KeyW');await page.waitForFunction(()=>neiva.snapshot().controls.movementSpeed>1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!neiva.snapshot().active&&!document.pointerLockElement);
  const paused=await state(page);await sleep(700);
  assert.deepEqual((await state(page)).player,paused.player,'pausar detiene la simulación aunque W estuviera pulsada');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');assert.equal((await state(page)).active,false);
  // Allow the browser's native Escape release to settle before the new gesture.
  await sleep(1300);await page.click('#play');await locked(page);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');
  const destinationNames=await page.$$eval('#destinations .destination-guide',buttons=>buttons.map(button=>button.textContent));
  for(const name of ['Palacio de Justicia','Catedral','Hotel Neiva Plaza','Templo Colonial'])assert.ok(destinationNames.some(label=>label.includes(name)),`destino urbano visible: ${name}`);
  await page.screenshot({path:resolve(artifactDir,'desktop-map.png')});
  const beforeGuide=await state(page);await destination(page,'Palacio de Justicia',false,'guide');
  assert.deepEqual((await state(page)).player,beforeGuide.player,'elegir una guía no teletransporta');
  assert.equal((await state(page)).route,'way/312876443');
  assert.match(await page.$eval('#route-guide',e=>e.getAttribute('aria-label')),/Distancia en línea recta/);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');
  assert.equal((await state(page)).performance.map.atlasBuilds,beforeGuide.performance.map.atlasBuilds,'reabrir el atlas conserva su geometría');
  await page.click('#map-dialog .close');await locked(page);
  await page.keyboard.press('KeyC');await waitDialog(page,'controls-dialog');
  await page.focus('#sensitivity');await page.keyboard.press('End');
  assert.equal((await state(page)).controls.sensitivity,2);
  await page.keyboard.press('Home');assert.equal((await state(page)).controls.sensitivity,.5);
  for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
  assert.equal((await state(page)).controls.sensitivity,1);
  await page.click('#controls-dialog .close');await locked(page);
  await page.keyboard.press('KeyL');await page.waitForFunction(()=>neiva.snapshot().weather==='clear');
  await page.keyboard.press('KeyL');await page.waitForFunction(()=>neiva.snapshot().weather==='after-rain');
  await page.keyboard.press('KeyQ');assert.equal(await page.$eval('#quality-label',e=>e.textContent),'Ligera');
  await page.keyboard.press('KeyT');assert.equal(await page.$eval('#time-label',e=>e.textContent),'Atardecer');
  await page.keyboard.press('KeyF');await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  if((await state(page)).active)await page.keyboard.press('KeyF');else await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.fullscreenElement);
  // Exiting fullscreen may asynchronously release Pointer Lock. Respect the
  // browser's native unlock cooldown before another explicit user gesture.
  await sleep(1500);
  if(!(await state(page)).active){await page.click('#play');await locked(page);}
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');await destination(page,'Palacio de Justicia');
  await observe(page,'way/312876443','Palacio de Justicia');
  const courtAccess=await state(page);assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),courtAccess.player),false);
  await page.screenshot({path:resolve(artifactDir,'desktop-courthouse.png')});
  await aimAt(page,{x:-963.6,z:-6.1});await page.keyboard.press('KeyI');await waitDialog(page,'building-dialog');
  assert.equal(await page.$eval('#building-id',e=>e.textContent),'way/312876443');
  assert.equal(await page.$$eval('#building-measures > div',rows=>rows.length),4);
  const streetView=new URL(await page.$eval('#building-streetview',e=>e.href));
  assert.equal(streetView.origin,'https://www.google.com');assert.equal(streetView.searchParams.get('api'),'1');assert.equal(streetView.searchParams.get('map_action'),'pano');
  assert.ok(streetView.searchParams.get('viewpoint').split(',').every(value=>Number.isFinite(Number(value))));
  await page.screenshot({path:resolve(artifactDir,'desktop-inspector.png')});
  await page.click('#building-dialog .close');await locked(page);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');await destination(page,'Templo Colonial');
  await observe(page,'way/313286683','Templo Colonial');
  const colonialAccess=await state(page);assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),colonialAccess.player),false);
  await page.screenshot({path:resolve(artifactDir,'desktop-colonial.png')});
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');await destination(page,'Santander');
  await observe(page,'way/39365299','Santander');
  const downloads=resolve(artifactDir,`browser-downloads-${Date.now()}`);await mkdir(downloads);
  const desktopCdp=await page.createCDPSession();await desktopCdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await page.keyboard.press('KeyP');
  for(let i=0;i<100&&!existsSync(resolve(downloads,'neiva-abierta.png'));i++)await sleep(100);
  assert.ok(existsSync(resolve(downloads,'neiva-abierta.png')),'P guarda una captura del juego');
  await page.screenshot({path:resolve(artifactDir,'desktop-play.png')});
  const graphics=await page.evaluate(()=>{const gl=document.querySelector('#world').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  assert.deepEqual(audit.errors,[]);assert.deepEqual(audit.http,[]);
  results.push({device:'desktop',width:1440,readyMs,graphics,pointerLock:true,nativeLockFallbacks,mouseWithoutButton:true,walkingSpeed:walking.controls.movementSpeed,runningSpeed:running.controls.movementSpeed,acceleratingSpeed:accelerating.carSpeed,brakedSpeed:braked.carSpeed,vehicleInteraction:true,studioContact:true,pause:true,pausedMotion:false,mapTravel:true,routeWithoutTeleport:true,explicitObservations:true,courthouseDestination:true,colonialDestination:true,buildingInspector:true,streetViewUrl:streetView.href,mapCache:true,sensitivity:true,weatherToggle:true,fullscreen:true,photo:true,...audit,snapshot:await state(page)});
  await writeFile(resolve(artifactDir,'browser-results.json'),JSON.stringify(results,null,2));
  await page.close();
  }
  for(const width of process.env.GAME_TEST_DEVICE==='desktop'?[]:[320,390]){
    const mobileContext=await browser.createBrowserContext(),p=await mobileContext.newPage(),mobileAudit=watch(p);
    await p.setViewport({width,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const mobileReadyMs=await load(p);await p.screenshot({path:resolve(artifactDir,`mobile-${width}-intro.png`)});
    await p.tap('#play');await p.waitForFunction(()=>neiva.snapshot().active&&neiva.snapshot().near==='studio');
    assert.equal((await state(p)).controls.locked,false);
    assert.deepEqual((await state(p)).progress,[]);
    await p.tap('#touch-interact');await waitDialog(p,'studio-dialog');
    assert.match(await p.$eval('#studio-dialog .primary',a=>a.href),/^mailto:alvarezruizj289@gmail.com/);
    await p.tap('#studio-dialog .close');await p.waitForFunction(()=>neiva.snapshot().active);
    await p.tap('#run-button');assert.equal(await p.$eval('#run-button',e=>e.getAttribute('aria-pressed')),'true');
    const before=await state(p),bounds=await p.$eval('#joystick',el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    // Keep every touch in Puppeteer's own session and identifier sequence.
    const joystickTouch=await p.touchscreen.touchStart(bounds.x,bounds.y-38);
    await p.waitForFunction(([x,z])=>neiva.snapshot().controls.movementSpeed>5.1&&Math.hypot(neiva.snapshot().player.x-x,neiva.snapshot().player.z-z)>.4,{timeout:45000},[before.player.x,before.player.z]);
    const mobileRun=await state(p);await joystickTouch.end();
    await p.waitForFunction(()=>neiva.snapshot().controls.movementSpeed<.05);
    await p.tap('#run-button');assert.equal(await p.$eval('#run-button',e=>e.getAttribute('aria-pressed')),'false');
    const beforeLook=(await state(p)).controls.yaw,cameraX=Math.round(width*.52);
    const cameraTouch=await p.touchscreen.touchStart(cameraX,405);
    // Model a continuous human swipe. An instantaneous 48px jump makes the
    // next Chrome emulated touch emit down/up without a native click.
    for(let step=1;step<=6;step++){await cameraTouch.move(cameraX+step*8,405);await sleep(35);}
    await cameraTouch.end();
    assert.ok(Math.abs((await state(p)).controls.yaw-beforeLook)>.1,'deslizar la ciudad mueve la cámara');
    await p.screenshot({path:resolve(artifactDir,`mobile-${width}-play.png`)});
    const layout=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:['joystick','run-button','touch-interact','map-button','controls-button','menu-button'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,width:r.width,height:r.height,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight};})}));
    assert.equal(layout.document,layout.viewport);for(const b of layout.buttons)assert.ok(b.width>=44&&b.height>=44&&b.inside,JSON.stringify(b));
    await p.tap('#map-button');await waitDialog(p,'map-dialog');
    const beforeMobileGuide=await state(p);await destination(p,'Santander',true,'guide');
    assert.deepEqual((await state(p)).player,beforeMobileGuide.player);
    await p.tap('#map-button');await waitDialog(p,'map-dialog');await destination(p,'Santander',true);
    await observe(p,'way/39365299','Santander',true);
    await p.tap('#map-button');await waitDialog(p,'map-dialog');await destination(p,'estudio',true);
    await p.waitForFunction(()=>neiva.snapshot().near==='studio',{timeout:15000});
    await p.tap('#touch-interact');await waitDialog(p,'studio-dialog');await p.tap('#studio-dialog .close');await p.waitForFunction(()=>neiva.snapshot().active);
    assert.deepEqual(mobileAudit.errors,[]);assert.deepEqual(mobileAudit.http,[]);
    results.push({device:'mobile',width,readyMs:mobileReadyMs,joystick:true,runningSpeed:mobileRun.controls.movementSpeed,sprintToggle:true,touchLook:true,studioContact:true,mapTravel:true,routeWithoutTeleport:true,explicitObservation:true,layout,...mobileAudit,snapshot:await state(p)});
    await writeFile(resolve(artifactDir,'browser-results.json'),JSON.stringify(results,null,2));
    await mobileContext.close();console.log('Móvil comprobado',width);
  }
  await writeFile(resolve(artifactDir,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}catch(error){
  const diagnostics=[];
  for(const [index,page] of (await browser.pages()).entries()){
    if(page.isClosed()||page.url()==='about:blank')continue;
    try{
      diagnostics.push(await page.evaluate(()=>({url:location.href,snapshot:window.neiva?.snapshot(),inputs:window.qaInput,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),focus:document.activeElement?.id,mapButton:(()=>{const r=document.getElementById('map-button').getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};})()})));
      await page.screenshot({path:resolve(artifactDir,`failure-${index}.png`)});
    }catch(diagnosticError){diagnostics.push({error:diagnosticError.message});}
  }
  await writeFile(resolve(artifactDir,'failure.json'),JSON.stringify({error:error.stack,diagnostics,results},null,2));
  throw error;
}finally{await browser.close();}
