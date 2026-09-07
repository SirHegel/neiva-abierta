#!/usr/bin/env python3
"""Build source-backed correction layer offline; requires shapely==2.1.2.

Base map remains unchanged. Support columns are explicitly estimated, not surveyed.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path

from shapely import LineString, Point, Polygon, STRtree
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
base = ROOT / 'public/data/neiva.json'
data = json.loads(base.read_text())
osm = json.load(gzip.open(ROOT / 'public/data/neiva.osm.json.gz'))
overture = json.load(gzip.open(ROOT / 'public/data/neiva.overture.json.gz'))
buildings = {b['id']: b for b in data['buildings']}
roads = [LineString(r['points']) for r in data['roads']]
road_tree = STRtree(roads)
corrections = []
for element in osm['elements']:
    identifier = f"{element['type']}/{element['id']}"
    tags = element.get('tags', {})
    if identifier not in buildings or tags.get('building') not in ['roof', 'carport']:
        continue
    building = buildings[identifier]
    polygon = Polygon(building['points'], building.get('holes', []))
    inset = polygon.buffer(-.65, join_style=2)
    if inset.geom_type == 'MultiPolygon':
        inset = max(inset.geoms, key=lambda g: g.area)
    if inset.is_empty or inset.geom_type != 'Polygon':
        raise ValueError(f'Cannot place estimated supports safely for {identifier}')
    candidates = list(inset.exterior.coords)[:-1]
    if len(candidates) > 8:
        candidates = [candidates[math.floor(i * len(candidates) / 8)] for i in range(8)]
    near_roads = [roads[int(i)] for i in road_tree.query(polygon)]
    columns = []
    for x, z in candidates:
        x, z = round(x, 2), round(z, 2)
        point = Point(x, z)
        if not polygon.covers(point.buffer(.23)):
            continue
        # Keep support design clear of mapped access centerlines. Their widths are estimates.
        if any(point.distance(road) < 1.2 for road in near_roads):
            continue
        if any(math.hypot(x - c['x'], z - c['z']) < 1 for c in columns):
            continue
        columns.append({'x': x, 'z': z, 'radius': .22, 'height': round(building['height'] - .28, 2)})
    if len(columns) < 2:
        raise ValueError(f'Insufficient unobstructed estimated supports for {identifier}')
    corrections.append({
        'id': identifier, 'buildingKind': 'roof',
        **({'amenity': tags['amenity']} if tags.get('amenity') else {}),
        'sourceTags': {k: tags[k] for k in ['building', 'amenity', 'layer', 'height', 'building:levels'] if k in tags},
        'structure': {'kind': 'open-canopy', 'roofThickness': .28, 'supportsEstimated': True, 'columns': columns},
        'collisionMode': 'columns', 'sourceIds': ['osm-snapshot', 'osm-roof-definition'],
        'reason': 'OSM building=roof/carport identifies an open cover. Preserve its mapped roof footprint; remove unsupported enclosing walls. Column dimensions and positions are estimates.'})

identifier = '803e95fd-4868-4568-a335-af0c4d992ce8'
feature = next(f for f in overture['features'] if f['id'] == identifier)
assert shape(feature['geometry']).is_valid
origin = data['meta']['origin']
points = [[round(math.radians(lon - origin[0]) * 6378137 * math.cos(math.radians(origin[1])), 2),
           round(-math.radians(lat - origin[1]) * 6378137, 2)]
          for lon, lat in feature['geometry']['coordinates'][0][:-1]]
assert Polygon(points).is_valid
geometry = [{'id': 'overture/' + identifier, 'points': points, 'precisionMetres': .01,
             'sourceIds': ['overture-snapshot'], 'sourceGeometryValid': True,
             'reason': 'The original ring is valid. Rounding local coordinates to 0.1m creates a self-intersection. Reproject this ring at 0.01m formatting precision; this does not improve survey accuracy.'}]
result = {
    'schemaVersion': 1, 'reviewedAt': '2026-09-07', 'baseSha256': hashlib.sha256(base.read_bytes()).hexdigest(),
    'origin': origin, 'license': 'ODbL-1.0', 'attribution': data['meta']['attribution'],
    'sources': [
        {'id': 'osm-snapshot', 'url': data['meta']['sources'][0]['url'],
         'snapshot': 'neiva.osm.json.gz', 'fetchedAt': data['meta']['sources'][0]['fetchedAt'],
         'latestElementEdit': data['meta']['sources'][0]['timestamp'], 'license': 'ODbL-1.0'},
        {'id': 'overture-snapshot', 'url': 'https://docs.overturemaps.org/guides/buildings/',
         'snapshot': 'neiva.overture.json.gz', 'release': overture['snapshot']['release'],
         'fetchedAt': overture['snapshot']['fetchedAt'], 'license': 'ODbL-1.0'},
        {'id': 'osm-roof-definition', 'url': 'https://wiki.openstreetmap.org/wiki/Tag:building%3Droof',
         'type': 'tag-semantics-reference', 'note': 'At least two open sides; exact remaining walls/supports are not specified by this tag.'}],
    'buildingCorrections': sorted(corrections, key=lambda b: b['id']), 'geometryCorrections': geometry,
    'counts': {'openRoofs': len(corrections), 'fuelCanopies': sum(c.get('amenity') == 'fuel' for c in corrections),
               'estimatedColumns': sum(len(c['structure']['columns']) for c in corrections), 'geometryRepairs': len(geometry)},
    'heightPolicy': 'Base height is retained and remains estimated; no new measured height or floor count is asserted.',
    'datePolicy': 'Download, edit and release dates are not survey or imagery capture dates.'}
target = ROOT / 'public/data/neiva-corrections.json'
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result['counts']))
