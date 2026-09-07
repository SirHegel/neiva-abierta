import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {gameLaunchPlan, parseStreamingArgs, stopOwnedProcess, virtualDisplay} from '../scripts/pixel-streaming-local.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const script=resolve(repo,'scripts/pixel-streaming-local.mjs');
const parse=(args,platform='linux')=>parseStreamingArgs(['start',...args],{platform}).values;
const home='/fixture home';
const cache=resolve(home,'.cache/neiva-unreal-display/usr/bin');
const tools=new Set(['xvfb-run','Xvfb','xauth'].map(name=>resolve(cache,name)));
const fixtures={home,isExecutable:path=>tools.has(path)};

test('default remains H264 offscreen with the UE 5.5 WebRTCFps option',()=>{
  const plan=gameLaunchPlan(parse([]),{environment:{DISPLAY:':personal'}});
  assert.ok(plan.gameArgs.includes('-PixelStreamingEncoderCodec=H264'));
  assert.ok(plan.gameArgs.includes('-RenderOffScreen'));
  assert.ok(plan.gameArgs.includes('-PixelStreamingWebRTCFps=30'));
  assert.ok(!plan.gameArgs.some(arg=>/WebRTCMaxFps|CaptureUseFence|DecoupleFramerate/.test(arg)));
  assert.equal(plan.command,null);
  assert.equal(plan.environment.DISPLAY,':personal');
});

test('VP8 virtual plan matches display dimensions and cannot inherit desktop routing',()=>{
  const environment={PATH:'/tools',DISPLAY:':personal',WAYLAND_DISPLAY:'wayland-personal',
    WAYLAND_SOCKET:'8',XAUTHORITY:'/private/auth',DBUS_SESSION_BUS_ADDRESS:'private-session',
    SESSION_MANAGER:'private-manager',SDL_VIDEODRIVER:'wayland',UNCHANGED:'keep'};
  const original={...environment};
  const values=parse(['--codec','VP8','--virtual-display','--capture-fence','--decouple-framerate',
    '--width','1600','--height','900']);
  const plan=gameLaunchPlan(values,{...fixtures,environment});
  assert.equal(plan.command,resolve(cache,'xvfb-run'));
  assert.deepEqual(plan.wrapperArgs,['-a','-s','-screen 0 1600x900x24 -nolisten tcp']);
  for(const arg of ['-windowed','-vulkan','-NoEpicPortal','-ResX=1600','-ResY=900',
    '-PixelStreamingEncoderCodec=VP8','-PixelStreamingCaptureUseFence','-PixelStreamingDecoupleFramerate']){
    assert.ok(plan.gameArgs.includes(arg),arg);
  }
  assert.ok(!plan.gameArgs.includes('-RenderOffScreen'));
  for(const name of ['DISPLAY','WAYLAND_DISPLAY','WAYLAND_SOCKET','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','SESSION_MANAGER']){
    assert.equal(plan.environment[name],undefined,name);
  }
  assert.equal(plan.environment.SDL_VIDEODRIVER,'x11');
  assert.equal(plan.environment.UNCHANGED,'keep');
  assert.deepEqual(environment,original);
});

test('malformed codec, ports, dimensions and incompatible capture flags fail before launch',()=>{
  for(const args of [
    ['--codec','AV1'],['--codec','vp8'],['--codec','H264;anything'],
    ['--port','8080junk'],['--port','1e4'],['--port','1023'],['--port','65536'],
    ['--port','8888'],['--width','0'],['--height','2161'],['--width','1280.5'],
    ['--decouple-framerate'],['--gpu','intel'],['--host','example.com'],['--package','   '],
  ])assert.throws(()=>parse(args),undefined,args.join(' '));
  assert.equal(parse(['--capture-fence'])['capture-fence'],true);
  assert.equal(parse(['--width','3840','--height','2160']).width,3840);
});

test('virtual display is Linux-only and unintended positional actions are rejected',()=>{
  assert.throws(()=>parse(['--virtual-display'],'win32'),/Linux/);
  assert.throws(()=>parseStreamingArgs(['prepare','--virtual-display'],{platform:'linux'}),/doctor o start/);
  assert.throws(()=>parseStreamingArgs(['start','unexpected'],{platform:'linux'}),/una sola acción/);
  assert.throws(()=>parseStreamingArgs(['unknown'],{platform:'linux'}),/Acción/);
  assert.throws(()=>parse([],'darwin'),/Linux o Windows/);
});

