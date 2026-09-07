/** Measures real requestAnimationFrame intervals, full-frame CPU and update CPU. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import puppeteer from 'puppeteer-core';
const [label='before',url='http://localhost:4174']=process.argv.slice(2);const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-gpu','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
try {
const p=(await b.pages())[0];await p.setViewport({width:1440,height:960});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.neiva?.snapshot().ready,{timeout:120000});const results={label,createdAt:new Date().toISOString(),viewport:[1440,960],durationSeconds:10,warmupSeconds:6.5,sourceHashes:await (await fetch(url+'/source-hashes.json')).json(),gpu:await p.evaluate(()=>{const gl=__world.renderer.getContext();return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)}),cases:[]};
const quantile=(xs,q)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*q))];
for(const [weather,mode] of [['after-rain','idle'],['after-rain','walk'],['after-rain','drive'],['clear','idle']]){
 await p.evaluate(async({weather,mode})=>{__perf.enabled=false;await __world.setWeather(weather);__bench.setup(mode);},{weather,mode});
 await new Promise(r=>setTimeout(r,6500));
 const start=await p.evaluate(()=>{__perf.frames=[];__perf.enabled=true;return neiva.snapshot();});await new Promise(r=>setTimeout(r,10000));
 const value=await p.evaluate(()=>{__perf.enabled=false;__bench.stop();return{frames:__perf.frames,state:neiva.snapshot(),pixelRatio:__world.renderer.getPixelRatio()}});const frames=value.frames.filter(f=>f.raf>0),raf=frames.map(f=>f.raf),sum=raf.reduce((s,x)=>s+x,0),mean=k=>frames.reduce((s,f)=>s+f[k],0)/frames.length;
 const report={weather,mode,count:frames.length,observedFps:1000*frames.length/sum,rafMedian:quantile(raf,.5),rafP95:quantile(raf,.95),rafOver50ms:raf.filter(x=>x>50).length,meanFrameCPU:mean('cpu'),meanUpdateCPU:mean('updateCPU'),p95UpdateCPU:quantile(frames.map(f=>f.updateCPU),.95),meanCalls:mean('renderCalls'),meanTriangles:mean('triangles'),meanPixelRatio:frames.every(f=>Number.isFinite(f.pixelRatio))?mean('pixelRatio'):value.pixelRatio,startPerformance:start.performance,endPerformance:value.state.performance,travelled:Math.hypot(value.state.player.x-start.player.x,value.state.player.z-start.player.z),start:start.player,end:value.state.player,frames};results.cases.push(report);console.log(JSON.stringify({...report,frames:undefined,startPerformance:undefined,endPerformance:undefined}));
}
results.errors=errors;fs.mkdirSync(root+'/artifacts',{recursive:true});fs.writeFileSync(root+'/artifacts/performance-'+label+'.json',JSON.stringify(results,null,2));console.log('DONE',label,errors);
} finally { await b.close(); }
