#!/usr/bin/env node
// Native Unreal renders the stream. This script only runs Epic's signalling/player.
import {execFileSync, spawn} from 'node:child_process';
import {accessSync, constants, existsSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {delimiter, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream='https://github.com/EpicGamesExt/PixelStreamingInfrastructure.git';
const revision='c3e3abea6590a19e1c0ab4d2954efd6a1d949db3';
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

// O(A) for A argument characters. Reject invalid plans before imports or listeners.
export function parseStreamingArgs(args,{platform=process.platform}={}){
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    package:{type:'string'},host:{type:'string',default:'127.0.0.1'},
    port:{type:'string',default:'8080'},'streamer-port':{type:'string',default:'8888'},
    width:{type:'string',default:'1280'},height:{type:'string',default:'720'},
    gpu:{type:'string',default:'auto'},codec:{type:'string',default:'H264'},
    'virtual-display':{type:'boolean',default:false},
    'render-offscreen':{type:'boolean',default:false},
    'capture-fence':{type:'boolean',default:false},
    'decouple-framerate':{type:'boolean',default:false},
    'dry-run':{type:'boolean',default:false},help:{type:'boolean',short:'h',default:false}
  }});
  if(positionals.length>1)throw Error('Indica una sola acción: prepare, doctor o start.');
  const action=positionals[0]||'help';
  if(values.help||action==='help')return {action:'help',values};
  if(!['prepare','doctor','start'].includes(action))throw Error('Acción permitida: prepare, doctor o start.');
  values.port=number(values.port,1024,65535,'Puerto del jugador');
  values['streamer-port']=number(values['streamer-port'],1024,65535,'Puerto del juego');
  values.width=number(values.width,320,3840,'Ancho');
  values.height=number(values.height,240,2160,'Alto');
  if(values.port===values['streamer-port'])throw Error('Los puertos deben ser distintos.');
  if(!['127.0.0.1','0.0.0.0'].includes(values.host))throw Error('Host permitido: 127.0.0.1 o 0.0.0.0 para LAN.');
  if(!['auto','nvidia'].includes(values.gpu))throw Error('GPU permitida: auto o nvidia.');
  if(!['H264','VP8'].includes(values.codec))throw Error('Códec permitido: H264 o VP8.');
  if(values.package!==undefined&&!values.package.trim())throw Error('--package requiere una ruta no vacía.');
  if(values['decouple-framerate']&&!values['capture-fence'])throw Error('--decouple-framerate requiere --capture-fence en UE 5.5.');
  if(values['virtual-display']&&platform!=='linux')throw Error('--virtual-display sólo está disponible en Linux.');
  if(values['virtual-display']&&action==='prepare')throw Error('--virtual-display requiere doctor o start.');
  if(values['render-offscreen']&&action==='prepare')throw Error('--render-offscreen requiere doctor o start.');
  if(action!=='prepare'&&!['linux','win32'].includes(platform))throw Error('La partida admite Linux o Windows.');
  return {action,values};
}

function executableFile(path){
  try{if(!statSync(path).isFile())return false;accessSync(path,constants.X_OK);return true;}catch{return false;}
}

// O(P + E) for PATH entries and environment keys. Never mutate the desktop environment.
export function virtualDisplay(environment=process.env,{home=homedir(),isExecutable=executableFile}={}){
  const cache=resolve(home,'.cache/neiva-unreal-display/usr/bin');
  const paths=(environment.PATH||'').split(delimiter).filter(Boolean);
  const find=(name,folders)=>folders.map(folder=>resolve(folder,name)).find(isExecutable);
  const command=find('xvfb-run',paths)||find('xvfb-run',[cache]);
  if(!command)throw Error('Falta xvfb-run: instala Xvfb o prepara ~/.cache/neiva-unreal-display/usr/bin.');
  const search=[...new Set([dirname(command),...paths,cache])];
  for(const name of ['Xvfb','xauth']){
    if(!find(name,search))throw Error(`Falta ${name} para la pantalla virtual privada.`);
  }
  const env={...environment,PATH:search.join(delimiter),SDL_VIDEODRIVER:'x11'};
  for(const key of ['DISPLAY','WAYLAND_DISPLAY','WAYLAND_SOCKET','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','SESSION_MANAGER'])delete env[key];
  return {command,environment:env};
}

// O(P + E), same invariants as virtualDisplay; produces arguments, never starts a game.
export function gameLaunchPlan(values,{environment=process.env,home=homedir(),isExecutable=executableFile}={}){
  const virtual=values['virtual-display']?virtualDisplay(environment,{home,isExecutable}):null;
  const renderOffscreen=Boolean(!virtual||values['render-offscreen']);
  const gameArgs=[`-PixelStreamingURL=ws://127.0.0.1:${values['streamer-port']}`,
    renderOffscreen?'-RenderOffScreen':'-windowed',...(virtual?['-vulkan','-NoEpicPortal']:[]),'-AudioMixer',
    '-ForceRes',`-ResX=${values.width}`,`-ResY=${values.height}`,`-PixelStreamingEncoderCodec=${values.codec}`,
    '-PixelStreamingWebRTCFps=30','-ExecCmds=t.MaxFPS 30','-unattended','-stdout'];
  if(values['capture-fence'])gameArgs.push('-PixelStreamingCaptureUseFence');
  if(values['decouple-framerate'])gameArgs.push('-PixelStreamingDecoupleFramerate');
  return {gameArgs,renderOffscreen,command:virtual?.command||null,
    wrapperArgs:virtual?['-a','-s',`-screen 0 ${values.width}x${values.height}x24 -nolisten tcp`]:[],
    environment:virtual?.environment||{...environment}};
}

