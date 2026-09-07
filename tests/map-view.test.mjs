import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapView } from '../src/map-view.js';

class Canvas {
  constructor(width,height) { this.width=width; this.height=height; this.context=new Context(); }
  getContext() { return this.context; }
}
class Context {
  constructor() { this.images=[];this.strokes=[];this.texts=[];this.arcs=[];this.clips=0;this.points=[]; }
  save() {} restore() {} beginPath() { this.points=[]; } closePath() {} rect() {} clip() { this.clips++; }
  moveTo(x,y) { this.points.push([x,y]); } lineTo(x,y) { this.points.push([x,y]); }
  fill() {} fillRect() {} translate() {} rotate() {} setLineDash() {}
  stroke() { this.strokes.push({ style:this.strokeStyle, points:[...this.points] }); }
  drawImage(canvas,...args) { this.images.push({ canvas,args }); }
  arc(x,y,radius) { this.arcs.push({ x,y,radius }); }
  fillText(text,x,y) { this.texts.push({ text,x,y }); }
  measureText(text) { return { width:text.length*7 }; }
}
const city = () => ({ meta:{ extent:{ min:[-2500,-2000],max:[2500,2000] } }, parks:[], buildings:[], water:[], roads:[{ points:[[-2000,0],[2000,0]], width:8 },{ points:[[10000,10000],[11000,10000]], width:8 }] });
const setup = (data=city(),destinations=[]) => {
  const created=[];
  return { created, view:createMapView(data,destinations,{ createCanvas:(w,h) => { const canvas=new Canvas(w,h);created.push(canvas);return canvas; } }) };
};

test('hot minimap draws cached tiles without repainting geometry', () => {
  const {view}=setup(), target=new Canvas(240,180);
  view.draw(target,{ player:{x:0,z:0} }); const first=view.stats();
  assert.ok(first.tileBuilds>0 && first.lastFeatureCount>0);
  view.draw(target,{ player:{x:1,z:1},heading:1 }); const second=view.stats();
  assert.equal(second.tileBuilds,first.tileBuilds);
  assert.equal(second.featuresPainted,first.featuresPainted);
  assert.equal(second.lastFeatureCount,0);
  assert.ok(second.tileHits>first.tileHits);
});

test('tile queries retain long crossing roads, reject distant geometry and clip each raster', () => {
  const {view,created}=setup(), target=new Canvas(240,180);
  view.draw(target,{ player:{x:0,z:0} });
  assert.equal(created.length,4);
  for (const canvas of created) {
    const roads=canvas.context.strokes.filter(stroke=>stroke.style==='#708473');
    assert.equal(roads.length,1,'only the crossing road is selected');
    assert.ok(roads[0].points[0][0]<0&&roads[0].points[1][0]>256,'both endpoints are outside the tile');
    assert.ok(canvas.context.clips>0);
  }
});

test('wide strokes just outside a tile centreline are included at its edge', () => {
  const data=city(); data.roads=[{ points:[[513,-1000],[513,1000]],width:20 }];
  const {view,created}=setup(data);
  view.draw(new Canvas(100,100),{ player:{x:400,z:200} });
  assert.ok(created.some(canvas=>canvas.context.strokes.some(stroke=>stroke.style==='#708473'&&stroke.points.every(point=>point[0]===256.5))),'left tile paints stroke overlap beyond x512');
});

test('travelling evicts old tiles and never retains more than 16 RGBA tiles', () => {
  const {view,created}=setup(), target=new Canvas(240,180);
  for (let i=0;i<20;i++) {
    view.draw(target,{ player:{x:i*3000,z:i*2000} });
    assert.ok(view.stats().tileCount<=16); assert.ok(view.stats().tileBytes<=4*1024*1024);
  }
  assert.ok(view.stats().tileEvictions>0);
  assert.ok(created.some(canvas=>canvas.width===0&&canvas.height===0));
  view.dispose(); assert.equal(view.stats().tileBytes,0); assert.equal(view.stats().disposed,true);
  assert.equal(view.draw(target,{ player:{x:0,z:0} }),false);
});

test('atlas is painted once per retained size; changing markers does not repaint city geometry', () => {
  const {view}=setup();
  const first=new Canvas(640,480),second=new Canvas(800,600);
  view.draw(first,{ full:true,player:{x:0,z:0} }); const count=view.stats().featuresPainted;
  view.draw(first,{ full:true,player:{x:100,z:100},heading:2 });
  assert.equal(view.stats().atlasBuilds,1); assert.equal(view.stats().featuresPainted,count);
  view.draw(second,{ full:true,player:{x:0,z:0} });
  view.draw(first,{ full:true,player:{x:0,z:0} }); assert.equal(view.stats().atlasBuilds,2);
  view.draw(new Canvas(1024,768),{ full:true,player:{x:0,z:0} });
  assert.equal(view.stats().atlasCount,2); assert.equal(view.stats().atlasEvictions,1);
});

test('selected central label remains visible while overlapping labels are omitted', () => {
  const destinations=[{id:'court',name:'Palacio de Justicia',x:0,z:0},{id:'colonial',name:'Templo Colonial',x:0,z:0}];
  const {view}=setup(city(),destinations), target=new Canvas(640,480);
  view.draw(target,{full:true,player:{x:20,z:20},selectedId:'colonial'});
  const texts=target.context.texts.map(text=>text.text);
  assert.ok(texts.includes('Templo Colonial')); assert.ok(!texts.includes('Palacio de Justicia'));
  assert.equal(target.context.arcs.length,2,'both markers remain drawn');
});

test('empty/degenerate maps remain finite, zero-size targets skip work and input is immutable', () => {
  const data=Object.freeze({meta:Object.freeze({extent:Object.freeze({min:Object.freeze([0,0]),max:Object.freeze([0,0])})}),roads:Object.freeze([])});
  const {view}=setup(data),target=new Canvas(32,32);
  assert.equal(view.draw(new Canvas(0,0),{player:{x:0,z:0}}),false);
  assert.equal(view.draw(target,{full:true,player:{x:0,z:0}}),true);
  for(const stroke of target.context.strokes) for(const point of stroke.points)assert.ok(point.every(Number.isFinite));
  assert.equal(view.draw(target,{player:{x:Infinity,z:0}}),false);
});
