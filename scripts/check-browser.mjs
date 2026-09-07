import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.GAME_TEST_URL||'http://127.0.0.1:4173';
await mkdir('artifacts',{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:process.env.HEADLESS==='1',args:['--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl','--disable-features=Vulkan',...(process.env.HEADLESS==='1'?['--enable-unsafe-swiftshader']:[])]});
const results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewport({width:1440,height:960});const start=Date.now();await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.neiva?.snapshot().ready,{timeout:120000});
  const readyMs=Date.now()-start;console.log('World ready',readyMs);
  await page.screenshot({path:'artifacts/desktop-intro.png'});
  await page.click('#play');await sleep(400);assert.equal((await page.evaluate(()=>neiva.snapshot())).active,true);
  await page.waitForFunction(()=>neiva.snapshot().near==='studio',{timeout:15000});await page.keyboard.press('KeyE');await page.waitForSelector('#studio-dialog[open]');
  assert.match(await page.$eval('#studio-dialog .primary',a=>a.href),/^mailto:alvarezruizj289@gmail.com/);
  await page.click('#studio-dialog .close');await page.waitForFunction(()=>neiva.snapshot().active);await page.focus('#world');console.log('Studio verified; walking to car');await page.keyboard.down('KeyW');
  await page.waitForFunction(()=>neiva.snapshot().near==='car',{timeout:60000}).catch(async e=>{console.log('Failed walk state',await page.evaluate(()=>neiva.snapshot()));await page.screenshot({path:'artifacts/failure-walk.png'});throw e;});await page.keyboard.up('KeyW');
  console.log('Reached car');const walking=await page.evaluate(()=>neiva.snapshot());assert.ok(Math.hypot(walking.player.x-walking.spawn.x,walking.player.z-walking.spawn.z)>1);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>neiva.snapshot().driving);console.log('Driving verified');const beforeDrive=await page.evaluate(()=>neiva.snapshot());
  await page.keyboard.down('KeyW');await page.waitForFunction(([x,z])=>Math.hypot(neiva.snapshot().player.x-x,neiva.snapshot().player.z-z)>2,{timeout:60000},[beforeDrive.player.x,beforeDrive.player.z]);await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>!neiva.snapshot().driving);const afterDrive=await page.evaluate(()=>neiva.snapshot());
  assert.equal(await page.evaluate(p=>neiva.isBlocked(p.x,p.z,.4),afterDrive.player),false);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>neiva.snapshot().active),false);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>neiva.snapshot().active),true);
  await page.click('#map-button');await page.waitForSelector('#map-dialog[open]');await page.screenshot({path:'artifacts/desktop-map.png'});
  await page.click('#destinations button:nth-child(2)');await page.waitForFunction(()=>neiva.snapshot().active);await pWaitVisit();await sleep(300);await page.screenshot({path:'artifacts/desktop-play.png'});
  async function pWaitVisit(){await page.waitForFunction(()=>neiva.snapshot().progress.length>=2,{timeout:10000});}
  const graphics=await page.evaluate(()=>{const gl=document.querySelector('#world').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  assert.deepEqual(errors,[]);results.push({device:'desktop',width:1440,readyMs,graphics,walking:true,vehicleInteraction:true,studioContact:true,pause:true,mapTravel:true,errors,...await page.evaluate(()=>neiva.snapshot())});
  await page.close();
  for(const width of [320,390]){
    const p=await browser.newPage(),err=[];p.on('pageerror',e=>err.push(e.message));await p.setViewport({width,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});await p.goto(origin);await p.waitForFunction(()=>window.neiva?.snapshot().ready,{timeout:120000});
    await p.screenshot({path:`artifacts/mobile-${width}-intro.png`});await p.tap('#play');await sleep(500);const before=await p.evaluate(()=>neiva.snapshot());
    const bounds=await p.$eval('#joystick',el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    const cdp=await p.createCDPSession();const touch={x:bounds.x,y:bounds.y-37,id:1,radiusX:6,radiusY:6,force:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await p.waitForFunction(([x,z])=>Math.hypot(neiva.snapshot().player.x-x,neiva.snapshot().player.z-z)>.4,{timeout:45000},[before.player.x,before.player.z]);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);
    await p.screenshot({path:`artifacts/mobile-${width}-play.png`});const layout=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:['joystick','touch-interact','map-button','menu-button'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,width:r.width,height:r.height,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight};})}));assert.equal(layout.document,layout.viewport);for(const b of layout.buttons){assert.ok(b.width>=44&&b.height>=44&&b.inside,JSON.stringify(b));}assert.deepEqual(err,[]);
    results.push({device:'mobile',width,joystick:true,layout,errors:err});await p.close();
  }
  await writeFile('artifacts/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
