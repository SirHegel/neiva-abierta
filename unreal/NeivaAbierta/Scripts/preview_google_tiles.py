"""Unreal Editor preview of licensed Google tiles, using a process-environment key.

This script does NOT save the level or download an offline copy of Google data.
It connects to the API only when deliberately run with a configured key.
Run clear_google_preview.py before saving any map. See docs/UNREAL.md.
"""
import json
import os
from pathlib import Path
from urllib.parse import quote
import unreal

key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
if not key:
    raise RuntimeError("Set GOOGLE_MAPS_API_KEY in the editor process environment first.")
geo_class = unreal.load_class(None, "/Script/CesiumRuntime.CesiumGeoreference")
tiles_class = unreal.load_class(None, "/Script/CesiumRuntime.Cesium3DTileset")
if not geo_class or not tiles_class:
    raise RuntimeError("Install Cesium for Unreal, run enable_cesium.py and restart Unreal Editor.")

data_path = Path(unreal.Paths.project_content_dir()) / "Data/neiva.json"
meta = json.loads(data_path.read_text(encoding="utf-8"))["meta"]
longitude, latitude = meta["origin"]
# Ellipsoid height must be calibrated against streamed local terrain before walking.
height = float(os.environ.get("NEIVA_ELLIPSOID_HEIGHT", "442"))
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
tag = unreal.Name("NeivaGoogleTemporaryPreview")
for actor in actors.get_all_level_actors():
    if tag in actor.tags:
        actors.destroy_actor(actor)

geo = actors.spawn_actor_from_class(geo_class, unreal.Vector(0, 0, 0))
geo.set_actor_label("Neiva / Google preview georeference")
geo.set_editor_property("tags", [tag])
geo.set_origin_longitude_latitude_height(unreal.Vector(longitude, latitude, height))
tiles = actors.spawn_actor_from_class(tiles_class, unreal.Vector(0, 0, 0))
tiles.set_actor_label("Neiva / Google 3D temporary preview - DO NOT SAVE")
tiles.set_editor_property("tags", [tag])
tiles.set_georeference(geo)
tiles.set_tileset_source(unreal.TilesetSource.FROM_URL)
tiles.set_editor_property("show_credits_on_screen", True)
tiles.set_create_physics_meshes(True)
tiles.set_url("https://tile.googleapis.com/v1/3dtiles/root.json?key=" + quote(key, safe=""))
unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).set_level_viewport_camera_info(
    unreal.Vector(0, 0, 120000), unreal.Rotator(-65, 0, 0)
)
unreal.log("Google preview connected. Coverage in Neiva is unverified. Credits remain enabled. Do not save this preview; run clear_google_preview.py first.")