// O(1) launcher work; OS cleanup covers only the process tree/group we created.
export function stopOwnedProcess(child,{platform=process.platform,kill=process.kill,taskkill=execFileSync}={}){
  if(!child?.pid)return;
  try{
    if(platform==='win32')taskkill('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
    else kill(-child.pid,'SIGTERM');
  }catch{}
}

export function main(args=process.argv.slice(2)){
  const {action,values}=parseStreamingArgs(args);
  if(action==='help'){
    console.log('node scripts/pixel-streaming-local.mjs prepare [--dry-run]');
    console.log('node scripts/pixel-streaming-local.mjs doctor [--package RUTA] [opciones]');
    console.log('node scripts/pixel-streaming-local.mjs start --package RUTA [opciones]');
    console.log('doctor comprueba infraestructura/paquete y muestra el plan; no inicia servidor ni juego.');
    console.log('--codec H264|VP8: H264 por defecto; VP8 permite seleccionar codificación por software.');
    console.log('--virtual-display: Linux, Xvfb privado; ventana y pantalla coinciden con --width/--height (1280×720 por defecto).');
    console.log('--render-offscreen: combina render sin ventana con --virtual-display; la pantalla privada conserva las mismas dimensiones.');
    console.log('--capture-fence y --decouple-framerate: opciones explícitas, desactivadas por defecto; desacoplar requiere fence.');
    console.log('Vista local: --codec VP8 --virtual-display --capture-fence --decouple-framerate');
    console.log('--dry-run muestra el plan; sin --package start sólo sirve señalización, sin vídeo Unreal.');
    console.log('--host 0.0.0.0 permite LAN; una partida, un jugador. No publica en Internet.');
    return;
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
  }else if(action==='start'||action==='doctor'){
    verifyRevision();
    const port=values.port,streamerPort=values['streamer-port'];
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
      // Keep doctor/dry-run output as one JSON plan; verification still must exit successfully.
      execFileSync(process.platform==='win32'?'python':'python3',
        [resolve(repo,'scripts/unreal.py'),'verify-package','--output',folder],
        {cwd:repo,stdio:['ignore','pipe','pipe']});
      const distributionLauncher=resolve(folder,'Jugar-Neiva.sh');
      executable=target==='Linux'
        ?(existsSync(distributionLauncher)?distributionLauncher:resolve(folder,'Linux/NeivaAbierta.sh'))
        :resolve(folder,'Windows/NeivaAbierta.exe');
      if(!existsSync(executable))throw Error(`No existe el lanzador del paquete: ${executable}`);
      if(target==='Linux'&&!executableFile(executable))throw Error(`El lanzador del paquete no es un archivo ejecutable: ${executable}`);
    }
    const launch=gameLaunchPlan(values),gameArgs=launch.gameArgs;
    if(values['dry-run']||action==='doctor'){
      console.log(JSON.stringify({revision,host:values.host,port,streamerPort,executable,codec:values.codec,
        virtualDisplay:values['virtual-display'],renderOffscreen:launch.renderOffscreen,gameCommand:executable?(launch.command||executable):null,
        gameCommandArgs:executable?[...launch.wrapperArgs,...(launch.command?[executable]:[]),...gameArgs]:null,
        virtualDisplayCommand:launch.command,virtualDisplayArgs:launch.wrapperArgs,
        gameArgs,gameRunning:false,serverRunning:false,runtimeValidated:false},null,2));
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
          const env=launch.environment;
          let hasNvidia=false;
          try{hasNvidia=Boolean(execFileSync('nvidia-smi',['--query-gpu=name','--format=csv,noheader'],
            {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']}).trim());}catch{}
          if(values.gpu==='nvidia'&&!hasNvidia){console.error('NVIDIA no está disponible.');process.exit(1);}
          if(process.platform==='linux'&&hasNvidia)Object.assign(env,{
            __NV_PRIME_RENDER_OFFLOAD:'1',__GLX_VENDOR_LIBRARY_NAME:'nvidia',__VK_LAYER_NV_optimus:'NVIDIA_only'});
          const command=launch.command||executable;
          const commandArgs=[...launch.wrapperArgs,...(launch.command?[executable]:[]),...gameArgs];
          child=spawn(command,commandArgs,{cwd:dirname(executable),env,stdio:'inherit',detached:process.platform!=='win32'});
          // The group includes our Xvfb, wrapper, .sh launcher and game descendants.
          process.once('exit',()=>stopOwnedProcess(child));
          child.once('error',error=>{console.error(error.message);process.exit(1);});
          child.once('exit',code=>{console.log(`Unreal terminó (${code}).`);process.exit(code??1);});
        }else console.log('Sin paquete Unreal: señalización lista, NO hay partida ni imagen del juego.');
        const stop=()=>{if(child&&!child.killed)child.kill('SIGTERM');server.close();process.exit(0);};
        process.once('SIGINT',stop);process.once('SIGTERM',stop);
      });
    }
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
