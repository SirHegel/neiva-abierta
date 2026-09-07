import test from 'node:test';
import assert from 'node:assert/strict';
import { createLookController,normalizeSensitivity,WALK_SPEED,RUN_SPEED } from '../src/controls.js';
const emit=(target,name,values={})=>{const event=new Event(name);Object.assign(event,values);target.dispatchEvent(event)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({touch=false,supported=true}={}){
 const canvas=new EventTarget(),doc=new EventTarget(),state={active:true,moves:[],modes:[],pauses:0,requests:0};
 doc.pointerLockElement=null;doc.exitPointerLock=()=>queueMicrotask(()=>{doc.pointerLockElement=null;emit(doc,'pointerlockchange')});
 canvas.setPointerCapture=()=>{};
 if(supported)canvas.requestPointerLock=()=>{state.requests++;};
 const look=createLookController({canvas,doc,isActive:()=>state.active,isTouch:()=>touch,onLook:(x,y)=>state.moves.push([x,y]),onMode:mode=>state.modes.push(mode),onPause:()=>{state.active=false;state.pauses++;}});
 return {canvas,doc,state,look,grant:()=>{doc.pointerLockElement=canvas;emit(doc,'pointerlockchange')}};
}
test('captura usa mouse sin botones y una concesión duplicada no pide otra captura',()=>{const f=fixture();f.look.request();f.grant();emit(f.doc,'mousemove',{movementX:42,movementY:-8,buttons:0});f.look.request();assert.deepEqual(f.state.moves,[[42,-8]]);assert.equal(f.state.requests,1);assert.equal(f.look.snapshot().mode,'locked')});
test('rechazo Promise produce fallback sin botón y no una promesa rechazada suelta',async()=>{const f=fixture();f.canvas.requestPointerLock=()=>Promise.reject(new Error('denied'));f.look.request();await tick();assert.equal(f.look.snapshot().mode,'free');emit(f.canvas,'pointermove',{pointerType:'mouse',clientX:10,clientY:15,buttons:0});emit(f.canvas,'pointermove',{pointerType:'mouse',clientX:30,clientY:22,buttons:0});assert.deepEqual(f.state.moves,[[20,7]])});
test('API antigua anuncia errores por evento y conserva el fallback',()=>{const f=fixture();f.look.request();emit(f.doc,'pointerlockerror');assert.equal(f.look.snapshot().mode,'free');assert.equal(f.look.snapshot().pending,false)});
test('una concesión tardía se libera sobre un menú cerrado al juego',async()=>{const f=fixture();f.look.request();f.state.active=false;f.look.release();f.grant();await tick();assert.equal(f.look.snapshot().locked,false);assert.equal(f.look.snapshot().mode,'idle');assert.equal(f.state.pauses,0)});
test('liberar antes del evento de concesión no deja la siguiente solicitud atascada',async()=>{const f=fixture();f.look.request();f.doc.pointerLockElement=f.canvas;f.look.release();await tick();assert.equal(f.look.snapshot().pending,false);f.look.request();assert.equal(f.state.requests,2);f.grant();assert.equal(f.look.snapshot().mode,'locked')});
test('cerrar un menú durante la liberación pide captura después sin falsa pausa',async()=>{const f=fixture();f.look.request();f.grant();f.look.release();f.look.request();assert.equal(f.state.requests,1);await tick();assert.equal(f.state.requests,2);f.grant();assert.equal(f.look.snapshot().locked,true);assert.equal(f.state.pauses,0)});
test('la salida externa pausa y no pide recuperar el cursor',async()=>{const f=fixture();f.look.request();f.grant();f.doc.exitPointerLock();await tick();assert.equal(f.state.pauses,1);assert.equal(f.state.active,false);assert.equal(f.state.requests,1);assert.equal(f.look.snapshot().mode,'idle')});
test('táctil sigue el dedo capturado y cancelarlo detiene la mirada',()=>{const f=fixture({touch:true});f.look.request();emit(f.canvas,'pointerdown',{pointerType:'touch',pointerId:7,clientX:30,clientY:50});emit(f.canvas,'pointermove',{pointerType:'touch',pointerId:7,clientX:50,clientY:42});emit(f.canvas,'pointercancel',{pointerId:7});emit(f.canvas,'pointermove',{pointerType:'touch',pointerId:7,clientX:80,clientY:40});assert.deepEqual(f.state.moves,[[20,-8]]);assert.equal(f.state.requests,0)});
test('sin API hay mouse libre; sensibilidad y carrera conservan límites finitos',()=>{const f=fixture({supported:false});f.look.request();assert.equal(f.look.snapshot().mode,'free');assert.equal(normalizeSensitivity('nada'),1);assert.equal(normalizeSensitivity(-10),.5);assert.equal(normalizeSensitivity(20),2);assert.ok(RUN_SPEED>2*WALK_SPEED)});
