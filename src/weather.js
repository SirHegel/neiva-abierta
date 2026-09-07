import * as T from 'three';
import { createRoadReflections, noiseGLSL } from './reflections.js';

/** Physical wet surfaces + genuine, budgeted reflections; no rain particle pass. */
export function createWeather({ scene, camera, renderer, sun, hemi, pbr, roads, mobile, powerful }) {
  const wetness={value:0};
  const asphalt=pbr.asphalt;
  const dryPavementColor=pbr.pavement.color.clone();
  asphalt.clearcoat=1; asphalt.clearcoatRoughness=.19;
  // Compile once for both conditions; zero clearcoat in dry weather is a uniform.
  asphalt.onBeforeCompile=shader=>{
    shader.uniforms.neivaWetness=wetness;
    shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNeivaWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeivaWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float neivaWetness;\nvarying vec3 vNeivaWorld;\n${noiseGLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macroVariation=noise21(vNeivaWorld.xz*.083);
        #ifdef USE_MAP
          vec3 secondGrain=texture2D(map,vMapUv*.713+vec2(19.37,7.13)).rgb;
          diffuseColor.rgb=mix(diffuseColor.rgb,secondGrain*diffuse,.24);
        #endif
        diffuseColor.rgb*=mix(.87,1.08,macroVariation)*mix(1.0,.62,neivaWetness);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.23+noise21(vNeivaWorld.xz*.36)*.24,neivaWetness);`)
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat*=neivaWetness;`);
  };
  asphalt.customProgramCacheKey=()=> 'neiva-road-weather-v1';
  asphalt.needsUpdate=true;
  const reflections=createRoadReflections(scene,camera,roads,{renderer,mobile,powerful});
  let mode='clear', request=0, timeIndex=0, viewDistance=mobile?450:700;
  const applyLighting=()=>{
    if(mode==='after-rain') {
      sun.color.set('#dde6ed');sun.intensity=.85;sun.shadow.radius=3;
      hemi.color.set('#c1d0dd');hemi.groundColor.set('#656661');hemi.intensity=.2;
      scene.environmentIntensity=.62;scene.backgroundIntensity=.66;
      scene.fog.color.set('#a8b5bc');scene.fog.near=viewDistance*.45;scene.fog.far=viewDistance*.96;
      renderer.toneMappingExposure=1.02;
    } else {
      const s=[['#fff3df',3.2,.18,.8,.94,.22],['#ffd2a0',2.4,.11,.6,1.02,.14],['#fff9f0',3.6,.22,.95,.91,.26]][timeIndex];
      sun.color.set(s[0]);sun.intensity=s[1];sun.shadow.radius=2;
      hemi.color.set('#d8e5ed');hemi.groundColor.set('#8d8170');hemi.intensity=s[2];
      scene.backgroundIntensity=s[3];renderer.toneMappingExposure=s[4];scene.environmentIntensity=s[5];
      scene.fog.color.set('#c1c8c8');scene.fog.near=viewDistance*.56;scene.fog.far=viewDistance*.97;
    }
  };
  async function setWeather(next) {
    if(!['clear','after-rain'].includes(next))throw new Error(`Clima desconocido: ${next}`);
    const currentRequest=++request;
    // Keep the old condition intact if an HDR download fails or a newer choice wins.
    const environment=next==='after-rain'?await pbr.loadOvercast():{sky:pbr.sky,environment:pbr.environment};
    if(currentRequest!==request)return mode;
    mode=next;wetness.value=next==='after-rain'?1:0;
    scene.background=environment.sky;scene.environment=environment.environment;
    asphalt.normalScale.set(.24,.24);asphalt.envMapIntensity=next==='after-rain'?1.1:.35;
    pbr.pavement.normalScale.set(.25,.25);pbr.pavement.roughness=next==='after-rain'?.65:1;
    pbr.pavement.color.copy(dryPavementColor).multiplyScalar(next==='after-rain'?.76:1);
    pbr.pavement.envMapIntensity=next==='after-rain'?1:.75;
    reflections.setEnabled(next==='after-rain');applyLighting();return mode;
  }
  return {
    get mode(){return mode;}, setWeather,
    setViewDistance(distance){viewDistance=distance;applyLighting();},
    setTime(index){timeIndex=T.MathUtils.clamp(Math.floor(index),0,2);applyLighting();},
    setQuality:reflections.setQuality,
    update:reflections.update,
    dispose:reflections.dispose,
    reflections,
  };
}
