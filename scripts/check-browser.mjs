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
  await page.waitForFunction(()=>window.neiva?.snapshot().ready,{timeout:120000});
  assert.equal((await state(page)).visualVersion,'0.3-wet-city');
  return Date.now()-start;
}
async function waitDialog(page,id){
  await page.waitForSelector(`#${id}[open]`);
  await page.waitForFunction(()=>!document.pointerLockElement&&!neiva.snapshot().active);
}
async function destination(page,needle,touch=false){
  const index=await page.$$eval('#destinations button',(buttons,term)=>buttons.findIndex(button=>button.textContent.includes(term)),needle);
  assert.ok(index>=0,`falta destino ${needle}`);
  const selector=`#destinations button:nth-child(${index+1})`;
  // Let the native unlock event settle while the user reads a destination.
  if(!touch)await sleep(700);
  await page[touch?'tap':'click'](selector);
  await page.waitForFunction(()=>neiva.snapshot().active&&!document.querySelector('dialog[open]'));
  if(!touch)await locked(page);
}
async function walkToCar(page){
  await page.keyboard.down('KeyW');
  try{await page.waitForFunction(()=>neiva.snapshot().near==='car',{timeout:60000});}
  catch(error){console.log('No se llegó al carro',await state(page));await page.screenshot({path:resolve(artifactDir,'failure-walk.png')});throw error;}
  finally{await page.keyboard.up('KeyW');}
}
try{
  const page=await browser.newPage(),audit=watch(page);
  await page.setViewport({width:1440,height:960});
  const readyMs=await load(page);console.log('Ciudad lista',readyMs,'ms');
  await page.screenshot({path:resolve(artifactDir,'desktop-intro.png')});
  await page.click('#play');await locked(page);
  const initial=await state(page);
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
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!neiva.snapshot().active&&!document.pointerLockElement);
  await page.keyboard.press('Escape');assert.equal((await state(page)).active,false);
  // Allow the browser's native Escape release to settle before the new gesture.
  await sleep(1300);await page.click('#play');await locked(page);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');
  const destinationNames=await page.$$eval('#destinations button',buttons=>buttons.map(button=>button.textContent));
  for(const name of ['Palacio de Justicia','Catedral','Hotel Neiva Plaza','Templo Colonial'])assert.ok(destinationNames.some(label=>label.includes(name)),`destino urbano visible: ${name}`);
  await page.screenshot({path:resolve(artifactDir,'desktop-map.png')});
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
  await page.waitForFunction(()=>neiva.snapshot().progress.includes('way/312876443'),{timeout:15000});
  const courtAccess=await state(page);assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),courtAccess.player),false);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');await destination(page,'Templo Colonial');
  await page.waitForFunction(()=>neiva.snapshot().progress.includes('way/313286683'),{timeout:15000});
  const colonialAccess=await state(page);assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),colonialAccess.player),false);
  await page.keyboard.press('KeyM');await waitDialog(page,'map-dialog');await destination(page,'Santander');
  await page.waitForFunction(()=>neiva.snapshot().progress.length>=2,{timeout:15000});
  const downloads=resolve(artifactDir,`browser-downloads-${Date.now()}`);await mkdir(downloads);
  const desktopCdp=await page.createCDPSession();await desktopCdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await page.keyboard.press('KeyP');
  for(let i=0;i<100&&!existsSync(resolve(downloads,'neiva-abierta.png'));i++)await sleep(100);
  assert.ok(existsSync(resolve(downloads,'neiva-abierta.png')),'P guarda una captura del juego');
  await page.screenshot({path:resolve(artifactDir,'desktop-play.png')});
  const graphics=await page.evaluate(()=>{const gl=document.querySelector('#world').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  assert.deepEqual(audit.errors,[]);assert.deepEqual(audit.http,[]);
  results.push({device:'desktop',width:1440,readyMs,graphics,pointerLock:true,nativeLockFallbacks,mouseWithoutButton:true,walkingSpeed:walking.controls.movementSpeed,runningSpeed:running.controls.movementSpeed,acceleratingSpeed:accelerating.carSpeed,brakedSpeed:braked.carSpeed,vehicleInteraction:true,studioContact:true,pause:true,mapTravel:true,courthouseDestination:true,colonialDestination:true,sensitivity:true,weatherToggle:true,fullscreen:true,photo:true,...audit,snapshot:await state(page)});
  await page.close();
  for(const width of [320,390]){
    const p=await browser.newPage(),mobileAudit=watch(p);
    await p.setViewport({width,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const mobileReadyMs=await load(p);await p.screenshot({path:resolve(artifactDir,`mobile-${width}-intro.png`)});
    await p.tap('#play');await p.waitForFunction(()=>neiva.snapshot().active&&neiva.snapshot().near==='studio');
    assert.equal((await state(p)).controls.locked,false);
    await p.tap('#touch-interact');await waitDialog(p,'studio-dialog');
    assert.match(await p.$eval('#studio-dialog .primary',a=>a.href),/^mailto:alvarezruizj289@gmail.com/);
    await p.tap('#studio-dialog .close');await p.waitForFunction(()=>neiva.snapshot().active);
    await p.tap('#run-button');assert.equal(await p.$eval('#run-button',e=>e.getAttribute('aria-pressed')),'true');
    const before=await state(p),bounds=await p.$eval('#joystick',el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    const cdp=await p.createCDPSession(),touch={x:bounds.x,y:bounds.y-38,id:1,radiusX:6,radiusY:6,force:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
    await p.waitForFunction(([x,z])=>neiva.snapshot().controls.movementSpeed>5.1&&Math.hypot(neiva.snapshot().player.x-x,neiva.snapshot().player.z-z)>.4,{timeout:45000},[before.player.x,before.player.z]);
    const mobileRun=await state(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(()=>neiva.snapshot().controls.movementSpeed<.05);
    await p.tap('#run-button');assert.equal(await p.$eval('#run-button',e=>e.getAttribute('aria-pressed')),'false');
    const beforeLook=(await state(p)).controls.yaw,cameraTouch={x:Math.round(width*.52),y:405,id:2,radiusX:6,radiusY:6,force:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[cameraTouch]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...cameraTouch,x:cameraTouch.x+48}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok(Math.abs((await state(p)).controls.yaw-beforeLook)>.1,'deslizar la ciudad mueve la cámara');
    await p.screenshot({path:resolve(artifactDir,`mobile-${width}-play.png`)});
    const layout=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:['joystick','run-button','touch-interact','map-button','controls-button','menu-button'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,width:r.width,height:r.height,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight};})}));
    assert.equal(layout.document,layout.viewport);for(const b of layout.buttons)assert.ok(b.width>=44&&b.height>=44&&b.inside,JSON.stringify(b));
    await p.tap('#map-button');await waitDialog(p,'map-dialog');await destination(p,'Santander',true);
    await p.tap('#map-button');await waitDialog(p,'map-dialog');await destination(p,'estudio',true);
    await p.waitForFunction(()=>neiva.snapshot().near==='studio',{timeout:15000});
    await p.tap('#touch-interact');await waitDialog(p,'studio-dialog');await p.tap('#studio-dialog .close');await p.waitForFunction(()=>neiva.snapshot().active);
    assert.deepEqual(mobileAudit.errors,[]);assert.deepEqual(mobileAudit.http,[]);
    results.push({device:'mobile',width,readyMs:mobileReadyMs,joystick:true,runningSpeed:mobileRun.controls.movementSpeed,sprintToggle:true,touchLook:true,studioContact:true,mapTravel:true,layout,...mobileAudit});
    await p.close();console.log('Móvil comprobado',width);
  }
  await writeFile(resolve(artifactDir,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