test('Xvfb discovery prefers PATH, supports its cache and refuses incomplete toolchains',()=>{
  const fromCache=virtualDisplay({PATH:'/empty'},fixtures);
  assert.equal(fromCache.command,resolve(cache,'xvfb-run'));
  const pathTools=new Set([...tools,...['xvfb-run','Xvfb','xauth'].map(name=>`/path-tools/${name}`)]);
  const fromPath=virtualDisplay({PATH:'/path-tools'}, {home,isExecutable:path=>pathTools.has(path)});
  assert.equal(fromPath.command,'/path-tools/xvfb-run');
  assert.throws(()=>virtualDisplay({PATH:'/empty'},{home,isExecutable:()=>false}),/xvfb-run/);
  assert.throws(()=>virtualDisplay({PATH:'/empty'},{home,isExecutable:path=>path.endsWith('/xvfb-run')}),/Xvfb/);
  assert.throws(()=>virtualDisplay({PATH:'/empty'},{home,isExecutable:path=>!path.endsWith('/xauth')}),/xauth/);
});

test('Windows keeps the native plan and taskkill cleans its descendant tree',()=>{
  const plan=gameLaunchPlan(parse(['--codec','VP8'],'win32'),{environment:{PATH:'fixture'}});
  assert.equal(plan.command,null);
  assert.deepEqual(plan.wrapperArgs,[]);
  let call;
  stopOwnedProcess({pid:1234},{platform:'win32',taskkill:(...args)=>{call=args;},kill:()=>assert.fail('Unix signal on Windows')});
  assert.deepEqual(call,['taskkill',['/PID','1234','/T','/F'],{stdio:'ignore'}]);
});

