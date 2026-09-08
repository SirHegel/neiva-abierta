#!/usr/bin/env python3
"""Prepare simulated walking routes inside the existing paved Santander polygon.

No engine, map edit, new buildings, street imagery or claim of observed pedestrian
patterns. Pure 2D clearance screening; Unreal must still test grounded capsules.
Run after prepare_project.py (the environment placement file is an input).
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parents[1]
ROUTES = {
    'santander-south': [[-892, -98], [-917, -100], [-920, -111], [-906, -120], [-894, -119], [-892, -98]],
    'santander-north': [[-929, -146], [-917, -151], [-913, -169], [-935, -170], [-938, -156], [-929, -146]],
    'santander-west': [[-961, -129], [-960, -112], [-939, -96], [-936, -112], [-961, -129]],
}


def distance_point_segment(point, start, end):
    dx, dz = end[0] - start[0], end[1] - start[1]
    norm = dx * dx + dz * dz
    t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / norm)) if norm else 0
    return math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz)


def segment_distance(a, b, c, d):
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    if cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0:
        return 0
    return min(distance_point_segment(a, c, d), distance_point_segment(b, c, d),
               distance_point_segment(c, a, b), distance_point_segment(d, a, b))


def inside(point, ring):
    x, z = point
    result = False
    for i, (ax, az) in enumerate(ring):
        bx, bz = ring[i - 1]
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            result = not result
    return result


def boundary_distance(route, polygon):
    return min(segment_distance(a, b, c, polygon[(i + 1) % len(polygon)])
               for a, b in zip(route, route[1:]) for i, c in enumerate(polygon))


def point_route_distance(route, point):
    return min(distance_point_segment(point, a, b) for a, b in zip(route, route[1:]))


def validate_route(route, park, buildings, environment, fountain, shelter):
    if (len(route) < 4 or route[0] != route[-1]
            or any(len(point) != 2 or any(type(v) not in [int, float] or not math.isfinite(v) for v in point) for point in route)
            or any(not inside(point, park) for point in route)):
        raise ValueError('Closed finite route must remain inside the mapped paved polygon')
    edge = boundary_distance(route, park)
    building_gap = math.inf
    for building in buildings:
        ring = building['points']
        if any(inside(point, ring) for point in route):
            raise ValueError('Route enters a mapped building')
        building_gap = min(building_gap, boundary_distance(route, ring))
    tree_gap = min(point_route_distance(route, [item['x'], item['z']]) for item in environment['trees'])
    bench_gap = min(point_route_distance(route, [item['x'], item['z']]) for item in environment['benches'])
    fountain_gap = point_route_distance(route, [fountain['x'], fountain['z']]) - fountain['radius'] * 1.05
    sx, sz = shelter['x'], shelter['z']
    w, d = shelter['width'] / 2, shelter['depth'] / 2
    shelter_ring = [[sx-w, sz-d], [sx+w, sz-d], [sx+w, sz+d], [sx-w, sz+d]]
    shelter_gap = boundary_distance(route, shelter_ring)
    if any(inside(point, shelter_ring) for point in route):
        raise ValueError('Route enters the interpreted shelter')
    # Conservative navigation buffers, not surveyed dimensions of furnishings.
    if min(edge, building_gap, fountain_gap, shelter_gap) < 1.5 or tree_gap < 2.5 or bench_gap < 2.5:
        raise ValueError('Route fails conservative 2D obstacle clearance')
    return {key: round(value, 3) for key, value in {
        'parkBoundaryM': edge, 'mappedBuildingM': building_gap, 'treeCenterM': tree_gap,
        'benchCenterM': bench_gap, 'fountainOuterProxyM': fountain_gap, 'shelterFootprintM': shelter_gap}.items()}


def make_population(city, survey, environment):
    feature = survey['features']['santander']
    if feature.get('id') != 'way/39365299' or feature.get('paved') is not True or survey['origin'] != city['meta']['origin']:
        raise ValueError('Santander paved source/origin is not the expected documented-reference overlay')
    park = feature['points']
    exclusions = {item['id'] for item in survey['excludedBuildings']}
    # The audited excluded house volumes represent fountain/shelter candidates;
    # their actual interpreted obstacles are checked separately above.
    xmin, zmin = min(p[0] for p in park), min(p[1] for p in park)
    xmax, zmax = max(p[0] for p in park), max(p[1] for p in park)
    buildings = [b for b in city['buildings'] if b['id'] not in exclusions
                 and max(p[0] for p in b['points']) >= xmin - 100 and min(p[0] for p in b['points']) <= xmax + 100
                 and max(p[1] for p in b['points']) >= zmin - 100 and min(p[1] for p in b['points']) <= zmax + 100]
    routes = []
    for identifier, points in ROUTES.items():
        clearance = validate_route(points, park, buildings, environment, feature['fountain'], feature['openShelter'])
        routes.append({'id': identifier, 'surfaceId': feature['id'], 'kind': 'simulated-pedestrian-route',
                       'closed': True, 'points': points, 'units': 'metres',
                       'lengthM': round(sum(math.dist(a, b) for a, b in zip(points, points[1:])), 3),
                       'distanceFromPlayerSpawnM': round(point_route_distance(points, city['meta']['spawn']), 3),
                       'clearance2D': clearance, 'sourceIds': ['osm-santander-footprint', 'municipal-paved-reference', 'interpreted-environment'],
                       'observedPedestrianPattern': False, 'unrealGroundedCapsuleVerified': False})
    return {'schemaVersion': 1, 'origin': city['meta']['origin'], 'units': 'metres', 'axes': {'x': 'east', 'z': 'south'},
            'purpose': 'Simulated nearby pedestrian circulation on the existing mapped paved park; not observed real pedestrian routes.',
            'surface': {'id': feature['id'], 'points': park, 'pavedReference': True, 'physicallySurveyed': False},
            'placementPolicy': {'capsuleRadiusM': .36, 'capsuleHalfHeightM': .92, 'lookAheadSweepRadiusM': .42,
                                'minimumParkAndStructureClearanceM': 1.5, 'minimumTreeAndBenchCenterClearanceM': 2.5,
                                'groundHeight': 'Resolve with Unreal GroundedCapsule raycast; no fixed elevation inferred from the map.',
                                'npcSeparationM': 12, 'estimatedFurnitureProxies': True},
            'sources': [
                {'id': 'osm-santander-footprint', 'url': 'https://www.openstreetmap.org/way/39365299', 'license': 'ODbL-1.0'},
                {'id': 'municipal-paved-reference', 'url': 'https://www.alcaldianeiva.gov.co/NuestraAlcaldia/SalaDePrensa/Paginas/Fuente-del-Parque-Santander-se-recupera-gracias-al-trabajo-de-la-alcald%C3%ADa-de-Neiva.aspx',
                 'publishedAt': '2024-03-12', 'role': 'Previously reviewed paving/fountain identity; no imagery copied or dimensions derived.'},
                {'id': 'interpreted-environment', 'path': 'unreal/NeivaAbierta/Content/Data/neiva-environment.json',
                 'role': 'Existing estimated tree/bench placements; conservative obstacle screening, not a municipal inventory.'}],
            'routes': routes, 'verified': {'geometry2D': True, 'groundedCapsule': False, 'runtimePopulation': False}}


def prepare(repo=REPO, *, write=True, environment=None):
    repo = Path(repo)
    inputs = ['public/data/neiva.json', 'public/data/neiva-survey.json',
              'unreal/NeivaAbierta/Content/Data/neiva-environment.json']
    raw = [(repo / path).read_bytes() for path in inputs[:2]]
    raw.append((json.dumps(environment, indent=2) + '\n').encode('utf-8') if environment is not None
               else (repo / inputs[2]).read_bytes())
    data = make_population(*(json.loads(value) for value in raw))
    data['inputHashes'] = [{'path': path, 'sha256': hashlib.sha256(value).hexdigest()} for path, value in zip(inputs, raw)]
    if write:
        encoded = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        for path in ['data/population-neiva.json', 'unreal/NeivaAbierta/Content/Data/neiva-population.json']:
            target = repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(encoded, encoding='utf-8')
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate sources and 2D clearances without writing')
    args = parser.parse_args()
    population = prepare(write=not args.check)
    print(json.dumps({'routes': len(population['routes']), 'verified2D': True, 'groundedCapsuleVerified': False,
                      'minimumClearances': {key: min(route['clearance2D'][key] for route in population['routes'])
                                             for key in population['routes'][0]['clearance2D']}}, ensure_ascii=False))
