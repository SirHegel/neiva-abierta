"""UE 5.5 Editor import of audited Poly Haven art; no downloads or map edits.

Outside Unreal: python3 import_visual_assets.py --prepare-only
Inside Editor: -ExecutePythonScript=/absolute/path/import_visual_assets.py
NEIVA_VISUAL_ASSET_DIR overrides the source folder; NEIVA_REIMPORT_ASSETS=1
explicitly refreshes meshes. See import_visual_assets.md before first execution.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import itertools
import json
import math
import mmap
import os
from pathlib import Path
import struct
import sys

SCRIPTS = Path(__file__).resolve().parent
ASSET_ROOT = SCRIPTS.parents[2] / "artifacts/visual-upgrade/assets"
CONTENT_ROOT = "/Game/NeivaAssets/Visual"
BENCH_NODES = frozenset(("crossbar", "legs_double", "legs_single", "suspended_support_01",
    "back_support_r", "back_support_l", "arm_rest_01", "arm_rest_02", "seat", "seat_back"))
SPECS = {
    "jacaranda_tree": ("SM_Jacaranda", ("branches", "trunk", "leaves")),
    "modular_street_seating": ("SM_StreetBench", ("armrests", "supports", "timber")),
}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def checked_path(folder, relative):
    path = (folder / relative).resolve()
    if not path.is_relative_to(folder.resolve()) or not path.is_file():
        raise ValueError(f"Missing or nonlocal source: {relative}")
    return path


def verify_sources(folder):
    manifest = json.loads((folder / "manifest.json").read_text())
    if manifest.get("assetId") != folder.name or manifest.get("license") != "CC0-1.0":
        raise ValueError(f"Unexpected identity/license in {folder.name}")
    files = manifest.get("files", [])
    if not files or len({f["path"] for f in files}) != len(files):
        raise ValueError("Empty or duplicate source inventory")
    for item in files:
        path = checked_path(folder, item["path"])
        if path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:
            raise ValueError(f"Source integrity mismatch: {path.name}")
    return manifest


def positions(document, folder, primitive):
    """Read original indexed mesh positions without expanding triangles or numpy."""
    accessor = document["accessors"][primitive["attributes"]["POSITION"]]
    if accessor["componentType"] != 5126 or accessor["type"] != "VEC3" or "sparse" in accessor:
        raise ValueError("Expected dense FLOAT VEC3 positions")
    view = document["bufferViews"][accessor["bufferView"]]
    path = checked_path(folder, document["buffers"][view["buffer"]]["uri"])
    stride = view.get("byteStride", 12)
    offset = accessor.get("byteOffset", 0)
    end = offset + (accessor["count"] - 1) * stride + 12
    if stride < 12 or end > view["byteLength"] or view.get("byteOffset", 0) + view["byteLength"] > path.stat().st_size:
        raise ValueError("Position accessor exceeds its buffer")
    with path.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        for index in range(accessor["count"]):
            point = struct.unpack_from("<3f", data, view.get("byteOffset", 0) + offset + index * stride)
            if not all(math.isfinite(value) for value in point):
                raise ValueError("Nonfinite source position")
            yield point


def transform(point, node):
    if "matrix" in node or node.get("children"):
        raise ValueError("Source hierarchy changed; review transforms before import")
    x, y, z, w = node.get("rotation", (0, 0, 0, 1))
    matrix = ((1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w),
              (2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w),
              (2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y))
    scaled = [a*b for a, b in zip(point, node.get("scale", (1, 1, 1)))]
    return [sum(a*b for a, b in zip(row, scaled)) + shift
            for row, shift in zip(matrix, node.get("translation", (0, 0, 0)))]


def scene_bounds(document, nodes):
    points = []
    for node in nodes:
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            position = document["accessors"][primitive["attributes"]["POSITION"]]
            points.extend(transform(corner, node) for corner in itertools.product(*zip(position["min"], position["max"])))
    return [min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]


def material_family(asset_id, source_name):
    matches = [family for family in SPECS[asset_id][1]
               if source_name == asset_id + "_" + family or source_name.startswith(asset_id + "_" + family + ".")]
    if len(matches) != 1:
        raise ValueError(f"Unrecognized material: {source_name}")
    return matches[0]


def prepare_asset(folder):
    manifest = verify_sources(folder)
    asset_id = folder.name
    mesh_name, families = SPECS[asset_id]
    source = checked_path(folder, asset_id + "_2k.gltf")
    original = json.loads(source.read_text())
    recorded = {item["path"] for item in manifest["files"]}
    for resource in original.get("buffers", []) + original.get("images", []):
        if resource["uri"] not in recorded:
            raise ValueError(f"Unverified glTF dependency: {resource['uri']}")
        checked_path(folder, resource["uri"])
    if asset_id == "jacaranda_tree":
        if len(original["nodes"]) != 1 or original["nodes"][0]["name"] != "jacaranda_tree_LOD0":
            raise ValueError("Tree hierarchy changed")
        nodes = copy.deepcopy(original["nodes"])
    else:
        names = [node["name"] for node in original["nodes"]]
        if any(names.count(name) != 1 for name in BENCH_NODES):
            raise ValueError("Bench assembly is missing or duplicates a required part")
        nodes = [copy.deepcopy(node) for node in original["nodes"] if node["name"] in BENCH_NODES]
    low, high = scene_bounds(original, nodes)
    offset = [0, -low[1], 0] if asset_id == "jacaranda_tree" else [-(low[0]+high[0])/2, -low[1], -(low[2]+high[2])/2]
    # Drop unselected meshes, not just scene nodes: Interchange translates all meshes.
    result = copy.deepcopy(original)
    result["meshes"] = []
    result["materials"] = []
    material_indices = {}
    triangles = 0
    for node in nodes:
        mesh = copy.deepcopy(original["meshes"][node["mesh"]])
        node["mesh"] = len(result["meshes"])
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError("Expected indexed triangle geometry")
            indices = original["accessors"][primitive["indices"]]
            if indices["count"] % 3:
                raise ValueError("Incomplete triangle")
            triangles += indices["count"] // 3
            material = original["materials"][primitive["material"]]
            family = material_family(asset_id, material["name"])
            if family not in material_indices:
                material_indices[family] = len(result["materials"])
                # Only slot identifiers are needed; UE receives explicit PBR materials.
                result["materials"].append({"name": f"M_Visual_{asset_id}_{family}"})
            primitive["material"] = material_indices[family]
        result["meshes"].append(mesh)
    result["nodes"] = nodes + [{"name": mesh_name + "_Origin", "translation": offset,
                                  "children": list(range(len(nodes)))}]
    result["scenes"] = [{"name": mesh_name, "nodes": [len(nodes)]}]
    result["scene"] = 0
    # No unused imported textures/materials or alternate kit pieces are emitted.
    for key in ("images", "textures", "samplers", "extensionsUsed", "extensionsRequired"):
        result.pop(key, None)
    output = folder / (mesh_name + "_UE.gltf")
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    maps = {}
    for family in material_indices:
        maps[family] = {kind: str(checked_path(folder, f"textures/{asset_id}_{family}_{suffix}_2k.jpg"))
                        for kind, suffix in (("color", "diff"), ("normal", "nor_gl"), ("arm", "arm"))}
    collision = []
    if asset_id == "jacaranda_tree":
        trunk = next(p for p in original["meshes"][0]["primitives"]
                     if original["materials"][p["material"]]["name"] == "jacaranda_tree_trunk")
        # Conservative three short trunk volumes; no hull is fitted to foliage.
        samples = [[], [], []]
        for x, y, z in positions(original, folder, trunk):
            height = y + offset[1]
            if .15 <= height <= 2.85:
                samples[min(2, int((height - .15) / .9))].append((x, z))
        for index, section in enumerate(samples):
            if not section:
                raise ValueError("Cannot fit collision to the lower trunk")
            center = [(min(p[i] for p in section) + max(p[i] for p in section))/2 for i in (0, 1)]
            radius = max(math.hypot(x-center[0], z-center[1]) for x, z in section)
            collision.append({"baseCm": [center[0]*100, center[1]*100, index*90],
                              "radiusCm": radius*100, "heightCm": 100})
    return {"assetId": asset_id, "name": mesh_name, "source": str(output),
            "sourceSha256": sha256(source), "preparedSha256": sha256(output),
            "sourceManifest": str(folder / "manifest.json"),
            "destination": CONTENT_ROOT + "/Models/" + mesh_name,
            "triangles": triangles, "nodeNames": [n["name"] for n in nodes],
            "dimensionsCm": [(high[i]-low[i])*100 for i in (0, 2, 1)],
            "originOffsetGltfMeters": offset, "materialMaps": maps,
            "collisionTrunkSections": collision,
            "alpha": str(checked_path(folder, "textures/jacaranda_tree_leaves_alpha_2k.png")) if collision else None}


def prepare(base):
    plan = {"schemaVersion": 1, "preparedAtUtc": datetime.now(timezone.utc).isoformat(),
            "engineImportPassed": False, "models": [prepare_asset(base / key) for key in SPECS]}
    (base / "unreal-visual-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    return plan


def load_helpers():
    # Isolated module namespace: bootstrap's guarded main is never called.
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location("_neiva_visual_bootstrap", SCRIPTS / "bootstrap_editor.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = CONTENT_ROOT
    def force_save(asset):
        if asset is None:
            raise RuntimeError("Cannot save an empty visual asset")
        asset.modify(True)
        if not module.editor.save_loaded_asset(asset, only_if_is_dirty=False):
            raise RuntimeError(f"Cannot persist visual asset: {asset.get_path_name()}")
    module.save_asset = force_save
    return module


def make_material(helper, record, family):
    u = helper.unreal
    material = helper.pbr_material(f"M_Visual_{record['assetId']}_{family}", record["materialMaps"][family])
    material.modify(True)
    material.set_editor_property("used_with_nanite", True)
    material.set_editor_property("used_with_instanced_static_meshes", True)
    if family == "leaves":
        material.set_editor_property("blend_mode", u.BlendMode.BLEND_MASKED)
        material.set_editor_property("two_sided", True)
        material.set_editor_property("shading_model", u.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
        material.set_editor_property("opacity_mask_clip_value", .45)
        texture = helper.import_texture(record["alpha"], "mask")
        texture.set_editor_property("do_scale_mips_for_alpha_coverage", True)
        texture.set_editor_property("alpha_coverage_thresholds", u.Vector4(.45, 0, 0, 0))
        helper.save_asset(texture)
        sample = helper.expression(material, u.MaterialExpressionTextureSampleParameter2D, -500, 950)
        sample.set_editor_property("parameter_name", "LeafMask")
        sample.set_editor_property("texture", texture)
        sample.set_editor_property("sampler_type", u.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        helper.property_link(sample, "R", u.MaterialProperty.MP_OPACITY_MASK)
        # Modest green transmission rather than flat opaque leaf cards.
        tint = helper.expression(material, u.MaterialExpressionConstant3Vector, -250, 1200)
        tint.set_editor_property("constant", u.LinearColor(.12, .22, .055, 1))
        helper.property_link(tint, "", u.MaterialProperty.MP_SUBSURFACE_COLOR)
    helper.library.recompile_material(material)
    helper.save_asset(material)
    return material


def import_mesh(helper, record):
    u, destination = helper.unreal, record["destination"]
    current = u.load_asset(destination) if helper.editor.does_asset_exist(destination) else None
    if current is not None and not isinstance(current, u.StaticMesh):
        raise RuntimeError(f"Another asset type owns {destination}")
    if current is not None and not helper.REIMPORT:
        previous = helper.editor.get_metadata_tag(current, "NeivaVisualPreparedSHA256")
        if previous != record["preparedSha256"]:
            raise RuntimeError(f"Mesh provenance changed at {destination}; use NEIVA_REIMPORT_ASSETS=1 after review")
        return current
    pipeline = u.InterchangeGenericAssetsPipeline()
    pipeline.set_editor_property("asset_name", record["name"])
    common = pipeline.get_editor_property("common_meshes_properties")
    for key, value in {"bake_meshes": True, "recompute_normals": False, "recompute_tangents": True}.items():
        common.set_editor_property(key, value)
    mesh = pipeline.get_editor_property("mesh_pipeline")
    for key, value in {"combine_static_meshes": True, "import_static_meshes": True,
                       "import_skeletal_meshes": False, "collision": False, "build_nanite": False,
                       "generate_lightmap_u_vs": False}.items():
        mesh.set_editor_property(key, value)
    material = pipeline.get_editor_property("material_pipeline")
    material.set_editor_property("import_materials", False)
    material.get_editor_property("texture_pipeline").set_editor_property("import_textures", False)
    params = u.ImportAssetParameters()
    for key, value in {"is_automated": True, "replace_existing": helper.REIMPORT,
                       "destination_name": record["name"],
                       "override_pipelines": [u.SoftObjectPath(pipeline.get_path_name())]}.items():
        params.set_editor_property(key, value)
    if current is not None:
        params.set_editor_property("reimport_asset", current)
    manager = u.InterchangeManager.get_interchange_manager_scripted()
    result = manager.import_asset(destination.rsplit("/", 1)[0],
                                  u.InterchangeManager.create_source_data(record["source"]), params)
    return helper.canonical_asset(result, u.StaticMesh, destination)


def apply_mesh(helper, mesh, record, materials):
    u = helper.unreal
    mesh.modify(True)
    slots = mesh.get_editor_property("static_materials")
    assigned = []
    for index, slot in enumerate(slots):
        label = str(slot.get_editor_property("imported_material_slot_name"))
        names = [family for family in materials if label == f"M_Visual_{record['assetId']}_{family}"]
        if len(names) != 1:
            raise RuntimeError(f"Unrecognized imported slot {label}; refusing arbitrary assignment")
        material = materials[names[0]]
        mesh.set_material(index, material)  # UE struct-array copies do not persist edits.
        if mesh.get_material(index) != material:
            raise RuntimeError(f"Material assignment did not persist: {label}")
        assigned.append(material.get_path_name())
    if not slots or set(assigned) != {material.get_path_name() for material in materials.values()}:
        raise RuntimeError("Missing imported material sections")
    subsystem = u.get_editor_subsystem(u.StaticMeshEditorSubsystem)
    if record["collisionTrunkSections"]:
        if not hasattr(u, "GeometryScript_Primitives"):
            raise RuntimeError("Enable the installed GeometryScripting Editor plugin for trunk collision")
        dynamic = u.DynamicMesh()
        for section in record["collisionTrunkSections"]:
            u.GeometryScript_Primitives.append_cylinder(dynamic, u.GeometryScriptPrimitiveOptions(),
                u.Transform(location=u.Vector(*section["baseCm"])), radius=section["radiusCm"],
                height=section["heightCm"], radial_steps=12)
        options = u.GeometryScriptCollisionFromMeshOptions()
        options.set_editor_property("method", u.GeometryScriptCollisionGenerationMethod.CONVEX_HULLS)
        options.set_editor_property("emit_transaction", False)
        u.GeometryScript_Collision.set_static_mesh_collision_from_mesh(dynamic, mesh, options)
    else:
        if not subsystem.remove_collisions(mesh):
            raise RuntimeError("Cannot reset bench collision")
        if subsystem.add_simple_collisions(mesh, u.ScriptCollisionShapeType.BOX) < 0:
            raise RuntimeError("Cannot create bench collision")
    count = subsystem.get_simple_collision_count(mesh) + subsystem.get_convex_collision_count(mesh)
    if count <= 0:
        raise RuntimeError("No simple collision was generated")
    body = mesh.get_editor_property("body_setup")
    body.set_editor_property("collision_trace_flag", u.CollisionTraceFlag.CTF_USE_SIMPLE_AS_COMPLEX)
    # One final build after materials/collision. Preserve area is important for foliage.
    # Subsystem returns a value copy. A live editor-property struct can notify
    # its owning mesh for every field and rebuild millions of triangles repeatedly.
    nanite = subsystem.get_nanite_settings(mesh)
    nanite.set_editor_property("enabled", True)
    nanite.set_editor_property("preserve_area", bool(record["collisionTrunkSections"]))
    nanite.set_editor_property("keep_percent_triangles", 1.0)
    nanite.set_editor_property("fallback_target", u.NaniteFallbackTarget.RELATIVE_ERROR)
    nanite.set_editor_property("fallback_relative_error", 1.0)
    subsystem.set_nanite_settings(mesh, nanite, True)
    helper.editor.set_metadata_tag(mesh, "NeivaVisualPreparedSHA256", record["preparedSha256"])
    helper.save_asset(mesh)
    bounds = mesh.get_bounds()
    size = [getattr(bounds.box_extent, axis)*2 for axis in ("x", "y", "z")]
    if any(abs(actual-expected) > max(2, expected*.02) for actual, expected in zip(size, record["dimensionsCm"])):
        raise RuntimeError(f"Unexpected import scale/axes: {size}, expected {record['dimensionsCm']}")
    base = bounds.origin.z - bounds.box_extent.z
    if abs(base) > 2:
        raise RuntimeError(f"Mesh base is not on local floor: {base} cm")
    return {"assetId": record["assetId"], "mesh": mesh.get_path_name(), "materials": assigned,
            "dimensionsCm": size, "baseZCm": base, "sourceTriangles": record["triangles"],
            "collisionShapeCount": count, "nanite": True, "preserveArea": bool(record["collisionTrunkSections"]),
            "preparedSha256": record["preparedSha256"]}


def finish_compilation(helper):
    # Registered UE 5.5 console command (AsyncCompilationHelpers.cpp), invoking
    # FAssetCompilingManager::FinishAllCompilation synchronously. It includes
    # meshes, textures and FShaderCompilingManager. No polling or process sleep.
    helper.unreal.SystemLibrary.execute_console_command(None, "Editor.AsyncAssetCompilationFinishAll")


def main(prepare_only=False):
    base = Path(os.environ.get("NEIVA_VISUAL_ASSET_DIR", ASSET_ROOT)).resolve()
    if prepare_only:
        prepare(base)
        print(json.dumps({"prepared": True, "engineImportPassed": False,
                          "plan": str(base / "unreal-visual-plan.json")}, indent=2))
        return
    helper = load_helpers()
    report_path = Path(helper.unreal.Paths.project_saved_dir()) / "NeivaVisual-import.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "startedAtUtc": datetime.now(timezone.utc).isoformat(),
              "status": "running", "engineImportPassed": False, "models": []}
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    try:
        plan = prepare(base)
        for record in plan["models"]:
            materials = {family: make_material(helper, record, family) for family in record["materialMaps"]}
            report["models"].append(apply_mesh(helper, import_mesh(helper, record), record, materials))
        finish_compilation(helper)
        if not helper.editor.save_directory(CONTENT_ROOT, only_if_is_dirty=False, recursive=True):
            raise RuntimeError("Could not save all visual dependencies")
        finish_compilation(helper)
        report.update(status="PASS", engineImportPassed=True, completedAtUtc=datetime.now(timezone.utc).isoformat())
    except Exception as error:
        report.update(status="FAIL", error=str(error))
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    helper.unreal.log(f"Neiva visual assets imported: {report_path}; rendering needs separate validation.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true", help="Validate/stage glTF only; never load Unreal")
    arguments, _ = parser.parse_known_args()
    main(arguments.prepare_only)
