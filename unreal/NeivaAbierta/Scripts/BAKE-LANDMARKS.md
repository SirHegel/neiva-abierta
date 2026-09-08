# Horneado offline de hitos

Este flujo convierte los triángulos existentes de `Content/Data/neiva-landmarks.json` en recursos `StaticMesh` de Unreal. No añade detalle arquitectónico, texturas ni fidelidad geográfica que no existan en el modelo original. El **horneado completo pasó en Unreal 5.5.4 el 7 de septiembre de 2026**: 150 partes, 149 con Nanite y una de agua, conservando 71.311 triángulos. Una partida posterior del editor confirmó la carga de esas 150 partes, sus recursos Nanite, el hash de origen y tres rótulos. La comparación visual y el nuevo empaquetado se verifican por separado; el alfa publicado anteriormente no contiene este cambio.

## Alcance

- Requiere Unreal **5.5.4 Editor**, importación previa mediante `bootstrap_editor.py` y plugin **GeometryScripting** habilitado sólo para el destino Editor. Las bibliotecas de este plugin ya están precompiladas en el motor Linux instalado; el módulo de juego no necesita dependencias de editor adicionales.
- Usa `GeometryScriptSimpleMeshBuffers` → `append_buffers_to_mesh` → `create_new_static_mesh_asset_from_mesh`. El código instalado confirma que se copian normales, UV y color; `DynamicMeshToMeshDescription.cpp` conserva el orden de índices.
- Conversión de metros web a centímetros Unreal: `(x, -z, y) * 100`. Inversión única de índices 1/2 para caras CW, normales originales conservadas y UV `(u / tileU, 1 - v / tileV)`. Las tangentes se calculan en el editor mediante MikkTSpace; no se recalculan normales ni se suprimen triángulos.
- Los pivotes locales se guardan en centímetros, sobre una rejilla común. Los conjuntos densos se separan por centroides de triángulos en celdas de 25 m; **no se cortan triángulos**. Las paredes, cornisas y losas grandes pueden superar esa medida.
- Nanite conserva todos los triángulos de entrada; fallback al 100 % para mantener la geometría de colisión y la alternativa sin Nanite. Precisión de posición de 1/16 cm; UV de precisión completa y tangentes explícitas. Agua: StaticMesh convencional, sin colisión, sombra ni campo de distancia.
- Cada sección de material conserva su color de vértice y obtiene un `MaterialInstanceConstant` equivalente al MID existente. `RoughnessScale` se conserva; `Metalness` se aplica sólo si existe el parámetro. Los padres PBR conservan metalicidad ARM. Se activa el uso Nanite del material antes de guardar.
- Generación SDF a escala 1 y 12 tarjetas Lumen por parte. Las superficies abiertas usan campos de distancia de dos caras: evita descartarlas por estar abiertas, pero es una aproximación y puede producir oclusión incorrecta. No sustituye paredes modulares cerradas con grosor suficiente.

El JSON definitivo de esta prueba contiene **47 secciones, 119.886 vértices y 71.311 triángulos**, tras revisar hotel/catedral y eliminar caras redundantes entre la losa y el cuerpo del hotel. Su SHA-256 es `93306e220a0863a274eb1992f7e4bfd8024ed493180c38015bc9cd046e4912fd`. Las 150 partes conservan cada triángulo exactamente una vez. La división reduce las cajas de muchos conjuntos de detalles; las cornisas largas permanecen enteras y la mayor losa pública sigue midiendo 140,3 m. Estos son tamaños geométricos, no garantía de calidad SDF ni mediciones de FPS.

La prueba preliminar usó la sección 17 del JSON anterior de 45 secciones. Creó un recurso Nanite con fallback de 52 triángulos y campo de distancia 126³ de 2,2 MB. Esa ejecución descubrió que el setter escalar de materiales de UE 5.5 devuelve `false` incluso cuando escribe correctamente; el script comprueba ahora el valor real mediante lectura posterior.

## Preparación y prueba

