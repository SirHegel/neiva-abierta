#!/usr/bin/env python3
"""Validate and copy the shared open map into Unreal's staged Content/Data."""
import argparse
import json
import math
from pathlib import Path
import shutil
from stage_map import stage_map, validate_landmarks
from prepare_environment import prepare as prepare_environment
from prepare_population import prepare as prepare_population

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parents[1]


def validate(data):
    if data.get("meta", {}).get("schemaVersion") != 1:
        raise ValueError("Expected map schemaVersion 1")
    if data["meta"].get("units") != "metres":
        raise ValueError("Expected coordinates in metres")
    if data["meta"].get("axes") != {"x": "east", "z": "south"}:
        raise ValueError("Expected east/south map axes")
    for collection in ("roads", "buildings", "water", "parks"):
        if not isinstance(data.get(collection), list):
            raise ValueError(f"Missing array: {collection}")
        for item in data[collection]:
            points = item.get("points", [])
            if len(points) < 2:
                raise ValueError(f"Missing points: {collection}/{item.get('id')}")
            for point in points:
                if len(point) != 2 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in point):
                    raise ValueError(f"Invalid coordinate in {collection}/{item.get('id')}")
            for hole in item.get("holes", []):
                if len(hole) < 3 or any(len(point) != 2 or not all(math.isfinite(n) for n in point) for point in hole):
                    raise ValueError(f"Invalid interior ring in {collection}/{item.get('id')}")
            if collection == "buildings":
                height = item.get("height")
                if not isinstance(height, (int, float)) or not math.isfinite(height) or height <= 0:
                    raise ValueError(f"Invalid building height: {item.get('id')}")
    for key in ("spawn", "car", "studio"):
        point = data["meta"].get(key)
        if not isinstance(point, list) or len(point) != 2 or not all(math.isfinite(n) for n in point):
            raise ValueError(f"Missing gameplay anchor meta.{key}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=REPO / "public/data/neiva.json")
    parser.add_argument("--landmarks", type=Path, default=PROJECT / "SourceArt/landmarks/neiva-landmarks.json")
    parser.add_argument("--check", action="store_true", help="Validate without copying")
    args = parser.parse_args()
    with args.data.open(encoding="utf-8") as source:
        data = json.load(source)
    validate(data)
    data = stage_map(data, REPO)
    validate(data)
    landmarks = json.loads(args.landmarks.read_text(encoding="utf-8"))
    validate_landmarks(landmarks, data)
    if args.check:
        environment = prepare_environment(write=False)
        prepare_population(write=False, environment=environment)
    if not args.check:
        destination = PROJECT / "Content/Data/neiva.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        shutil.copyfile(args.landmarks, destination.with_name("neiva-landmarks.json"))
        environment = prepare_environment()
        population = prepare_population(environment=environment)
        print(f"Population staged: {len(population['routes'])} simulated routes; 2D clearance checked, Unreal capsules still require validation.")
        licenses = destination.parent / "Licenses"
        height_receipt = REPO / "data/heights-google-temporal-manifest.json"
        if data['meta'].get('heightSupplement'):
            licenses.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(height_receipt, licenses / 'open-buildings-temporal-manifest.json')
            (destination.parent / 'neiva-height-staging.json').write_text(
                json.dumps(data['meta']['heightSupplement'], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if data['meta'].get('manualHeightReviews'):
            shutil.copyfile(REPO / 'data/manual-height-reviews.json', licenses / 'manual-height-reviews.json')
        for relative in ("LICENSE", "public/models/ATTRIBUTION.txt", "public/models/sources.json",
                         "public/models/character/LICENSE-ROCKETBOX.txt", "public/models/car/LICENSE-CAR.txt",
                         "public/models/car/LICENSE-KHRONOS-MARKS.txt", "public/textures/manifest.json"):
            source = REPO / relative
            target = licenses / relative.removeprefix("public/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        for filename in ("manifest.json", "README.md"):
            target = licenses / "visual" / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(PROJECT / "SourceArt/visual" / filename, target)
        (licenses / "NATIVE-NOTES.txt").write_text(
            "Neiva Abierta / native Unreal source preparation. Original game code MIT; Unreal Engine licensed separately.\n"
            "OpenStreetMap/Overture: ODbL. See neiva.json meta.sources, survey and corrections for sources and estimates.\n"
            "Height supplement: Google Research Open Buildings 2.5D Temporal V1, 2023 ML estimates, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Contains modified Copernicus Sentinel-2 data.\n"
            "Height modifications: footprint-masked medians; preserve source-declared heights except separately documented manual-height-reviews.json; protect landmarks/roofs; never certified measurements. Combined cartographic database remains ODbL.\n"
            "Car Concept: Eric Chadwick / Darmstadt Graphics Group GmbH, 2024, CC BY 4.0; Khronos marks licensed separately.\n"
            "Native car changes: combined static hierarchy, scale normalization; wheels remain fixed to this imported mesh.\n"
            "Microsoft Rocketbox: MIT. Native character changes: scale, root lock, PBR and audited cloth-only tint mask.\n"
            "Poly Haven texture originals: CC0. Landmark geometry: interpreted cartographic derivative, ODbL, not photogrammetry.\n",
            encoding="utf-8")
        print(f"Reviewed map and detailed landmarks staged in {destination.parent}")
    print(f"Valid map: {len(data['roads'])} roads, {len(data['buildings'])} buildings; snapshot {data['meta'].get('timestamp')}")
    if data['meta'].get('heightSupplement'):
        action = 'validated in memory' if args.check else 'staged'
        print(f"Height supplement {action}: {data['meta']['heightSupplement']['appliedCount']} estimated heights; 0 confirmed physical measurements.")
    if data['meta'].get('manualHeightReviews'):
        review = data['meta']['manualHeightReviews']
        print(f"Manual height reviews: {review['appliedCount']} estimated; combined raster total {review['combinedRasterAppliedCount']}. Original source tags preserved; 0 confirmed measurements.")
    holes = sum(bool(building.get("holes")) for building in data["buildings"])
    print(f"Unreal imports all buildings by default. {holes} footprints have interior rings; this importer currently renders their exterior only.")
    print(f"Detailed landmarks: {len(landmarks['meshes'])} mesh sections; {len(landmarks['replacesBuildingIds'])} mapped buildings replaced after runtime validation.")


if __name__ == "__main__":
    main()
