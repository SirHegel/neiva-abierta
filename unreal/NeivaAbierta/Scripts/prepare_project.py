#!/usr/bin/env python3
"""Validate and copy the shared open map into Unreal's staged Content/Data."""
import argparse
import json
import math
from pathlib import Path
import shutil

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
    parser.add_argument("--check", action="store_true", help="Validate without copying")
    args = parser.parse_args()
    with args.data.open(encoding="utf-8") as source:
        data = json.load(source)
    validate(data)
    if not args.check:
        destination = PROJECT / "Content/Data/neiva.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.data, destination)
        print(f"Map copied to {destination}")
    print(f"Valid map: {len(data['roads'])} roads, {len(data['buildings'])} buildings; snapshot {data['meta'].get('timestamp')}")
    holes = sum(bool(building.get("holes")) for building in data["buildings"])
    print(f"Unreal imports all buildings by default. {holes} footprints have interior rings; this importer currently renders their exterior only.")


if __name__ == "__main__":
    main()
