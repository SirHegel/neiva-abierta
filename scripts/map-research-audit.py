#!/usr/bin/env python3
"""Read-only, reproducible geographic audit. Requires shapely==2.1.2.

python3 scripts/map-research-audit.py [--output data/newaudit-geometry.json]
An intersection proves a conflict between layers, not which layer is wrong.
No source map, source archive or gameplay override is changed by this script.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re

import shapely
from shapely import LineString, Polygon, STRtree, make_valid
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as source:
        return json.load(source)


def metres(value):
    match = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(m|metres|meters|ft|feet|')?\s*", str(value), re.I)
    if not match:
        return None
    number = float(match[1].replace(',', '.')) * (0.3048 if (match[2] or '').lower() in ['ft', 'feet', "'"] else 1)
    return number if 0 < number < 1000 else None


def audit(output):
    base = ROOT / 'public/data/neiva.json'
    data = read(base)
    survey = read(ROOT / 'public/data/neiva-survey.json')
    osm = {f"{e['type']}/{e['id']}": e.get('tags', {}) for e in read(ROOT / 'public/data/neiva.osm.json.gz')['elements']}
    overture_features = read(ROOT / 'public/data/neiva.overture.json.gz')['features']
    overture = {f"overture/{f['id']}": f['properties'] for f in overture_features}
    buildings = data['buildings']
    origin = data['meta']['origin']
    excluded = {b['id'] for b in survey['excludedBuildings']}
    override = {b['id']: b for b in survey['buildingOverrides']}
    invalid = []

    def polygon(feature, kind):
        raw = Polygon(feature['points'], feature.get('holes', []))
        if not raw.is_valid:
            invalid.append({'layer': kind, 'id': feature['id'], 'reason': explain_validity(raw),
                            'auditOnlyRepair': 'GEOS make_valid; original source unchanged'})
            return make_valid(raw)
        return raw

    geometries = [polygon(b, 'buildings') for b in buildings]
    building_tree = STRtree(geometries)

    def position(index):
        center = geometries[index].centroid
        x, z = center.x, center.y
        lon = origin[0] + math.degrees(x / (6378137 * math.cos(math.radians(origin[1]))))
        lat = origin[1] - math.degrees(z / 6378137)
        return {'x': round(x, 1), 'z': round(z, 1), 'lon': round(lon, 7), 'lat': round(lat, 7)}

    def row(index):
        building = buildings[index]
        return {'id': building['id'], 'source': building.get('source', 'OpenStreetMap'),
                'areaM2': round(geometries[index].area, 2), **position(index),
                'alreadyExcludedFromGenericModel': building['id'] in excluded,
                'status': 'candidate-requires-independent-reference'}

    height_bases = Counter()
    height_sources = {}
    height_details = []
    width_bases = Counter()
    upstream_dates = {}
    for i, building in enumerate(buildings):
        source = building.get('source', 'OpenStreetMap')
        p = overture.get(building['id'].split('#')[0], {}) if source != 'OpenStreetMap' else osm.get(building['id'], {})
        height = p.get('height')
        levels = p.get('num_floors' if source != 'OpenStreetMap' else 'building:levels')
        subtype = p.get('subtype' if source != 'OpenStreetMap' else 'building', '')
        try:
            numeric_levels = float(levels)
        except (TypeError, ValueError):
            numeric_levels = 0
        if metres(height):
            basis = 'source-height-tag-unverified'
        elif 0 < numeric_levels < 100:
            basis = 'source-levels-times-3.2-estimate'
        elif subtype in ['church', 'cathedral', 'commercial', 'office', 'apartments', 'hospital', 'hotel', 'industrial', 'warehouse']:
            basis = 'game-building-subtype-default-estimate'
        else:
            basis = 'game-default-5.8m-no-source-height'
        height_bases[basis] += 1
        height_sources.setdefault(source, Counter())[basis] += 1
        if source != 'OpenStreetMap':
            for item in p.get('sources', []):
                if item.get('update_time'):
                    upstream_dates.setdefault(item['dataset'], Counter())[item['update_time']] += 1
        detail = {'id': building['id'], 'source': source, 'height': building['height'], 'basis': basis,
                  'sourceHeight': height, 'sourceLevels': levels, 'measuredHere': False}
        if building['id'] in override:
            detail['modelOverrideHeight'] = override[building['id']].get('height')
            detail['modelOverrideBasis'] = 'visual-reference-estimate-not-survey'
        height_details.append(detail)

    road_geometries = [LineString(r['points']) for r in data['roads']]
    road_tree = STRtree(road_geometries)
    road_buffers = [line.buffer(r['width'] / 2, cap_style=2, join_style=2) for line, r in zip(road_geometries, data['roads'])]
    road_candidates = []
    for r in data['roads']:
        tags = osm.get(r['id'], {})
        width_bases['source-width-tag-unverified' if metres(tags.get('width')) else 'game-lanes-or-category-estimate'] += 1
    for i, shape in enumerate(geometries):
        interior = shape.buffer(-.25)
        for j in road_tree.query(shape, predicate='intersects'):
            j = int(j)
            road = data['roads'][j]
            length = interior.intersection(road_geometries[j]).length
            ratio = shape.intersection(road_buffers[j]).area / shape.area
            if length >= 4 and ratio >= .35:
                road_candidates.append({**row(i), 'roadId': road['id'], 'roadName': road.get('name'),
                                        'roadType': road.get('type'), 'bridge': road.get('bridge', False),
                                        'tunnel': road.get('tunnel', False), 'layer': road.get('layer', 0),
                                        'interiorCenterlineM': round(length, 2), 'roadBufferAreaRatio': round(ratio, 4),
                                        'roadWidthM': road['width'], 'widthMeasuredHere': False})

    water_candidates, park_candidates = [], []
    for kind, features, candidates in [('water', data['water'], water_candidates), ('parks', data['parks'], park_candidates)]:
        for feature in features:
            linear = kind == 'water' and not feature.get('polygon')
            shape = LineString(feature['points']).buffer(feature.get('width', 4) / 2) if linear else polygon(feature, kind)
            for i in building_tree.query(shape, predicate='intersects'):
                i = int(i)
                overlap = shape.intersection(geometries[i]).area
                ratio = overlap / geometries[i].area
                if overlap >= 1 and ratio >= .1:
                    candidates.append({**row(i), 'otherId': feature['id'], 'otherName': feature.get('name'),
                                       'overlapAreaM2': round(overlap, 2), 'buildingAreaRatio': round(ratio, 4),
                                       'buildingCentroidInside': shape.covers(geometries[i].centroid),
                                       'comparisonGeometry': 'estimated-water-line-buffer' if linear else 'source-polygon'})

    overlapping_buildings = []
    for i, shape in enumerate(geometries):
        for j in building_tree.query(shape, predicate='intersects'):
            j = int(j)
            if j <= i:
                continue
            overlap = shape.intersection(geometries[j]).area
            ratio = overlap / min(shape.area, geometries[j].area)
            if overlap >= 2 and ratio >= .8:
                overlapping_buildings.append({**row(i), 'otherId': buildings[j]['id'],
                                             'otherSource': buildings[j].get('source', 'OpenStreetMap'),
                                             'overlapAreaM2': round(overlap, 2), 'smallerBuildingAreaRatio': round(ratio, 4)})

    confirmed = [
        {'id': b['id'], 'finding': 'unsupported-solid-residential-model-suppressed', 'reason': b['reason'],
         'sourceIds': b['sourceIds'], 'baseFootprintProvenFalse': False, 'correctionAlreadyApplied': True}
        for b in survey['excludedBuildings']
    ] + [
        {'id': b['id'], 'finding': 'generic-architecture-replaced-from-identified-visual-reference',
         'reason': b['reason'], 'sourceIds': b['sourceIds'], 'baseFootprintProvenFalse': False,
         'replacementHeightMeasured': False, 'correctionAlreadyApplied': True}
        for b in survey['buildingOverrides']
    ]
    open_roofs = []
    for i, building in enumerate(buildings):
        tags = osm.get(building['id'], {})
        if tags.get('building') in ['roof', 'carport']:
            open_roofs.append({**row(i), 'status': 'confirmed-source-semantics-misinterpreted',
                               'sourceBuildingType': tags['building'], 'amenity': tags.get('amenity'),
                               'sourceUrl': 'https://www.openstreetmap.org/' + building['id'],
                               'finding': 'Source roof is rendered as an enclosed generic building without an overlay.',
                               'correctionLayer': 'public/data/neiva-corrections.json',
                               'physicalDimensionsMeasured': False, 'preserveFootprint': True})
    source_geometry = {f"overture/{f['id']}": f['geometry'] for f in overture_features}
    from shapely.geometry import shape as geojson_shape
    for problem in invalid:
        if problem['id'] in source_geometry:
            problem['upstreamGeometryValid'] = geojson_shape(source_geometry[problem['id']]).is_valid
            if problem['upstreamGeometryValid']:
                problem['cause'] = 'Export coordinate projection/0.1m quantization; original source geometry is valid.'
                problem['correctionLayer'] = 'public/data/neiva-corrections.json'
    result = {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'baseSha256': hashlib.sha256(base.read_bytes()).hexdigest(),
        'sourceSurveySha256': hashlib.sha256((ROOT / 'public/data/neiva-survey.json').read_bytes()).hexdigest(),
        'units': 'local map metres, not certified ground survey', 'origin': origin,
        'engine': f'Shapely {shapely.__version__} / GEOS {shapely.geos_version_string}',
        'license': 'ODbL-1.0 for derived cartographic records; source attribution as neiva.json',
        'method': {'roads': 'Interior buffer -0.25m; centerline intersection >=4m AND road-width-buffer overlap >=35%. Bridges/tunnels flagged, not removed.',
                   'waterAndParks': 'Exact polygon intersections including holes; >=1m² AND >=10% building area. Linear water uses estimated width buffer.',
                   'buildingPairs': 'Intersection >=2m² AND >=80% of smaller building footprint.',
                   'validity': 'GEOS topology validity; invalid geometry repaired only in audit memory and reported.',
                   'scope': 'All base records; existing exclusions are flagged. No data mutation or independent citywide ground-truth comparison.'},
        'counts': {'buildings': len(buildings), 'roads': len(data['roads']), 'water': len(data['water']),
                   'parks': len(data['parks']), 'neighborhoodPointLabels': len(data['neighborhoods']),
                   'duplicateBuildingIds': len(buildings) - len({b['id'] for b in buildings}),
                   'invalidGeometry': len(invalid), 'roadCandidatePairs': len(road_candidates),
                   'waterCandidatePairs': len(water_candidates), 'parkCandidatePairs': len(park_candidates),
                   'overlappingBuildingCandidatePairs': len(overlapping_buildings),
                   'sourceOpenRoofs': len(open_roofs),
                   'confirmedNonexistentBuildings': 0, 'fieldMeasuredHeights': 0},
        'heightBasisCounts': dict(height_bases), 'heightBasisByProvider': height_sources,
        'roadWidthBasisCounts': dict(width_bases), 'upstreamRecordUpdateTimes': upstream_dates,
        'upstreamDateNote': 'Provider update_time is a record update date, not verified imagery capture or construction date.',
        'heightProvenance': height_details, 'invalidGeometry': invalid,
        'roadCandidates': sorted(road_candidates, key=lambda r: -r['roadBufferAreaRatio']),
        'waterCandidates': sorted(water_candidates, key=lambda r: -r['buildingAreaRatio']),
        'parkCandidates': sorted(park_candidates, key=lambda r: -r['buildingAreaRatio']),
        'overlappingBuildingCandidates': overlapping_buildings, 'confirmedModelCorrections': confirmed,
        'confirmedOpenRoofSemantics': open_roofs,
        'interpretation': 'Candidates are reproducible layer conflicts, not proof a physical building is false. No automatic deletion is authorized by this audit.'}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ['counts', 'heightBasisCounts', 'heightBasisByProvider', 'roadWidthBasisCounts', 'upstreamRecordUpdateTimes']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/newaudit-geometry.json')
    audit(parser.parse_args().output)
