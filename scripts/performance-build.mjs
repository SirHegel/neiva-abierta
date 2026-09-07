/** Temporary instrumented bundle. Never deploy this testing-only entry point. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]||'/tmp/neiva-performance');if(fs.existsSync(out)&&fs.readdirSync(out).length)throw new Error('Use a new empty output directory to freeze the complete benchmark.');
fs.mkdirSync(out,{recursive:true});
fs.cpSync(root+'/public',out,{recursive:true});
fs.writeFileSync(out+'/index.html',fs.readFileSync(root+'/index.html','utf8').replace('/src/style.css','/style.css').replace('/src/main.js','/app.js'));fs.copyFileSync(root+'/src/style.css',out+'/style.css');
let source=fs.readFileSync(root+'/src/main.js','utf8');source=source.replace('world=await createWorld','world=window.__world=await createWorld');
source=source.replace(/function update\((dt|elapsed)\)\{/,(_,arg)=>'function update('+arg+'){const _start=performance.now();try{return updateMeasuredCore('+arg+')}finally{window.__perf.updateCPU+=performance.now()-_start}}\nfunction updateMeasuredCore('+arg+'){');
source=source.replace('function frame(time){','function frameMeasuredCore(time){');
source=source.replace('boot();', `
window.__perf={enabled:false,frames:[],updateCPU:0,lastRaf:null};
window.__bench={setup(mode){
  keys.clear();stick={x:0,y:0};active=started=true;driving=mode==='drive';speed=0;pitch=.12;sprinting=false;
  player={...world.spawn};car={x:world.spawn.x+9.3,z:world.spawn.z-3.7,angle:world.road.angle};
  if(driving)player={x:car.x,z:car.z};
  world.avatar.visible=!driving;world.avatar.position.set(player.x,0,player.z);
  world.playerCar.position.set(car.x,0,car.z);world.playerCar.rotation.y=car.angle;
  yaw=driving?car.angle+Math.PI:world.road.angle;
  if(typeof resetInput==='function')resetInput();
  cameraUpdate(1,true);
  document.body.classList.add('playing');$('intro').hidden=true;$('hud').hidden=false;
  if(mode==='walk'||mode==='drive')keys.add('KeyW');
},setInput(mode){keys.clear();if(mode)keys.add(mode)},stop(){keys.clear();}};
function frame(time){const p=window.__perf,start=performance.now(),before=p.updateCPU;frameMeasuredCore(time);if(p.enabled)p.frames.push({raf:p.lastRaf===null?0:time-p.lastRaf,cpu:performance.now()-start,updateCPU:p.updateCPU-before,renderCalls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles,pixelRatio:world.renderer.getPixelRatio(),x:player.x,z:player.z});p.lastRaf=time;}
boot();`);
await build({stdin:{contents:source,loader:'js',resolveDir:root+'/src'},bundle:true,format:'esm',outfile:out+'/app.js',logLevel:'warning'});
const hashes=Object.fromEntries(fs.readdirSync(root+'/src').filter(x=>x.endsWith('.js')).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(root+'/src/'+name)).digest('hex')]));fs.writeFileSync(out+'/source-hashes.json',JSON.stringify(hashes,null,2));console.log(out);
