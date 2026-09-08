"""Deterministic, engine-independent conversion for the offline landmark bake.

No geometry is simplified, moved, clipped or invented. Dense, disconnected
detail sections are partitioned by triangle centroid; long structural triangles
remain intact. The resulting bounds, including exceptions, are reported.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path

VERSION = 1
PROJECT = Path(__file__).resolve().parents[1]
TEXTURED = {"brick", "plaster", "roof", "pavement"}


def convert(vector, scale=1):
    return [vector[0] * scale, -vector[2] * scale, vector[1] * scale]


def load_source(project=PROJECT):
    from stage_map import validate_landmarks
    source = project / "Content/Data/neiva-landmarks.json"
    raw = source.read_bytes()
    data = json.loads(raw)
    map_data = json.loads((project / "Content/Data/neiva.json").read_bytes())
    validate_landmarks(data, map_data)
    return data, raw


def mesh_chunks(mesh, mesh_index, cell_m=25):
    """Group whole triangles only, then rebase each buffer to a local pivot."""
    if not math.isfinite(cell_m) or not 5 <= cell_m <= 200:
        raise ValueError("cell_m must be finite and between 5 and 200 metres")
    points = list(zip(*[iter(mesh["positions"])] * 3))
    triangles = list(zip(*[iter(mesh["indices"])] * 3))
    span = max(max(p[a] for p in points) - min(p[a] for p in points) for a in (0, 2))
    split = len(triangles) > 512 and span > cell_m * 1.5
    buckets = defaultdict(list)
    for ti, triangle in enumerate(triangles):
        key = tuple(math.floor(sum(points[v][a] for v in triangle) / (3 * cell_m))
                    for a in (0, 2)) if split else (0, 0)
        buckets[key].append(ti)
    for part_index, (cell, source_triangles) in enumerate(sorted(buckets.items())):
        vertex_ids = sorted({v for ti in source_triangles for v in triangles[ti]})
        selected = [points[v] for v in vertex_ids]
        minimum = [min(p[a] for p in selected) for a in range(3)]
        maximum = [max(p[a] for p in selected) for a in range(3)]
        # A common centimetre grid avoids independent floating-point origin drift.
        pivot = [round((a + b) * 50) for a, b in zip(minimum, maximum)]
        pivot_ue = convert(pivot)
        remap = {v: i for i, v in enumerate(vertex_ids)}
        indices = [(remap[triangles[t][0]], remap[triangles[t][2]], remap[triangles[t][1]])
                   for t in source_triangles]
        tile_u, tile_v = mesh.get("uvTileMeters") or [1, 1]
        normals, positions, uv = [], [], []
        for v in vertex_ids:
            world = convert(points[v], 100)
            positions.append([world[a] - pivot_ue[a] for a in range(3)])
            n = convert(mesh["normals"][3*v:3*v+3])
            length = math.sqrt(sum(c*c for c in n))
            if length < 1e-8:
                raise ValueError("Authored landmark normal is zero")
            normals.append([c / length for c in n])
            uv.append([mesh["uv"][2*v] / tile_u, 1 - mesh["uv"][2*v+1] / tile_v])
        yield {
            "name": f"SM_Landmark_{mesh_index:02d}_{part_index:03d}",
            "sourceMesh": mesh_index, "sourceTriangles": source_triangles,
            "sourceVertexIds": vertex_ids, "buildingId": mesh.get("buildingId"),
            "cell": list(cell), "pivotCm": pivot_ue,
            "boundsMetres": {"min": minimum, "max": maximum},
            "spanMetres": max(b-a for a, b in zip(minimum, maximum)),
            "positions": positions, "normals": normals, "uv": uv,
            "triangles": indices, "color": mesh["color"] + [1],
            "materialKey": mesh["material"],
            "parentMaterial": "/Game/NeivaAssets/Materials/" + (
                "M_Landmark_" + mesh["material"] if mesh["material"] in TEXTURED else "M_LandmarkSolid"),
            "roughness": max(.04, min(1, mesh.get("roughness", .8))),
            "metalness": max(0, min(1, mesh.get("metalness", 0))),
            "collision": mesh["material"] != "water",
        }


def make_plan(data, raw, cell_m=25):
    cell_m = float(cell_m)
    source_sha = hashlib.sha256(raw).hexdigest()
    config = {"version": VERSION, "cellMetres": cell_m, "sourceSha256": source_sha}
    bake_id = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    root = f"/Game/NeivaAssets/BakedLandmarks/Bake_{bake_id}"
    parts = []
    for index, mesh in enumerate(data["meshes"]):
        for part in mesh_chunks(mesh, index, cell_m):
            parts.append({key: value for key, value in part.items() if key not in {
                "positions", "normals", "uv", "triangles", "sourceTriangles", "sourceVertexIds"}} |
                {"asset": root + "/" + part["name"], "triangleCount": len(part["triangles"]),
                 "vertexCount": len(part["positions"]), "nanite": part["materialKey"] != "water"})
    total = sum(part["triangleCount"] for part in parts)
    if total != data["counts"]["triangles"]:
        raise ValueError("Bake partitions did not preserve every source triangle")
    return {"schemaVersion": 1, "bakeVersion": VERSION, "bakeId": bake_id,
            "sourceSha256": source_sha, "sourceSha1": hashlib.sha1(raw).hexdigest(),
            "sourceBytes": len(raw), "origin": data["origin"], "units": "centimetres",
            "assetRoot": root, "cellMetres": cell_m, "complete": False,
            "sourceMeshCount": len(data["meshes"]), "triangleCount": total,
            "replacesBuildingIds": data["replacesBuildingIds"],
            "textLabels": data.get("textLabels", []), "parts": parts,
            "limits": ["Source facades are interpretations, not a scan.",
                       "Whole triangles are retained: large walls and roofs can exceed the cell size.",
                       "Open surfaces need two-sided distance fields; these are approximate.",
                       "Nanite/DF resources, visual appearance and collision require actual editor/game validation."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=PROJECT)
    parser.add_argument("--cell-metres", type=float, default=25)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data, raw = load_source(args.project)
    plan = make_plan(data, raw, args.cell_metres)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as output:
        json.dump(plan, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(json.dumps({"output": str(args.output), "parts": len(plan["parts"]),
                      "triangles": plan["triangleCount"], "engineExecuted": False}))


if __name__ == "__main__":
    main()
