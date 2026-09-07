import { createFeatureIndex } from './spatial.js';

const TILE_METRES = 512, TILE_PIXELS = 256, TILE_SCALE = TILE_PIXELS / TILE_METRES;
const MINI_SCALE = .28, TILE_LIMIT = 16, ATLAS_LIMIT = 2;
const COLORS = Object.freeze({ ground:'#18312b', park:'#35513b', road:'#708473', building:'#a5ac8b88', water:'#3c7374', marker:'#b6d8c0', studio:'#e7f89a', player:'#d5fa77' });
const pointOf = feature => feature.point || feature;
const validPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);

function defaultCanvas(width, height) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height; return canvas;
}
function discard(canvas) { canvas.width = 0; canvas.height = 0; }
function path(context, points, project, close) {
  if (!points?.length) return;
  points.forEach(([x,z], i) => { const p = project(x,z); if (i) context.lineTo(p.x,p.y); else context.moveTo(p.x,p.y); });
  if (close) context.closePath();
}

/** Cached map of immutable city data. Build O(V+C) using feature bounds.
 * Mini draw queries only missing local tiles; cache hits draw images + O(D)
 * markers. The 16 RGBA tiles occupy at most 4 MiB (excluding source indices,
 * temporary raster work and at most two atlas canvases). No input is mutated.
 * createCanvas is an optional test/host adapter; normal callers use two args.
 */
