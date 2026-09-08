"""Preserve the existing interpreted per-building tint in generated PBR facades."""
from pathlib import Path
import sys
import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap_editor import pbr_material, editor
from asset_plan import build_plan

for spec in build_plan()['materials']:
    if spec['name'] not in ('M_Facade', 'M_UpperFacade'):
        continue
    material = pbr_material(spec['name'], spec['maps'], spec['tileMeters'], spec['normalOpenGL'], vertex_color=True)
    material.modify(True)
    if not editor.save_loaded_asset(material, only_if_is_dirty=False):
        raise RuntimeError('Could not save the facade material')
    node = unreal.MaterialEditingLibrary.get_material_property_input_node(material, unreal.MaterialProperty.MP_BASE_COLOR)
    if not isinstance(node, unreal.MaterialExpressionMultiply):
        raise RuntimeError('Facade BaseColor is missing its authored vertex-tint multiplication')
    unreal.log('NEIVA_FACADE_REPAIRED: ' + material.get_path_name())
