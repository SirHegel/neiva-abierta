"""UE 5.5.4 full editor Python: bake current landmark buffers into static assets.

Requires GeometryScripting enabled for Editor and completed bootstrap import.
NEIVA_BAKE_MESHES=17,20 makes a partial smoke bake; omit to bake all sections.
Only a successful complete bake atomically publishes Data/neiva-landmarks-baked.json.
No engine/process launcher, downloads, source geometry changes or map actor spawn.
"""
import json
import math
import os
from pathlib import Path
import sys
import time

import unreal

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
from landmark_bake_plan import load_source, make_plan, mesh_chunks


def properties(target, values):
    for key, value in values.items():
        target.set_editor_property(key, value)
    return target


def set_scalar_values(library, material, parameter_names, values):
    for parameter, value in values.items():
        if parameter in parameter_names:
            # UE 5.5 MaterialEditingLibrary.cpp:1061 writes the value but
            # returns its unchanged false local. Read back the actual state.
            library.set_material_instance_scalar_parameter_value(material, parameter, value)
    library.update_material_instance(material)
    for parameter, value in values.items():
        if parameter in parameter_names and not math.isclose(
                library.get_material_instance_scalar_parameter_value(material, parameter), value,
                rel_tol=1e-6, abs_tol=1e-6):
            raise RuntimeError(f"Material parameter write did not persist: {parameter}")


def material_for(part, root, editor, assets):
    name = f"MI_Landmark_{part['sourceMesh']:02d}"
    path = f"{root}/{name}"
    parent = unreal.load_asset(part["parentMaterial"])
    if not isinstance(parent, unreal.Material):
        raise RuntimeError(f"Missing imported landmark parent: {part['parentMaterial']}")
    if part["materialKey"] != "water" and not parent.get_editor_property("used_with_nanite"):
        parent.modify(True)
        parent.set_editor_property("used_with_nanite", True)
        unreal.MaterialEditingLibrary.recompile_material(parent)
        if not editor.save_loaded_asset(parent, only_if_is_dirty=False):
            raise RuntimeError(f"Cannot save Nanite material usage: {part['parentMaterial']}")
    material = unreal.load_asset(path) if editor.does_asset_exist(path) else assets.create_asset(
        name, root, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    if not isinstance(material, unreal.MaterialInstanceConstant):
        raise RuntimeError(f"Unexpected asset type at {path}")
    material.modify(True)
    library = unreal.MaterialEditingLibrary
    library.set_material_instance_parent(material, parent)
    parameter_names = {str(name) for name in library.get_scalar_parameter_names(parent)}
    if "RoughnessScale" not in parameter_names:
        raise RuntimeError(f"Landmark roughness parameter is missing: {part['parentMaterial']}")
    values = {"RoughnessScale": part["roughness"], "Metalness": part["metalness"]}
    # Textured PBR parents keep ARM metalness; they have no Metalness scalar.
    set_scalar_values(library, material, parameter_names, values)
    if not editor.save_loaded_asset(material, only_if_is_dirty=False):
        raise RuntimeError(f"Cannot save material {path}")
    return material


def create_mesh(part, entry, material, editor, subsystem, bake_id):
    path = entry["asset"]
    if editor.does_asset_exist(path):
        existing = unreal.load_asset(path)
        if (not isinstance(existing, unreal.StaticMesh) or editor.get_metadata_tag(existing, "NeivaBake") != bake_id
                or existing.get_num_triangles(0) != len(part["triangles"])
                or existing.get_material(0) != material
                or existing.get_editor_property("nanite_settings").get_editor_property("enabled") != entry["nanite"]):
            raise RuntimeError(f"Refusing to replace an unverified asset at {path}")
        return existing, True
    dynamic = unreal.DynamicMesh()
    buffers = unreal.GeometryScriptSimpleMeshBuffers()
    properties(buffers, {
        "vertices": [unreal.Vector(*p) for p in part["positions"]],
        "normals": [unreal.Vector(*p) for p in part["normals"]],
        "uv0": [unreal.Vector2D(*p) for p in part["uv"]],
        "vertex_colors": [unreal.LinearColor(*part["color"])] * len(part["positions"]),
        "triangles": [unreal.IntVector(*triangle) for triangle in part["triangles"]],
    })
    # AppendBuffersToMesh explicitly copies the authored normal/UV/color overlays.
    # It rejects non-manifold/duplicate topology; do not silently lose triangles.
    unreal.GeometryScript_MeshEdits.append_buffers_to_mesh(dynamic, buffers)
    if dynamic.get_triangle_count() != len(part["triangles"]):
        raise RuntimeError(f"DynamicMesh rejected source triangles: {path}")
    nanite = properties(unreal.MeshNaniteSettings(), {
        "enabled": entry["nanite"], "explicit_tangents": True,
        "lerp_u_vs": True, "position_precision": 4,
        "keep_percent_triangles": 1., "trim_relative_error": 0.,
        "fallback_target": unreal.NaniteFallbackTarget.PERCENT_TRIANGLES,
        "fallback_percent_triangles": 1., "fallback_relative_error": 0.,
    })
    options = properties(unreal.GeometryScriptCreateNewStaticMeshAssetOptions(), {
        "enable_recompute_normals": False, "enable_recompute_tangents": True,
        "enable_nanite": entry["nanite"], "nanite_settings": nanite,
        "enable_collision": part["collision"],
        "collision_mode": unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE,
    })
    mesh, outcome = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(
        dynamic, path, options)
    if outcome != unreal.GeometryScriptOutcomePins.SUCCESS or not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"Static mesh creation failed: {path}: {outcome}")
    mesh.modify(True)
    mesh.set_material(0, material)
    if mesh.get_material(0) != material:
        raise RuntimeError(f"Baked material slot assignment failed: {path}")
    settings = subsystem.get_lod_build_settings(mesh, 0)
    properties(settings, {
        "recompute_normals": False, "recompute_tangents": True,
        "remove_degenerates": False, "use_full_precision_u_vs": True,
        "use_high_precision_tangent_basis": True, "generate_lightmap_u_vs": False,
        # Source sections include open shells; two-sided SDF is an explicit
        # approximation, not invented wall thickness. Water does not need SDF.
        "generate_distance_field_as_if_two_sided": part["collision"],
        "distance_field_resolution_scale": 1. if part["collision"] else 0.,
        "max_lumen_mesh_cards": 12 if part["collision"] else 0,
    })
    subsystem.set_lod_build_settings(mesh, 0, settings)
    if mesh.get_num_triangles(0) != len(part["triangles"]):
        raise RuntimeError(f"Fallback/collision geometry changed triangle count: {path}")
    # Only generated package paths are touched. Saving waits for normal asset
    # serialization; resource validity still needs the subsequent native run.
    editor.set_metadata_tag(mesh, "NeivaBake", bake_id)
    editor.set_metadata_tag(mesh, "NeivaSourceTriangles", str(len(part["triangles"])))
    if not editor.save_loaded_asset(mesh, only_if_is_dirty=False):
        raise RuntimeError(f"Cannot save baked mesh: {path}")
    dynamic.reset()
    return mesh, False