`scripts/unreal.py package` no ejecuta este horneado: sólo llama al bootstrap
base antes de UAT. En un clon limpio, seguir el [orden completo de construcción](../../../docs/UNREAL.md#orden-completo-desde-un-clon-limpio)
y terminar un horneado **completo** antes de empaquetar. Conservar los `.uasset`
generados y `Content/Data/neiva-landmarks-baked.json`; no están en Git. Repetir
el horneado si cambia el hash del JSON exportado.

Sin arrancar Unreal, desde la raíz del repositorio:

```bash
python3 unreal/NeivaAbierta/Scripts/landmark_bake_plan.py \
  --output artifacts/unreal-native/mi-plan-bake.json
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests \
  -p test_landmark_bake_plan.py -v
```

El archivo de salida nuevo no sobrescribe otro informe. El plan incluye hash SHA-256/SHA-1, límites reales, nombres deterministas, todos los triángulos y un estado `complete:false`.

En una sesión **Editor Vulkan SM6 aislada**, después de cerrar cualquier editor/juego anterior, ejecutar `bake_landmarks_editor.py` con `-ExecutePythonScript=<ruta absoluta>`. Aplicar los mismos límites locales de shaders y Xvfb del launcher; no iniciar un segundo motor simultáneo. Para la primera prueba, suministrar sólo al proceso hijo `NEIVA_BAKE_MESHES=17`: convierte el cuerpo del hotel del JSON inicial. `NEIVA_BAKE_MESHES=17,20` añade las secciones densas de ventanas y cornisas de esa versión. Los índices corresponden al JSON concreto; revisar el plan si se reexporta.

Omitir `NEIVA_BAKE_MESHES` hornea todas las secciones. `NEIVA_BAKE_CELL_METRES` permite elegir 5–200 m; predeterminado 25. Ninguna de estas variables debe guardarse en la sesión global. El script no abre procesos, cambia mapas, descarga datos ni crea actores de estudio.

Se guardan recursos bajo `/Game/NeivaAssets/BakedLandmarks/Bake_<hash>` y un informe único en `Saved/NeivaBake`. Una prueba parcial **no** activa geometría nueva. Antes del guardado final se ejecuta la barrera oficial `Editor.AsyncAssetCompilationFinishAll`, que espera las colas de compilación de recursos, incluidos campos de distancia. Sólo después se publica atómicamente `Content/Data/neiva-landmarks-baked.json`. Un horneado de un JSON nuevo crea otro directorio y no destruye recursos anteriores.

## Integración del runtime

El helper aislado `NeivaBakedLandmarks.h/.cpp` no está acoplado a módulos de editor. Ya está integrado al principio de `ANeivaCity::BuildLandmarks`, antes de leer/generar los PMC:

```cpp
TSet<FString> BakedIds;
if (Neiva::TryBuildBakedLandmarks(this, Mesh, MapData, BakedIds))
    return BakedIds;
```

La integración incluye `NeivaBakedLandmarks.h`. El helper crea las etiquetas; retornar inmediatamente evita duplicarlas junto con los cuatro hitos. El estudio sigue en su ruta original y no aparece en estos recursos. Si falta el manifiesto completo, cambió el JSON/origen o un recurso no conserva triángulos/material/Nanite, el helper no crea componentes y la ruta procedural sigue disponible. La variable `neiva.BakedLandmarks=0` permite una comparación explícita con esa ruta.

## Evidencia de ejecución

- Targets C++ Editor y Game compilados con dos acciones concurrentes: 20,10 s y 26,99 s. Editor volvió a compilar tras integrar cámara de auditoría/HUD: 14,31 s.
- Horneado completo: **80,54 s dentro del script**, 150 recursos guardados, 71.311 triángulos, `assetCompilationBarrierCompleted:true`. Registro local `artifacts/visual-upgrade/bake-full-01.log`; manifiesto generado en `Content/Data/neiva-landmarks-baked.json`.
- Partida nueva del editor: `artifacts/visual-upgrade/editor-game-visual-01/game.log` confirma 150 partes, 149 recursos Nanite y tres etiquetas con hash válido. También carga 15 árboles y seis bancos importados en otra sesión.
- Siete pruebas Python pasan sobre el JSON definitivo: geometría/UV/normales/color, orientación CW, partición sin pérdidas ni topología inválida, determinismo, datos inválidos y regresión del setter escalar.
- La auditoría adicional al final del primer horneado marcó fallo porque exigía una textura normal en el material del pelo. El recurso original del pelo sólo tiene `Color`; no fue un fallo del horneado. La auditoría corregida queda separada para una próxima sesión. La salida global del primer wrapper conserva ese fallo histórico; no se reescribe como éxito.

El proyecto ya incluye `/Game/NeivaAssets` en `DirectoriesToAlwaysCook` y `Data` en UFS. Después de hornear e integrar, requiere **nueva compilación, cook y paquete**; el ejecutable alfa publicado anteriormente no recibe estos recursos por sí solo.

## Verificación pendiente dentro del motor

1. Revisar visualmente material, normal map, orientación de caras y colisión del recurso guardado. El script ya comprueba la cantidad de triángulos en DynamicMesh y fallback; esa comprobación no sustituye caminar sobre la geometría.
2. Comprobar en imagen que los tres rótulos aparecen una sola vez. La suma de recursos Nanite/triángulos y el hash ya se confirmaron en una partida posterior del editor.
3. Vista `Nanite Visualization`, `Mesh Distance Fields` y `Lumen > Surface Cache`; observar zonas rosas sin cobertura y superficies delgadas. Comandos oficiales útiles: `r.Lumen.Visualize.CardPlacement 1` y `r.DistanceFields.LogAtlasStats 1`.
4. Misma cámara/ruta antes y después: sombras del hotel, fachadas oscuras, normales y ropa, contacto con piso, caminar y conducción. Conservar captura y log de avisos VSM; no sustituir la comprobación por desactivar el aviso.
5. Medir tiempo de construcción/carga, memoria, frametime y GPU en la partida real. La RTX 4050 con 6 GB puede ejecutar Vulkan SM6, pero la memoria adicional de Nanite, fallback y SDF todavía debe medirse. No aumentar resolución SDF global ni activar ray tracing de hardware a ciegas.

La prueba inicial es acotada para descubrir errores de API y materiales antes de hornear todo. El resto de la ciudad conserva PMC y no obtiene SDF mediante este cambio. Eliminar toda la construcción en `StartPlay` exige otra fase de assets, partición/streaming y colisiones; no está resuelto por hornear estos cuatro hitos.

Referencias primarias consultadas: [GeometryScript buffers](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryScript_MeshEdits?application_version=5.5), [creación de StaticMesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryScript_NewAssetUtils?application_version=5.5), [opciones Nanite](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MeshNaniteSettings?application_version=5.5), [limitaciones y visualización Lumen](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine?application_version=5.5). Contratos contrastados también con `MeshBasicEditFunctions.cpp`, `CreateStaticMeshUtil.cpp`, `DynamicMeshToMeshDescription.cpp`, `StaticMeshEditorSubsystem.cpp` y `EngineTypes.h` del motor 5.5.4 instalado.
