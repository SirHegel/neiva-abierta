import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestRoad } from '../src/physics.js';
import { applyUrbanSurvey } from '../src/urban-data.js';
import { boundsDistance, createFeatureIndex, createRoadIndex, inspectBuildingRay } from '../src/spatial.js';

const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} ≈ ${b}`);
const square = (id,x,z,width,height=10) => ({ id, height, points:[[x,z],[x+width,z],[x+width,z+width],[x,z+width]] });

test('feature bounds include long crossing segments with no vertex inside the query', () => {
  const crossing = { points:[[-2000,0],[2000,0]] }, distant = { points:[[10000,0],[10100,0]] };
  const index = createFeatureIndex([crossing,distant]);
  assert.deepEqual(index.query({ minX:-5,minZ:-5,maxX:5,maxZ:5 }), [crossing]);
  assert.deepEqual(index.query({ minX:2000,minZ:0,maxX:2000,maxZ:0 }), [crossing], 'boundary is inclusive');
  close(boundsDistance(0,0,{ minX:-1,minZ:-1,maxX:1,maxZ:1 }), 0);
  close(boundsDistance(4,5,{ minX:-1,minZ:-1,maxX:1,maxZ:1 }), 5);
});

test('spatial configuration and non-finite queries cannot create unbounded cell loops', () => {
  for (const cellSize of [0,-1,Infinity,NaN]) {
    assert.throws(() => createFeatureIndex([], { cellSize }), RangeError);
    assert.throws(() => createRoadIndex([], { cellSize }), RangeError);
  }
  const index = createFeatureIndex([square('a',0,0,10)]);
  assert.deepEqual(index.query({ minX:0,minZ:0,maxX:Infinity,maxZ:10 }), []);
  assert.deepEqual(index.query({ minX:10,minZ:0,maxX:0,maxZ:10 }), []);
  const invalid = createRoadIndex([{ points:[[0,0],[Infinity,0]] }]);
  assert.equal(invalid.stats.totalSegments, 0);
  assert.equal(invalid.nearest(0,0).distance, Infinity);
});

test('indexed road ties, driving exclusions and empty roads match the brute-force contract', () => {
  const roads = [
    { id:'first', name:'Primera', type:'residential', width:7, points:[[-2000,2],[2000,2]] },
    { id:'second', name:'Segunda', type:'residential', points:[[-2000,-2],[2000,-2]] },
    { id:'walk', name:'Sendero', type:'footway', points:[[-2000,0],[2000,0]] },
    { id:'zero', points:[[0,0],[0,0]] },
  ];
  const index = createRoadIndex(roads);
  assert.equal(index.nearest(0,0).id, 'walk');
  assert.equal(index.nearest(0,0,true).id, 'first');
  for (const drivable of [false,true]) for (const [x,z] of [[0,0],[120,120],[-4000,-4000],[4000,4000]]) {
    const a = index.nearest(x,z,drivable), b = nearestRoad(x,z,roads,drivable);
    for (const field of ['x','z','distance','angle','width']) close(a[field],b[field]);
    assert.equal(a.name,b.name);
  }
  assert.deepEqual(createRoadIndex([]).nearest(3,4), nearestRoad(3,4,[]));
});

test('indexed nearest roads match brute force across the actual revised Neiva export', () => {
  const data = applyUrbanSurvey(JSON.parse(readFileSync(new URL('../public/data/neiva.json',import.meta.url))),JSON.parse(readFileSync(new URL('../public/data/neiva-survey.json',import.meta.url))));
  const index = createRoadIndex(data.roads), extent = data.meta.extent;
  let seed = 81452; const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const points = [[-886.7,-78.8],[-922,-150],[-963.6,-6.1],[-851.6,-199.9],[extent.min[0]-5000,extent.min[1]-5000],[extent.max[0]+5000,extent.max[1]+5000]];
  for (let i=0;i<96;i++) points.push([extent.min[0]+random()*(extent.max[0]-extent.min[0]),extent.min[1]+random()*(extent.max[1]-extent.min[1])]);
  for (const [x,z] of points) for (const drivable of [false,true]) {
    const a=index.nearest(x,z,drivable), b=nearestRoad(x,z,data.roads,drivable);
    for (const field of ['x','z','distance','angle','width']) close(a[field],b[field]);
    assert.equal(a.name,b.name);
  }
  index.nearest(-886.7,-78.8,true);
  assert.ok(index.stats.visitedSegments < index.stats.totalSegments, 'the known central query prunes segments');
});

test('building ray selects the first wall and respects height and maximum inclusive distance', () => {
  const near=square('near',10,-5,5,4), far=square('far',20,-5,5,20), index=createFeatureIndex([far,near]);
  assert.equal(inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:1,y:0,z:0 }).building.id,'near');
  assert.equal(inspectBuildingRay(index,{ x:0,y:5,z:0 },{ x:1,y:0,z:0 }).building.id,'far');
  const endpoint=inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:1,y:0,z:0 },10);
  assert.equal(endpoint.building.id,'near'); close(endpoint.distance,10);
  assert.equal(inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:1,y:0,z:0 },9.9),null);
});

test('building ray observes courtyard walls and uses the vertical component at intersection', () => {
  const courtyard={ ...square('court',0,0,10), holes:[[[3,3],[7,3],[7,7],[3,7]]] };
  const hit=inspectBuildingRay(createFeatureIndex([courtyard]),{ x:5,y:2,z:5 },{ x:1,y:0,z:0 });
  close(hit.distance,2); close(hit.x,7);
  const index=createFeatureIndex([square('low',10,-5,5,4)]);
  assert.equal(inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:1,y:.5,z:0 }),null);
});

test('zero and invalid inspection rays do not query the spatial grid', () => {
  const index={ query:() => { throw new Error('must not query'); } };
  assert.equal(inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:0,y:1,z:0 }),null);
  assert.equal(inspectBuildingRay(index,{ x:0,y:2,z:0 },{ x:1,y:0,z:0 },Infinity),null);
  assert.equal(inspectBuildingRay(index,{ x:NaN,y:2,z:0 },{ x:1,y:0,z:0 }),null);
});


test('open canopies let inspection rays through to the building behind; only supports and slab intercept them',()=>{
  const canopy={...square('roof',0,0,10,5.8),structure:{kind:'open-canopy',roofThickness:.28,columns:[{x:1,z:1,radius:.22,height:5.52},{x:9,z:9,radius:.22,height:5.52}]}},behind=square('behind',20,0,10,12),index=createFeatureIndex([canopy,behind]);
  const under=inspectBuildingRay(index,{x:-5,y:1.5,z:5},{x:1,y:0,z:0});assert.equal(under.building.id,'behind');close(under.distance,25);
  const column=inspectBuildingRay(index,{x:-5,y:1.5,z:1},{x:1,y:0,z:0});assert.equal(column.building.id,'roof');close(column.distance,5.78);
  const slab=inspectBuildingRay(index,{x:-5,y:5.6,z:5},{x:1,y:0,z:0});assert.equal(slab.building.id,'roof');close(slab.distance,5);
  const underside=inspectBuildingRay(index,{x:2,y:4,z:5},{x:1,y:1,z:0});assert.equal(underside.building.id,'roof');close(underside.distance,1.52);
});