def bake():
    start = time.monotonic()
    required = ("GeometryScript_MeshEdits", "GeometryScript_NewAssetUtils", "GeometryScriptSimpleMeshBuffers")
    if any(not hasattr(unreal, name) for name in required):
        raise RuntimeError("Enable GeometryScripting for Editor in NeivaAbierta.uproject, then restart Editor")
    project = Path(unreal.Paths.project_dir()).resolve()
    data, raw = load_source(project)
    cell = float(os.environ.get("NEIVA_BAKE_CELL_METRES", "25"))
    plan = make_plan(data, raw, cell)
    selected = os.environ.get("NEIVA_BAKE_MESHES", "").strip()
    indices = {int(index) for index in selected.split(",")} if selected else set(range(len(data["meshes"])))
    if not indices or not indices <= set(range(len(data["meshes"]))):
        raise ValueError("NEIVA_BAKE_MESHES must contain existing, zero-based source mesh indices")
    editor = unreal.EditorAssetLibrary
    assets = unreal.AssetToolsHelpers.get_asset_tools()
    subsystem = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    entries = {part["name"]: part for part in plan["parts"]}
    # Resolve every parent first so a missing bootstrap fails before baking.
    for parent in {part["parentMaterial"] for part in plan["parts"] if part["sourceMesh"] in indices}:
        if not isinstance(unreal.load_asset(parent), unreal.Material):
            raise RuntimeError(f"Missing landmark material: {parent}; run bootstrap import first")
    completed = []
    retained_assets = []
    for index in sorted(indices):
        parts = mesh_chunks(data["meshes"][index], index, cell)
        material = None
        for part in parts:
            if material is None:
                material = material_for(part, plan["assetRoot"], editor, assets)
            mesh, reused = create_mesh(part, entries[part["name"]], material, editor, subsystem, plan["bakeId"])
            retained_assets.append(mesh)
            completed.append({"asset": mesh.get_path_name(), "reused": reused,
                              "sourceMesh": index, "triangles": len(part["triangles"])})
            unreal.log(f"Neiva bake: {len(completed)} assets; {part['name']} ({len(part['triangles'])} triangles)")
    # Official UE 5.5 command registered by AssetCompilingManager.cpp and
    # AsyncCompilationHelpers.cpp. It blocks mesh, SDF, cards and shader queues;
    # no arbitrary sleep and no early manifest publication while builds run.
    unreal.log("Neiva bake: waiting for all asset compilation before final save")
    unreal.SystemLibrary.execute_console_command(None, "Editor.AsyncAssetCompilationFinishAll")
    if not editor.save_directory(plan["assetRoot"], only_if_is_dirty=False, recursive=True):
        raise RuntimeError("Not all generated landmark assets were saved")
    plan["assetCompilationBarrierCompleted"] = True
    plan["complete"] = len(completed) == len(plan["parts"])
    plan["engineVersion"] = unreal.SystemLibrary.get_engine_version()
    plan["elapsedSeconds"] = round(time.monotonic() - start, 3)
    plan["completedAssets"] = completed
    report_dir = project / "Saved/NeivaBake"
    report_dir.mkdir(parents=True, exist_ok=True)
    report = report_dir / f"landmarks-{time.time_ns()}.json"
    report.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    if plan["complete"]:
        # Atomic publication prevents a failed/partial bake activating partial city geometry.
        manifest = project / "Content/Data/neiva-landmarks-baked.json"
        temporary = manifest.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(plan, ensure_ascii=False, separators=(",", ":")) + "\n")
        temporary.replace(manifest)
    unreal.log(f"Neiva bake complete={plan['complete']}, assets={len(completed)}, report={report}")
    return plan


if __name__ == "__main__":
    bake()
