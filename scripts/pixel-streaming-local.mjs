#!/usr/bin/env node
// Native Unreal renders the stream. This script only runs Epic's signalling/player.
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream='https://github.com/EpicGamesExt/PixelStreamingInfrastructure.git';
const revision='c3e3abea6590a19e1c0ab4d2954efd6a1d949db3';
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  package:{type:'string'},host:{type:'string',default:'127.0.0.1'},
  port:{type:'string',default:'8080'},'streamer-port':{type:'string',default:'8888'},
  width:{type:'string',default:'1280'},height:{type:'string',default:'720'},
  gpu:{type:'string',default:'auto'},
  'dry-run':{type:'boolean',default:false}
}});
const action=positionals[0];
const infrastructure=resolve(repo,'artifacts/unreal-native/PixelStreamingInfrastructure');
const npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,cwd=repo){execFileSync(command,args,{cwd,stdio:'inherit'});}
function verifyRevision(){
  if(!existsSync(resolve(infrastructure,'.git')))throw Error('Falta infraestructura. Ejecuta primero prepare.');
  const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:infrastructure,encoding:'utf8'}).trim();
  if(actual!==revision)throw Error(`Revisión de infraestructura distinta: ${actual}. No se modifica el checkout.`);
}
function number(value,min,max,label){
  if(!/^\d+$/.test(value)||Number(value)<min||Number(value)>max)throw Error(`${label} fuera de rango`);
  return Number(value);
}
if(action==='prepare'&&values['dry-run']){
  console.log(JSON.stringify({revision,infrastructure,actions:['clone/fetch Epic upstream if missing','npm ci --ignore-scripts','npm run build:all:cjs'],executed:false},null,2));
}else if(action==='prepare'){
  if(!existsSync(infrastructure)){
    mkdirSync(dirname(infrastructure),{recursive:true});
    run('git',['clone','--depth','1','--branch','UE5.5',upstream,infrastructure]);
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:infrastructure,encoding:'utf8'}).trim();
    if(head!==revision){
      run('git',['fetch','--depth','1','origin',revision],infrastructure);
      run('git',['checkout','--detach',revision],infrastructure);
    }
  }
  verifyRevision();
  run(npm,['ci','--ignore-scripts','--no-audit','--no-fund'],infrastructure);
  run(npm,['run','build:all:cjs'],infrastructure);
  console.log('Infraestructura compilada. Esto no compila ni ejecuta el juego Unreal.');
}else if(action==='start'){
  verifyRevision();
  const port=number(values.port,1024,65535,'Puerto del jugador');
  const streamerPort=number(values['streamer-port'],1024,65535,'Puerto del juego');
  const width=number(values.width,320,3840,'Ancho'),height=number(values.height,240,2160,'Alto');
  if(port===streamerPort)throw Error('Los puertos deben ser distintos.');
  if(!['127.0.0.1','0.0.0.0'].includes(values.host))throw Error('Host permitido: 127.0.0.1 o 0.0.0.0 para LAN.');
  if(!['auto','nvidia'].includes(values.gpu))throw Error('GPU permitida: auto o nvidia.');
  const webRoot=resolve(infrastructure,'SignallingWebServer/www');
  const library=resolve(infrastructure,'Signalling/dist/cjs/pixelstreamingsignalling.js');
  if(!existsSync(library)||!existsSync(resolve(webRoot,'player.html')))throw Error('Ejecuta prepare para compilar el reproductor oficial.');
  let executable=null;
  if(values.package){
    const folder=resolve(values.package);
    const report=JSON.parse(readFileSync(resolve(folder,'neiva-build-report.json'),'utf8'));
    if(!report||typeof report!=='object'||Array.isArray(report)||report.packaged!==true)throw Error('El informe no acredita un paquete construido.');
    const target=process.platform==='win32'?'Win64':'Linux';
    if(report.target!==target)throw Error(`El paquete ${report.target} no es nativo de este equipo (${target}).`);
    run(process.platform==='win32'?'python':'python3',[resolve(repo,'scripts/unreal.py'),'verify-package','--output',folder]);
    executable=target==='Linux'?resolve(folder,'Linux/NeivaAbierta.sh'):resolve(folder,'Windows/NeivaAbierta.exe');
    if(!existsSync(executable))throw Error(`No existe el lanzador del paquete: ${executable}`);
  }
  const gameArgs=[`-PixelStreamingURL=ws://127.0.0.1:${streamerPort}`,'-RenderOffScreen','-AudioMixer',
    '-ForceRes',`-ResX=${width}`,`-ResY=${height}`,'-PixelStreamingEncoderCodec=H264',
    '-PixelStreamingWebRTCMaxFps=30','-unattended','-stdout'];
  if(values['dry-run']){
    console.log(JSON.stringify({revision,host:values.host,port,streamerPort,executable,gameArgs,gameRunning:false},null,2));
  }else{
    const require=createRequire(resolve(infrastructure,'package.json'));
    const express=require('express');
    const {SignallingServer}=require(library);
    const app=express();
    app.get('/',(_request,response)=>response.sendFile(resolve(webRoot,'player.html')));
    app.use(express.static(webRoot,{dotfiles:'deny'}));
    const server=createServer(app);
    server.on('error',error=>{console.error(error.message);process.exit(1);});
    server.listen(port,values.host,()=>{
      new SignallingServer({httpServer:server,streamerPort,
        streamerWsOptions:{host:'127.0.0.1'},maxSubscribers:1,peerOptions:{iceServers:[]}});
      console.log(`Reproductor: http://${values.host==='0.0.0.0'?'IP-DEL-PC':values.host}:${port}`);
      let child=null;
      if(executable){
        const env={...process.env};
        let hasNvidia=false;
        try{hasNvidia=Boolean(execFileSync('nvidia-smi',['--query-gpu=name','--format=csv,noheader'],
          {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']}).trim());}catch{}
        if(values.gpu==='nvidia'&&!hasNvidia){console.error('NVIDIA no está disponible.');process.exit(1);}
        if(process.platform==='linux'&&hasNvidia)Object.assign(env,{
          __NV_PRIME_RENDER_OFFLOAD:'1',__GLX_VENDOR_LIBRARY_NAME:'nvidia',__VK_LAYER_NV_optimus:'NVIDIA_only'});
        child=spawn(executable,gameArgs,{cwd:dirname(executable),env,stdio:'inherit',detached:process.platform!=='win32'});
        // The Linux .sh launcher may spawn another process. Stop the whole group we own.
        process.once('exit',()=>{
          if(!child?.pid)return;
          try{
            if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
            else process.kill(-child.pid,'SIGTERM');
          }catch{}
        });
        child.once('error',error=>{console.error(error.message);process.exit(1);});
        child.once('exit',code=>{console.log(`Unreal terminó (${code}).`);process.exit(code??1);});
      }else console.log('Sin paquete Unreal: señalización lista, NO hay partida ni imagen del juego.');
      const stop=()=>{if(child&&!child.killed)child.kill('SIGTERM');server.close();process.exit(0);};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    });
  }
}else{
  console.log('node scripts/pixel-streaming-local.mjs prepare');
  console.log('node scripts/pixel-streaming-local.mjs start --package artifacts/unreal-native/packages/FECHA');
  console.log('Opcional: --host 0.0.0.0 para LAN; una partida, un jugador. No publica en Internet.');
  process.exitCode=action?1:0;
}
