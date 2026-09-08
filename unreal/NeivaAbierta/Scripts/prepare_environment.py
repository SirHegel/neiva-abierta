"""Stage interpreted park placements; coordinates in metres, not a tree survey."""
import hashlib
import json
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parents[1]


def prepare():
    source = REPO / 'public/data/neiva-survey.json'
    raw = source.read_bytes()
    survey = json.loads(raw)
    tree_points = survey['features']['santander']['interiorTreeLocations']
    trees = [{'x': x, 'z': z, 'heightM': round(size * 7.4, 2), 'groundM': .25,
              'yaw': (index * 137.508) % 360} for index, (x, z, size) in enumerate(tree_points)]
    # Existing courthouse reference positions. Species and dimensions are art
    # approximations; the CC0 Jacaranda is not a scan of an individual local tree.
    trees += [{'x': x, 'z': z, 'heightM': height, 'groundM': .25, 'yaw': yaw}
              for x, z, height, yaw in [(-946, -30, 8.3, 40), (-937, -11, 8.9, 120), (-928, 7, 8.2, 245)]]
    benches = [{'x': x, 'z': z, 'heightM': .95, 'groundM': .25, 'yaw': yaw}
               for x, z, yaw in [(-941, -124, 110), (-932, -109, 20), (-919, -125, 290),
                                 (-926, -137, 200), (-918, -90, 20), (-874, -112, 110)]]
    data = {'schemaVersion': 1, 'origin': survey['origin'], 'units': 'metres',
            'axes': 'x east, z south; yaw degrees around Unreal Z',
            'source': 'public/data/neiva-survey.json', 'sourceSha256': hashlib.sha256(raw).hexdigest(),
            'individuallySurveyed': False, 'speciesVerified': False,
            'note': 'Park canopy interpretation. Tree species/heights and all bench placements are estimates, not a copy of a surveyed streetscape.',
            'trees': trees, 'benches': benches}
    destination = PROJECT / 'Content/Data/neiva-environment.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    print(f'Environment staged: {len(trees)} trees, {len(benches)} benches; estimates explicitly labelled')
    return data


if __name__ == '__main__':
    prepare()
