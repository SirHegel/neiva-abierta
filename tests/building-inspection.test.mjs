import test from 'node:test';
import assert from 'node:assert/strict';
import {measureFootprint,localToWgs84,streetViewUrl,buildingRecord} from '../src/building-inspection.js';
import {project,ORIGIN} from '../scripts/map-data.mjs';
const almost=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('metric footprint excludes courtyard and preserves enclosing dimensions under rotation',()=>{
  const rotate=points=>points.map(([x,z])=>[x*Math.cos(.61)-z*Math.sin(.61)-955,x*Math.sin(.61)+z*Math.cos(.61)+302]);
  const points=[[0,0],[20,0],[20,10],[0,10]],hole=[[2,2],[4,2],[4,4],[2,4]];
  for(const turn of [p=>p,rotate]){const metric=measureFootprint({points:turn(points),holes:[turn(hole)]});almost(metric.area,196);almost(metric.width,20);almost(metric.depth,10);almost(metric.perimeter,60);}
});
test('concave footprint area is not confused with its surrounding rectangle',()=>{
  const metric=measureFootprint({points:[[0,0],[10,0],[10,2],[2,2],[2,10],[0,10]]});
  almost(metric.area,36);almost(metric.width,10);almost(metric.depth,10);
});
test('source tags and model estimates never imply a verified field measurement',()=>{
  const building={id:'way/123',height:5.8,heightEstimated:true,points:[[0,0],[8,0],[8,4],[0,4]]};
  let record=buildingRecord(building,ORIGIN);assert.match(record.heightOrigin,/estimada/);assert.equal(record.heightEstimated,true);assert.equal(record.sourceUrl,'https://www.openstreetmap.org/way/123');
  record=buildingRecord({...building,height:33,heightEstimated:false},ORIGIN);assert.match(record.heightOrigin,/sin verificación/);
  record=buildingRecord({...building,id:'overture/test',source:'Google Open Buildings',footprintEstimated:true},ORIGIN);assert.match(record.footprintOrigin,/Detección automática/);
});
test('Street View links use the same metric projection and camera-to-building heading',()=>{
  const point={x:-879.3,z:-93.9},target={x:point.x+50,z:point.z};
  const {lon,lat}=localToWgs84(point,ORIGIN);assert.deepEqual(project(lon,lat),[point.x,point.z]);
  const url=new URL(streetViewUrl(point,target,ORIGIN));assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('map_action'),'pano');almost(Number(url.searchParams.get('heading')),90);
  const [linkLat,linkLon]=url.searchParams.get('viewpoint').split(',').map(Number);assert.ok(Math.abs(linkLat-lat)<1e-7);assert.ok(Math.abs(linkLon-lon)<1e-7);
});