test('help is available without starting infrastructure',()=>{
  const result=spawnSync(process.execPath,[script,'--help'],{cwd:repo,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/doctor.*package/);
  assert.match(result.stdout,/H264\|VP8/);
  assert.match(result.stdout,/no inicia servidor ni juego/);
});

test('doctor reports the VP8 virtual plan without creating a server or game',context=>{
  if(!existsSync(resolve(repo,'artifacts/unreal-native/PixelStreamingInfrastructure/Signalling/dist/cjs/pixelstreamingsignalling.js'))){
    context.skip('Official infrastructure is not installed in this environment');return;
  }
  try{virtualDisplay();}catch{context.skip('Xvfb toolchain is not installed');return;}
  const result=spawnSync(process.execPath,[script,'doctor','--codec','VP8','--virtual-display',
    '--capture-fence','--decouple-framerate'],{cwd:repo,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(result.stdout);
  assert.equal(plan.codec,'VP8');
  assert.equal(plan.virtualDisplay,true);
  assert.equal(plan.serverRunning,false);
  assert.equal(plan.gameRunning,false);
  assert.equal(plan.runtimeValidated,false);
  assert.equal(plan.gameCommand,null);
  assert.ok(!('environment' in plan));
});

test('doctor validates a complete mimetic inventory without running its launcher',context=>{
  if(process.platform!=='linux'||!existsSync('/bin/true')||
    !existsSync(resolve(repo,'artifacts/unreal-native/PixelStreamingInfrastructure/Signalling/dist/cjs/pixelstreamingsignalling.js'))){
    context.skip('Local Linux infrastructure check');return;
  }
  try{virtualDisplay();}catch{context.skip('Xvfb toolchain is not installed');return;}
  const folder=mkdtempSync(resolve(tmpdir(),'neiva package fixture '));
  try{
    // /bin/true and labelled fake containers test the launcher contract, not Unreal packaging.
    const binary='Linux/NeivaAbierta/Binaries/Linux/NeivaAbierta';
    const data=['pak','utoc','ucas'].map(extension=>`Linux/NeivaAbierta/Content/Paks/fixture.${extension}`);
    mkdirSync(dirname(resolve(folder,binary)),{recursive:true});
    mkdirSync(dirname(resolve(folder,data[0])),{recursive:true});
    copyFileSync('/bin/true',resolve(folder,binary));
    chmodSync(resolve(folder,binary),0o755);
    for(const path of data)writeFileSync(resolve(folder,path),'MIMETIC TEST DATA, NOT UNREAL');
    writeFileSync(resolve(folder,'Linux/NeivaAbierta.sh'),'#!/bin/sh\nexit 77\n',{mode:0o755});
    writeFileSync(resolve(folder,'neiva-build-report.json'),JSON.stringify({target:'Linux',
      compiled:true,imported:true,packaged:true,files:[binary,...data],fixture:true}));
    const args=[script,'doctor','--package',folder,'--codec','VP8','--virtual-display'];
    const result=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    const plan=JSON.parse(result.stdout);
    assert.equal(plan.gameRunning,false);
    assert.equal(plan.runtimeValidated,false);
    assert.equal(plan.gameCommandArgs[3],resolve(folder,'Linux/NeivaAbierta.sh'));
    assert.ok(plan.gameArgs.includes('-PixelStreamingEncoderCodec=VP8'));
    writeFileSync(resolve(folder,data[0]),'');
    const broken=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',timeout:15000});
    assert.notEqual(broken.status,0,'Missing package bytes must prevent even a positive doctor plan');
  }finally{rmSync(folder,{recursive:true,force:true});}
});

function processInfo(pid){
  try{
    const value=readFileSync(`/proc/${pid}/stat`,'utf8');
    const end=value.lastIndexOf(')');
    const fields=value.slice(end+2).split(' ');
    return {name:value.slice(value.indexOf('(')+1,end),state:fields[0],group:Number(fields[2])};
  }catch{return null;}
}
function running(pid){const info=processInfo(pid);return info&&info.state!=='Z';}

test('owned Xvfb, wrapper and harmless descendants terminate together', {timeout:15000},async context=>{
  if(process.platform!=='linux'){context.skip('Linux process-group check');return;}
  let launch;
  try{launch=gameLaunchPlan(parse(['--virtual-display','--width','320','--height','240']),{
    environment:{...process.env,DISPLAY:':65432',DBUS_SESSION_BUS_ADDRESS:'test-desktop-sentinel'}});}
  catch{context.skip('Xvfb toolchain is not installed');return;}
  // No engine, GPU client or signalling port: only a Node fixture and an idle descendant.
  const fixture=`const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log(JSON.stringify({pid:process.pid,descendant:child.pid,display:process.env.DISPLAY,
      desktopSession:process.env.DBUS_SESSION_BUS_ADDRESS||null}));setInterval(()=>{},1000);`;
  const child=spawn(launch.command,[...launch.wrapperArgs,process.execPath,'-e',fixture],{
    env:launch.environment,detached:true,stdio:['ignore','pipe','pipe']});
  let timer,report;
  try{
    report=await new Promise((accept,reject)=>{
      let output='',errors='';
      timer=setTimeout(()=>reject(Error(`Fixture readiness timeout: ${errors}`)),5000);
      child.stderr.on('data',chunk=>{errors+=chunk;});
      child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))accept(JSON.parse(output.split('\n')[0]));});
      child.once('error',reject);
      child.once('exit',code=>reject(Error(`Fixture exited before readiness: ${code}; ${errors}`)));
    });
    clearTimeout(timer);
    assert.match(report.display,/^:\d+$/);
    assert.notEqual(report.display,':65432');
    assert.equal(report.desktopSession,null);
    const owned=readdirSync('/proc').filter(name=>/^\d+$/.test(name)).map(Number)
      .map(pid=>({pid,...processInfo(pid)})).filter(info=>info.group===child.pid);
    assert.ok(owned.some(info=>info.name==='Xvfb'),'A separate Xvfb belongs to the owned process group');
    stopOwnedProcess(child);
    const pids=[...new Set([child.pid,report.pid,report.descendant,...owned.map(info=>info.pid)])];
    const deadline=Date.now()+4000;
    while(pids.some(running)&&Date.now()<deadline)await delay(30);
    assert.deepEqual(pids.filter(running),[],'No owned Xvfb or descendant is left running');
  }finally{
    clearTimeout(timer);
    stopOwnedProcess(child);
  }
});