export function createMapView(data, destinations = [], { createCanvas = defaultCanvas } = {}) {
  const groups = ['parks','roads','buildings','water'].map(type => {
    const index = createFeatureIndex(data[type] || [], { cellSize:TILE_METRES });
    return { type, index, features:[...index.bounds.keys()] };
  });
  const tiles = new Map(), atlases = new Map();
  const counters = { draws:0, tileBuilds:0, tileHits:0, tileEvictions:0, atlasBuilds:0, atlasHits:0, atlasEvictions:0, featuresPainted:0, lastFeatureCount:0 };
  let disposed = false;
  // Include strokes whose centreline is outside a tile but whose width crosses
  // its edge. Long segments/polygons are selected by bbox, never by vertices.
  let padding = 2 / TILE_SCALE;
  for (const road of data.roads || []) padding = Math.max(padding, (road.width || 6) * .3 + 2 / TILE_SCALE);
  for (const water of data.water || []) if (!water.polygon) padding = Math.max(padding, (water.width || 10) * .5 + 2 / TILE_SCALE);
  let extent = data.meta?.extent;
  if (!Array.isArray(extent?.min) || !Array.isArray(extent?.max) || ![...extent.min,...extent.max].every(Number.isFinite)) {
    let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
    for (const group of groups) for (const bounds of group.index.bounds.values()) {
      minX=Math.min(minX,bounds.minX); minZ=Math.min(minZ,bounds.minZ); maxX=Math.max(maxX,bounds.maxX); maxZ=Math.max(maxZ,bounds.maxZ);
    }
    extent = Number.isFinite(minX) ? { min:[minX,minZ], max:[maxX,maxZ] } : { min:[-1,-1], max:[1,1] };
  }

  function paint(context, entries, project, scale, full) {
    for (const { type, features } of entries) for (const feature of features) {
      if (!feature.points?.length) continue;
      counters.featuresPainted++; counters.lastFeatureCount++;
      const polygon = type !== 'roads' && (type !== 'water' || feature.polygon);
      context.beginPath(); path(context, feature.points, project, polygon);
      if (polygon) for (const hole of feature.holes || []) path(context, hole, project, true);
      if (type === 'parks') { context.fillStyle = COLORS.park; context.fill('evenodd'); }
      else if (type === 'buildings') { context.fillStyle = COLORS.building; context.fill('evenodd'); }
      else if (type === 'roads') { context.strokeStyle = COLORS.road; context.lineWidth = Math.max(full ? .55 : 1, (feature.width || 6) * scale * .6); context.stroke(); }
      else { context.fillStyle = context.strokeStyle = COLORS.water; context.lineWidth = Math.max(2, (feature.width || 10) * scale); if (polygon) context.fill('evenodd'); else context.stroke(); }
    }
  }
  function touch(cache, key) { const value = cache.get(key); cache.delete(key); cache.set(key,value); return value; }
  function evict(cache, limit, counter) {
    while (cache.size > limit) { const key = cache.keys().next().value; discard(cache.get(key)); cache.delete(key); counters[counter]++; }
  }
  function tile(gx, gz) {
    const key = `${gx},${gz}`;
    if (tiles.has(key)) { counters.tileHits++; return touch(tiles,key); }
    const canvas = createCanvas(TILE_PIXELS,TILE_PIXELS), context = canvas.getContext('2d');
    const minX = gx * TILE_METRES, minZ = gz * TILE_METRES;
    const bounds = { minX:minX-padding, minZ:minZ-padding, maxX:minX+TILE_METRES+padding, maxZ:minZ+TILE_METRES+padding };
    context.save(); context.beginPath(); context.rect(0,0,TILE_PIXELS,TILE_PIXELS); context.clip();
    context.fillStyle = COLORS.ground; context.fillRect(0,0,TILE_PIXELS,TILE_PIXELS);
    paint(context, groups.map(group => ({ type:group.type, features:group.index.query(bounds) })), (x,z) => ({ x:(x-minX)*TILE_SCALE, y:(z-minZ)*TILE_SCALE }), TILE_SCALE, false);
    context.restore();
    tiles.set(key,canvas); counters.tileBuilds++; evict(tiles,TILE_LIMIT,'tileEvictions'); return canvas;
  }
  function projection(width,height,player,full) {
    const scale = full ? Math.min(Math.max(1,width-50)/Math.max(1,extent.max[0]-extent.min[0]),Math.max(1,height-50)/Math.max(1,extent.max[1]-extent.min[1])) : MINI_SCALE;
    const center = full ? { x:(extent.min[0]+extent.max[0])/2, z:(extent.min[1]+extent.max[1])/2 } : player;
    return { scale, center, project:(x,z) => ({ x:(x-center.x)*scale+width/2, y:(z-center.z)*scale+height/2 }) };
  }
  function atlas(width,height,project,scale) {
    const key = `${width},${height}`;
    if (atlases.has(key)) { counters.atlasHits++; return touch(atlases,key); }
    const canvas = createCanvas(width,height), context = canvas.getContext('2d');
    context.fillStyle = COLORS.ground; context.fillRect(0,0,width,height);
    paint(context,groups,project,scale,true);
    atlases.set(key,canvas); counters.atlasBuilds++; evict(atlases,ATLAS_LIMIT,'atlasEvictions'); return canvas;
  }
  function overlays(context,width,height,options,project) {
    const markers = destinations.filter(destination => validPoint(pointOf(destination)));
    const selected = markers.find(destination => destination.id === options.selectedId), p = project(options.player.x,options.player.z);
    if (selected) {
      const point = pointOf(selected), target = project(point.x,point.z);
      context.beginPath(); context.moveTo(p.x,p.y); context.lineTo(target.x,target.y);
      context.strokeStyle = '#d5fa7788'; context.lineWidth = 1; context.setLineDash([4,4]); context.stroke(); context.setLineDash([]);
    }
    const labels = []; context.font = '13px Arial';
    // Prioritize the selected label when central destinations overlap. The full
    // list remains a UI responsibility; every in-bounds marker remains drawn.
    const ordered = selected ? [selected,...markers.filter(marker => marker !== selected)] : markers;
    for (const destination of ordered) {
      const point = pointOf(destination), screen = project(point.x,point.z), chosen = destination.id === options.selectedId;
      if (screen.x < -8 || screen.x > width+8 || screen.y < -8 || screen.y > height+8) continue;
      context.fillStyle = destination.id === 'studio' || chosen ? COLORS.studio : COLORS.marker;
      context.beginPath(); context.arc(screen.x,screen.y,chosen ? 6 : options.full ? 5 : 4,0,Math.PI*2); context.fill();
      if (chosen) { context.strokeStyle = COLORS.ground; context.lineWidth = 2; context.stroke(); }
      if (options.full && destination.name) {
        const labelWidth = context.measureText(destination.name).width;
        const label = { x:Math.max(8,Math.min(width-labelWidth-8,screen.x+9)), y:Math.max(18,Math.min(height-8,screen.y+4)), width:labelWidth };
        if (!labels.some(other => label.x < other.x+other.width+8 && label.x+label.width+8 > other.x && Math.abs(label.y-other.y) < 19)) {
          context.fillText(destination.name,label.x,label.y); labels.push(label);
        }
      }
    }
    context.save(); context.translate(p.x,p.y); context.rotate(-options.heading);
    context.fillStyle = COLORS.player; context.strokeStyle = '#19342a'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(0,9); context.lineTo(-6,-6); context.lineTo(0,-3); context.lineTo(6,-6); context.closePath(); context.fill(); context.stroke(); context.restore();
    if (options.full) { context.fillStyle = COLORS.player; context.font = '12px Arial'; context.fillText('N ↑',width-34,24); }
  }
  function stats() { return { ...counters, tileCount:tiles.size, tileBytes:tiles.size*TILE_PIXELS*TILE_PIXELS*4, tileLimit:TILE_LIMIT, atlasCount:atlases.size, atlasBytes:[...atlases.values()].reduce((total,canvas) => total+canvas.width*canvas.height*4,0), disposed }; }
  return {
    draw(target,{ full = false, player, heading = 0, selectedId = null } = {}) {
      if (disposed || !validPoint(player) || !(target?.width > 0 && target?.height > 0)) return false;
      const context = target.getContext('2d'); if (!context) return false;
      const width = target.width, height = target.height, view = projection(width,height,player,full);
      counters.draws++; counters.lastFeatureCount = 0;
      context.save(); context.beginPath(); context.rect(0,0,width,height); context.clip();
      context.fillStyle = COLORS.ground; context.fillRect(0,0,width,height);
      if (full) context.drawImage(atlas(width,height,view.project,view.scale),0,0);
      else {
        const minGX = Math.floor((player.x-width/(2*MINI_SCALE))/TILE_METRES), maxGX = Math.floor((player.x+width/(2*MINI_SCALE))/TILE_METRES);
        const minGZ = Math.floor((player.z-height/(2*MINI_SCALE))/TILE_METRES), maxGZ = Math.floor((player.z+height/(2*MINI_SCALE))/TILE_METRES);
        for (let gx = minGX; gx <= maxGX; gx++) for (let gz = minGZ; gz <= maxGZ; gz++) {
          const a = view.project(gx*TILE_METRES,gz*TILE_METRES), b = view.project((gx+1)*TILE_METRES,(gz+1)*TILE_METRES);
          const x = Math.round(a.x), y = Math.round(a.y);
          context.drawImage(tile(gx,gz),x,y,Math.round(b.x)-x,Math.round(b.y)-y);
        }
      }
      overlays(context,width,height,{ full,player,heading:Number.isFinite(heading)?heading:0,selectedId },view.project);
      context.restore(); return true;
    },
    stats,
    dispose() { for (const canvas of [...tiles.values(),...atlases.values()]) discard(canvas); tiles.clear(); atlases.clear(); disposed = true; },
  };
}
