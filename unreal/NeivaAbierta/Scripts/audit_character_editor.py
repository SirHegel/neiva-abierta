"""Read-only audit of the imported character; run with ExecutePythonScript."""
import json
from pathlib import Path
import unreal

lib = unreal.MaterialEditingLibrary
mesh = unreal.load_asset('/Game/NeivaAssets/Models/Character/SK_Character')
if not isinstance(mesh, unreal.SkeletalMesh):
    raise RuntimeError('Imported character missing')
subsystem = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
report = {'mesh': mesh.get_path_name(), 'materials': [], 'sections': []}
for slot in mesh.get_editor_property('materials'):
    mat = slot.get_editor_property('material_interface')
    item = {'slot': str(slot.get_editor_property('material_slot_name')),
            'material': mat.get_path_name() if mat else None}
    if isinstance(mat, unreal.Material):
        item['twoSided'] = mat.get_editor_property('two_sided')
        item['skeletalUsage'] = mat.get_editor_property('used_with_skeletal_mesh')
        item['textures'] = []
        for tex in lib.get_used_textures(mat):
            info = {'asset': tex.get_path_name(), 'class': tex.get_class().get_name()}
            for key in ('srgb', 'compression_settings', 'flip_green_channel'):
                try:
                    value = tex.get_editor_property(key)
                    info[key] = value if isinstance(value, (bool, int, float)) else str(value)
                except Exception:
                    pass
            item['textures'].append(info)
        item['vectors'] = {str(name): str(lib.get_material_default_vector_parameter_value(mat, name))
                           for name in lib.get_vector_parameter_names(mat)}
        item['textureParameters'] = {str(name): str(lib.get_material_default_texture_parameter_value(mat, name))
                                    for name in lib.get_texture_parameter_names(mat)}
        for prop in ('MP_BASE_COLOR', 'MP_NORMAL', 'MP_OPACITY_MASK'):
            node = lib.get_material_property_input_node(mat, getattr(unreal.MaterialProperty, prop))
            item[prop] = str(node)
    report['materials'].append(item)
for lod in range(subsystem.get_lod_count(mesh)):
    report['sections'].append({'lod': lod, 'vertices': subsystem.get_num_verts(mesh, lod),
        'materialIndices': [subsystem.get_lod_material_slot(mesh, lod, section)
                            for section in range(subsystem.get_num_sections(mesh, lod))],
        'buildSettings': str(subsystem.get_lod_build_settings(mesh, lod))})
destination = Path(unreal.Paths.project_saved_dir()) / 'Neiva-character-audit.json'
destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
unreal.log('NEIVA_CHARACTER_AUDIT=' + str(destination))
