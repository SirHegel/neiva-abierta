# Importar vegetación y banco en Unreal 5.5

El importador genera `/Game/NeivaAssets/Visual` sin editar mapas, configuración o C++. Usa Interchange incluido en UE 5.5 y GeometryScripting para la colisión del tronco. Las texturas llegan a 2K; no usa Blender, OBJ ni reconstruye normales del original.

Este paso no se ejecuta automáticamente con `scripts/unreal.py import` o
`package`. Para un clon limpio, seguir el [orden completo](../../../docs/UNREAL.md#orden-completo-desde-un-clon-limpio):
descarga y preparación offline, bootstrap base, esta importación en el editor,
horneado completo de hitos y, por último, cook/paquete.

Desde la raíz del repositorio, recuperar los originales publicados bajo CC0:

```bash
python3 unreal/NeivaAbierta/Scripts/download_visual_assets.py
python3 unreal/NeivaAbierta/Scripts/import_visual_assets.py --prepare-only
```

`download_visual_assets.py --verify-only` comprueba los archivos existentes sin red ni modificaciones. El manifiesto versionado `SourceArt/visual/manifest.json` fija URLs oficiales, autores, tamaños y SHA256. El directorio predeterminado es `artifacts/visual-upgrade/assets`; `--destination` cambia la descarga, y `NEIVA_VISUAL_ASSET_DIR` cambia la entrada del importador. No se suben los 257 MB de originales a Git.

En una sesión de Editor reservada para importar, ejecutar el archivo `import_visual_assets.py` con `-ExecutePythonScript` o desde la consola Python mediante `runpy.run_path('/ruta/absoluta/import_visual_assets.py', run_name='__main__')`. No ejecutar a la vez que una partida o un cook. La preparación offline no acredita importación ni render.

Primera importación real completada el **2026-09-07, 19:20 UTC**, en Unreal 5.5.4 con Vulkan: `Saved/NeivaVisual-import.json` registró `PASS`; registro local `artifacts/visual-upgrade/import-visual-01.log`. Árbol: tres materiales, tres colisiones simples, base Z≈0 y altura 19,469 m. Banco: tres materiales, una colisión simple, base Z≈0 y dimensiones 2,452 × 0,670 × 0,867 m. Esto acredita importación/guardado, no el resultado visual del parque. Unreal señaló algunas tangentes/cotangentes casi nulas en el árbol fuente; corresponde revisar sus normales bajo iluminación real.

Tras esa ejecución se sustituyó el acceso a la estructura viva de Nanite por `StaticMeshEditorSubsystem.get_nanite_settings`, que devuelve una copia y evita una reconstrucción por campo. También se añadió `Editor.AsyncAssetCompilationFinishAll` antes/después del guardado final: el comando nativo espera las compilaciones de mallas, texturas y shaders antes del recibo `PASS`. Estos dos ajustes posteriores tienen revisión de API y pruebas de contrato; no se repitió la importación pesada para esta modificación.

El árbol conserva sus 3.863.832 triángulos fuente, activa Nanite y `preserve_area`; no genera un falso LOD mediante una reducción arbitraria. Nanite selecciona detalle en ejecución y aún requiere medir coste visual/rendimiento. Tres volúmenes bajos se ajustan a vértices del tronco; la copa no bloquea al jugador. El banco conserva 10 piezas ensambladas, **12.500 triángulos**, sin conectores ni variantes sueltos; tiene una caja de colisión conservadora. Ambos tienen suelo local Z≈0, validado con tolerancia de 2 cm tras importar. El banco queda centrado horizontalmente.

Los materiales usan color sRGB, normales OpenGL con verde invertido y ARM lineal (R=AO, G=roughness, B=metalness). Las hojas usan `Masked`, dos caras y sombreado `Two Sided Foliage`; la Opacity Mask viene de **R del PNG separado**, nunca de A (A es casi opaco). Se conserva cobertura de la máscara al generar mips. Las ranuras se identifican por nombre y se asignan mediante `StaticMesh.set_material`; cada recurso se marca modificado y se guarda forzosamente.

El importador escribe `Saved/NeivaVisual-import.json` con estado `running`, `FAIL` o `PASS`, hashes, rutas de objeto, dimensiones y colisiones. Un fallo reemplaza el estado anterior. Sólo `PASS` significa que se importaron y guardaron activos; comprobar después su apariencia en una partida y reabrir los activos para auditar persistencia. Un cambio del glTF preparado exige `NEIVA_REIMPORT_ASSETS=1`; no se reutiliza silenciosamente una malla de otra procedencia.

Rutas configuradas en `DefaultGame.ini` para las propiedades nativas `TreeMesh` y `BenchMesh` de `UNeivaVisualSettings`:

```ini
[/Script/NeivaAbierta.NeivaVisualSettings]
TreeMesh=/Game/NeivaAssets/Visual/Models/SM_Jacaranda.SM_Jacaranda
BenchMesh=/Game/NeivaAssets/Visual/Models/SM_StreetBench.SM_StreetBench
```

El importador no modifica `DefaultGame.ini`; la configuración versionada ya incluye `/Game/NeivaAssets` en el cook. `prepare_project.py` genera las posiciones/alturas estimadas en `Content/Data/neiva-environment.json` y copia el manifiesto CC0 y su README a `Content/Data/Licenses/visual/`, incluidos mediante UFS. El runtime normaliza la altura del árbol original, aproximadamente 19,47 m, para cada instancia; no representa un árbol local medido.

APIs comprobadas contra cabeceras de la instalación oficial y documentación UE 5.5: [InterchangeGenericMeshPipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeGenericMeshPipeline?application_version=5.5), [MeshNaniteSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MeshNaniteSettings?application_version=5.5), [StaticMeshEditorSubsystem](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/StaticMeshEditorSubsystem?application_version=5.5), [GeometryScript_Primitives](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryScript_Primitives?application_version=5.5) y [GeometryScript_Collision](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryScript_Collision?application_version=5.5).
