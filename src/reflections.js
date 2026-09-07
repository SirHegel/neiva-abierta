import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// A single shared reflection of actual nearby geometry, clipped into irregular
// pools on the mapped roads. No city proxy, cubemap photograph or fake car image.
const noiseGLSL = /* glsl */`
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise21(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}`;

export function createRoadReflections(scene, camera, roads, { renderer, mobile=false, powerful=false } = {}) {
  const shader = {
    name: 'Neiva actual road puddles',
    uniforms: {
      color: { value: new T.Color('#b8ccd3') }, tDiffuse: { value: null }, textureMatrix: { value: null },
      cameraPositionWorld: { value: new T.Vector3() }, focus: { value: new T.Vector2() },
    },
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vReflection; varying vec3 vWorld; varying vec2 vRoad;
      void main() {
        vReflection=textureMatrix*vec4(position,1.0);
        vWorld=(modelMatrix*vec4(position,1.0)).xyz; vRoad=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform vec3 color; uniform vec3 cameraPositionWorld; uniform vec2 focus;
      varying vec4 vReflection; varying vec3 vWorld; varying vec2 vRoad;
      ${noiseGLSL}
      void main() {
        float islands=noise21(vWorld.xz*.39)*.72+noise21(vWorld.xz*1.47)*.28;
        float pool=smoothstep(.49,.58,islands);
        float edge=smoothstep(0.0,.12,vRoad.x)*(1.0-smoothstep(.88,1.0,vRoad.x));
        float distanceFade=1.0-smoothstep(28.0,44.0,distance(vWorld.xz,focus));
        // Keep painted centre lines visible above the shallow film.
        float line=smoothstep(.055,.12,abs(vRoad.x-.5)*vRoad.y);
        float mask=pool*edge*distanceFade*line;
        if(mask<.025) discard;
        vec3 viewDirection=normalize(cameraPositionWorld-vWorld);
        float fresnel=.035+.965*pow(1.0-clamp(viewDirection.y,0.0,1.0),5.0);
        vec2 ripple=vec2(noise21(vWorld.xz*2.8),noise21(vWorld.zx*2.8+7.0))-.5;
        vec4 projected=vReflection; projected.xy+=ripple*.0008*projected.w;
        vec3 reflected=texture2DProj(tDiffuse,projected).rgb;
        gl_FragColor=vec4(reflected*color,mask*clamp(.22+fresnel*.78,0.0,.94));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
  const puddles = new Reflector(new T.BufferGeometry(), {
    textureWidth: mobile ? 256 : 512, textureHeight: mobile ? 256 : 512,
    multisample: 0, clipBias: .002, color: '#d0dbe0', shader,
  });
  puddles.name = 'Charcos / reflexión planar real';
  puddles.rotation.x = -Math.PI / 2; puddles.position.y = .018;
  puddles.material.transparent = true; puddles.material.depthWrite = false;
  puddles.material.side = T.FrontSide; puddles.renderOrder = 3;
  puddles.visible = false; scene.add(puddles);
  const roadCells = new Map(), cellSize = 100;
  for (const road of roads) {
    if (/footway|path|steps|cycleway/.test(road.type)) continue;
    for (let i=1;i<road.points.length;i++) {
      const [ax,az]=road.points[i-1],[bx,bz]=road.points[i],length=Math.hypot(bx-ax,bz-az);
      if(length<.1)continue;
      const segment={ax,az,bx,bz,length,width:road.width};
      for(let x=Math.floor(Math.min(ax,bx)/cellSize);x<=Math.floor(Math.max(ax,bx)/cellSize);x++)
        for(let z=Math.floor(Math.min(az,bz)/cellSize);z<=Math.floor(Math.max(az,bz)/cellSize);z++) {
          const key=`${x},${z}`;if(!roadCells.has(key))roadCells.set(key,new Set());roadCells.get(key).add(segment);
        }
    }
  }
  let anchor=new T.Vector2(Infinity,Infinity), elapsed=1, enabled=false, quality=0, pending=true;
  const captureCamera=camera.clone();
  const originalRender=puddles.onBeforeRender.bind(puddles);
  // Reflector already preserves the shadow map and renders only once. The smaller
  // far plane also culls distant detailed objects from the extra pass.
  // Schedule the capture before the main render. Nested captures inside the
  // glTF car's transmission pass can contaminate that pass's depth/background.
  puddles.onBeforeRender=()=>{};
  function capture() {
    if(!pending)return;
    pending=false;elapsed=0;
    camera.updateMatrixWorld(true);
    captureCamera.copy(camera);captureCamera.far=mobile?75:115;captureCamera.updateProjectionMatrix();
    captureCamera.matrixWorld.copy(camera.matrixWorld);captureCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
    const hidden=[];
    scene.updateMatrixWorld(true);
    scene.traverse(node=>{
      if(node.userData.kind==='detailed-car'&&node.visible&&node.position.distanceTo(camera.position)>65) {
        hidden.push(node);node.visible=false;
      }
      // The reflected glass does not need another scene refraction pass. Keep
      // every visible car/body/tree surface, and omit only transmissive panes.
      if(node.isMesh&&node.visible&&!Array.isArray(node.material)&&node.material.transmission>0) {
        hidden.push(node);node.visible=false;
      }
    });
    try { originalRender(renderer,scene,captureCamera); }
    finally { hidden.forEach(node=>node.visible=true); }
  }
  function rebuild(x,z) {
    const positions=[],uv=[],segments=new Set(), radius=48;
    for(let ix=Math.floor((x-radius)/cellSize);ix<=Math.floor((x+radius)/cellSize);ix++)
      for(let iz=Math.floor((z-radius)/cellSize);iz<=Math.floor((z+radius)/cellSize);iz++)
        for(const segment of roadCells.get(`${ix},${iz}`)||[])segments.add(segment);
    for(const s of segments) {
      const dx=(s.bx-s.ax)/s.length,dz=(s.bz-s.az)/s.length,along=(x-s.ax)*dx+(z-s.az)*dz;
      const across=(x-s.ax)*-dz+(z-s.az)*dx;
      if(Math.abs(across)>radius)continue;
      const extent=Math.sqrt(radius*radius-across*across),start=Math.max(0,along-extent),end=Math.min(s.length,along+extent);
      if(end<=start)continue;
      const ax=s.ax+dx*start,az=s.az+dz*start,bx=s.ax+dx*end,bz=s.az+dz*end;
      const nx=-dz*s.width*.47,nz=dx*s.width*.47;
      // Local XY becomes world XZ when the reflector is rotated into the road plane.
      positions.push(ax+nx,-az-nz,0,bx+nx,-bz-nz,0,ax-nx,-az+nz,0,
        ax-nx,-az+nz,0,bx+nx,-bz-nz,0,bx-nx,-bz+nz,0);
      uv.push(0,s.width,0,s.width,1,s.width,1,s.width,0,s.width,1,s.width);
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();
    puddles.geometry.dispose();puddles.geometry=geometry;anchor.set(x,z);pending=true;
  }
  return {
    mesh:puddles,
    setEnabled(value){enabled=value;puddles.visible=value;pending=true;},
    setQuality(value){quality=value;const size=mobile?256:value===2?512:384;puddles.getRenderTarget().setSize(size,size);pending=true;},
    update(dt,position){
      if(!enabled)return;
      if(anchor.distanceTo(new T.Vector2(position.x,position.z))>12)rebuild(position.x,position.z);
      elapsed+=dt;if(elapsed>=(quality===2 && powerful ? .1 : .2))pending=true;
      puddles.material.uniforms.cameraPositionWorld.value.copy(camera.position);
      puddles.material.uniforms.focus.value.set(position.x,position.z);
      capture();
    },
    dispose(){puddles.removeFromParent();puddles.geometry.dispose();puddles.dispose();},
  };
}

export { noiseGLSL };
