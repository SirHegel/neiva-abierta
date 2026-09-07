"""Pure Python local-art contract. No Unreal or network required.
O(B + N) time for N files/B hashed bytes; O(N) output, O(1) hash buffer.
Invariant: all sources exist inside public/, all assets use /Game/NeivaAssets.
"""
import argparse
import hashlib
import json
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parents[1]
ROOT = "/Game/NeivaAssets"
SURFACES = {"M_Road": "asphalt", "M_Pavement": "pavement", "M_Facade": "plaster",
            "M_Brick": "brick", "M_Roof": "roof", "M_Ground": "ground", "M_Grass": "ground"}


def local_source(repo, relative):
    public = (repo / "public").resolve()
    source = (repo / relative).resolve()
    if not source.is_relative_to(public):
        raise ValueError(f"Source must remain inside public/: {relative}")
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError(f"Missing or empty art source: {relative}")
    return source


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def build_plan(repo=REPO):
    repo = Path(repo)
    manifest = json.loads((repo / "public/textures/manifest.json").read_text(encoding="utf-8"))
    textures = {asset["key"]: asset for asset in manifest["assets"]}
    records = {record["path"]: record for record in manifest["files"]}
    materials, checked = [], set()
    for name, key in SURFACES.items():
        asset = textures[key]
        tile = asset["tileMeters"]
        if len(tile) != 2 or any(not isinstance(v, (int, float)) or not 0 < v < 1000 for v in tile):
            raise ValueError(f"Invalid physical texture scale: {key}")
        maps = {}
        for channel in ("color", "normal", "arm"):
            filename = asset.get("sourceMaps", asset["maps"])[channel]
            path = local_source(repo, "public/textures/" + filename)
            if filename not in checked:
                if sha256(path) != records[filename]["sha256"]:
                    raise ValueError(f"Texture checksum mismatch: {filename}")
                checked.add(filename)
            maps[channel] = str(path)
        materials.append({"name": name, "key": key, "maps": maps, "tileMeters": tile,
                          "normalOpenGL": True, "destination": ROOT + "/Materials/" + name})
    # Generated facade photographs are explicitly representative, not a city survey.
    facades = [("M_Facade", "neiva-residential.png", [16, 6.4]),
               ("M_UpperFacade", "neiva-upper.png", [9.6, 6.4])]
    for name, filename, tile in facades:
        source = repo / "public/facades" / filename
        if source.is_file():
            source = local_source(repo, "public/facades/" + filename)
            plaster = next(item for item in materials if item["name"] == "M_Facade")
            spec = {**plaster, "name": name, "maps": {**plaster["maps"], "color": str(source)},
                    "tileMeters": tile, "destination": ROOT + "/Materials/" + name}
            materials = [item for item in materials if item["name"] != name] + [spec]
    models = [
        {"kind": "skeletal", "name": "SK_Character", "folder": "Character",
         "source": "public/models/character/character.fbx"},
        {"kind": "static", "name": "SM_Car", "folder": "Car", "source": "public/models/car/car.glb"},
        {"kind": "animation", "name": "AN_Idle", "folder": "Character", "source": "public/models/character/idle.fbx"},
        {"kind": "animation", "name": "AN_Walk", "folder": "Character", "source": "public/models/character/walk.fbx"},
    ]
    for model in models:
        source = local_source(repo, model["source"])
        with source.open("rb") as stream:
            signature = stream.read(32)
        if source.suffix.lower() == ".glb" and signature[:4] != b"glTF":
            raise ValueError(f"Expected binary glTF: {source}")
        if source.suffix.lower() == ".fbx" and not (signature.startswith(b"Kaydara FBX Binary") or b"FBX" in signature):
            raise ValueError(f"Expected FBX: {source}")
        model["source"] = str(source)
        model["destination"] = ROOT + "/Models/" + model["folder"] + "/" + model["name"]
    character_textures = {}
    for part in ("body", "head"):
        character_textures[part] = {channel: str(local_source(repo,
            f"public/models/character/m002_{part}_{channel}.jpg")) for channel in ("color", "normal")}
    character_textures["opacity"] = {"color": str(local_source(repo, "public/models/character/m002_opacity_color.png"))}
    environment = textures["environment"]
    hdr = local_source(repo, "public/textures/" + environment.get("sourceMaps", environment["maps"])["hdr"])
    if sha256(hdr) != records[hdr.name]["sha256"]:
        raise ValueError("HDR checksum mismatch")
    return {"root": ROOT, "materials": materials, "models": models,
            "characterTextures": character_textures, "environment": str(hdr)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate only (always read-only)")
    parser.add_argument("--json", action="store_true", help="Print resolved import plan")
    args = parser.parse_args()
    plan = build_plan()
    print(json.dumps(plan, indent=2) if args.json else
          f"Art sources valid: {len(plan['materials'])} PBR materials, {len(plan['models'])} model/animation imports, HDR and character textures. Unreal execution not verified.")
