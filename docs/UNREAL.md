# Neiva Abierta · proyecto Unreal Engine

El proyecto fuente está en `unreal/NeivaAbierta/NeivaAbierta.uproject`, compilado con **Unreal Engine 5.5.4**. Incluye personaje anónimo, coche arcade conducible, peatones, colores de ropa, colisiones y geometría cartográfica. El código 0.3 añade lluvia periódica y conversaciones con voz sintética sobre Jhon; retira el edificio ficticio. Los peatones recorren caminos OSM y trayectos simulados dentro del parque Santander. El tema Contacto permite abrir el correo público `alvarezruizj289@gmail.com` mediante un botón explícito. La página pública de Jhon es <https://jhonstevenalvarezruiz.vercel.app/hoja-de-vida/>.

**Alfa Linux 0.3.0 publicada:**
[descarga gratuita en GitHub Releases](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.3.0-linux-alpha).
La compilación, importación y empaquetado UAT de esta versión terminaron
correctamente. La partida nativa del editor y el paquete tienen comprobaciones
separadas. La copia pública descargada sin credenciales pasó 19 comprobaciones
de juego y seis de integridad, con cierre normal: cámara, pausa, vehículo,
conversaciones, ocho peatones, lluvia y secado. La revisión usó Linux,
RTX 4050 Laptop y 1920 × 1080 con límite de 30 FPS; no es un benchmark.
[Recibo 0.3 del paquete](../data/verification/unreal-03.json) ·
[Recibo de descarga 0.3](../data/verification/unreal-03-download.json).

La versión carga **35.873 huellas**, los cuatro hitos preparados, vegetación,
ocho peatones, siete voces y el clima cíclico. Aplica 17.696 alturas estimadas
por raster y una revisión manual separada; ninguna equivale a un levantamiento
métrico confirmado. [Reconstrucción](RECONSTRUCCION-0.3.md) ·
[Clima, diálogos y comprobaciones](CLIMA-DIALOGOS-0.3.md).

La [evidencia histórica 0.2](MEJORA-VISUAL-0.2.md) y su
[recibo de descarga](../data/verification/unreal-visual-download.json) conservan
sus propias capturas y mediciones. Las pruebas 0.1 permanecen en el
[historial de distribución](DISTRIBUCION.md#estado-comprobado); no se usan como
prueba de rendimiento de 0.3.

Los recursos importados incluyen el humano con esqueleto y animaciones,
el coche, materiales PBR, fachadas generadas y las mallas de Catedral,
Palacio de Justicia, Hotel Neiva Plaza y Colonial. Las fachadas genéricas siguen
siendo interpretaciones, sin inventario fotográfico completo de la ciudad.
El [flujo de construcción y distribución](DISTRIBUCION.md) distingue las
comprobaciones del editor, el paquete independiente y la descarga pública.

## Abrir y jugar

Descarga la [alfa Linux x86_64](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.3.0-linux-alpha),
extrae el archivo completo y ejecuta desde su carpeta:

```sh
./Jugar-Neiva.sh
```

Conserva `Linux/` junto al lanzador. El paquete incluye el runtime y no requiere
instalar el editor. Necesita GPU/controlador Vulkan; no hay requisitos mínimos
establecidos ni binarios Windows, macOS o móviles en esta descarga. Las licencias y
los metadatos cartográficos están legibles en `Licenses/` y `Datos/`.

| Acción | Control |
| --- | --- |
| Caminar / conducir | WASD o flechas |
| Mirar a pie o en el coche | Ratón |
| Correr | Shift izquierdo |
| Saltar / frenar el coche | Espacio |
| Entrar o salir del coche / conversar con un peatón visible cercano | E |
| Seleccionar tema durante una conversación (0.3) | 1–4 o botones |
| Cerrar conversación y recuperar movimiento (0.3) | E / Esc / P |
| Volver al punto de inicio / recuperar coche | R |
| Pausar, continuar y acceder a Salir | Esc / P |
| Cambiar color del polo / de la bermuda | C / V y botones del HUD |
| Activar joysticks virtuales | T |
| Mando | Palanca izquierda mover, derecha mirar, botón inferior saltar, izquierdo interactuar |

Los controles de teclado y ratón anteriores corresponden al juego nativo. Los
controles de mando y táctiles están configurados en el código, pero no se han
validado en un dispositivo final. El HUD incluye botones táctiles para interactuar y cambiar los dos colores de ropa. El mapeo de joysticks virtuales del motor se activa automáticamente en plataformas móviles y con T en escritorio. **Un paquete móvil nativo de Unreal no está compilado ni validado**; la vía prevista para teléfonos es recibir vídeo de Unreal mediante Pixel Streaming. Lumen está configurado para escritorio y no debe asumirse compatible con un móvil nativo.

## Compilar el proyecto

Para desarrollar o crear un paquete nuevo se necesita el editor oficial
**UE 5.5.4**, su compilador C++ compatible y Python 3. El motor se obtiene de
Epic y no está incluido en la licencia MIT del repositorio. El comando
`scripts/unreal.py package` prepara los datos, compila el editor, ejecuta
**sólo `bootstrap_editor.py`** y después UAT. **No descarga ni importa el árbol
y banco CC0 ni ejecuta el horneado de hitos.** Desde un clon limpio, completar
primero el orden siguiente para incluir los recursos visuales. En 0.3,
`prepare_project.py` aplica el suplemento de alturas ya incluido y prepara los
recorridos del parque; `bootstrap_editor.py` también genera los materiales de
clima e importa los siete WAV incluidos. No se necesita Piper para compilar:
sólo se usó para generar esos archivos offline. El importador comprueba hashes,
formato y referencias antes de guardar los recursos. Consulta las licencias
en `public/audio/dialogue/` y las limitaciones en [RECONSTRUCCION-0.3.md](RECONSTRUCCION-0.3.md).
Las versiones 0.1 y 0.2 mantienen sus archivos e informes históricos separados.

### Orden completo desde un clon limpio

Ejecutar los comandos de terminal desde la raíz del repositorio. Los `.uasset`,
mapas binarios, informes y datos preparados están excluidos de Git: hay que
generarlos en el equipo de construcción y conservarlos hasta terminar el cook.

1. Comprobar el motor y recuperar los originales CC0 fijados por URL, tamaño y
   SHA-256 en `SourceArt/visual/manifest.json`. La descarga son unos 257 MB;
   `--prepare-only` prepara geometría e información de importación sin arrancar
   Unreal y no acredita que existan recursos importados.

   ```sh
   python3 scripts/unreal.py doctor --engine /ruta/UE_5.5
   python3 unreal/NeivaAbierta/Scripts/download_visual_assets.py
   python3 unreal/NeivaAbierta/Scripts/download_visual_assets.py --verify-only
   python3 unreal/NeivaAbierta/Scripts/import_visual_assets.py --prepare-only
   ```

   El directorio predeterminado es `artifacts/visual-upgrade/assets`. Si se usa
   `--destination` en la descarga, indicar ese mismo directorio mediante
   `NEIVA_VISUAL_ASSET_DIR` sólo a los procesos de preparación/importación.
   Los modelos y texturas base están en `public/` dentro del repositorio.
   El JSON de hitos ya está versionado; para regenerarlo después de modificar
   sus generadores, usar Node 24, `npm ci` y
   `node scripts/export-unreal-landmarks.mjs` **antes del paso siguiente**.

2. Preparar datos y licencias, compilar el target Editor e importar el arte base:

   ```sh
   python3 scripts/unreal.py import --engine /ruta/UE_5.5 --gpu nvidia \
     --virtual-display --max-build-actions 2 --shader-workers 2
   ```

   El launcher ejecuta `prepare_project.py`, `asset_plan.py --check`, Build.sh
   y `bootstrap_editor.py` en el editor completo. El bootstrap importa el
   personaje, coche y materiales, asigna los materiales de piel/ropa y crea
   `/Game/Maps/Neiva` si falta. Debe terminar correctamente con un informe nuevo
   en `unreal/NeivaAbierta/Saved/NeivaAssets-import.json`. No hace falta ejecutar
   los scripts históricos `repair_*` para una importación nueva.

3. Abrir `unreal/NeivaAbierta/NeivaAbierta.uproject` en **una sola sesión del
   editor completo**, sin partida ni cook concurrentes. Con los plugins del
   proyecto habilitados, incluidos Interchange, Python, Editor Scripting
   Utilities y GeometryScripting, ejecutar mediante **Tools → Execute Python
   Script**, en este orden y esperando que termine cada uno:

   - `unreal/NeivaAbierta/Scripts/import_visual_assets.py`: comprobar un informe
     nuevo `Saved/NeivaVisual-import.json` con `status: "PASS"` y
     `engineImportPassed: true`. Importa y guarda árbol, banco y materiales
     bajo `/Game/NeivaAssets/Visual`.
   - `unreal/NeivaAbierta/Scripts/bake_landmarks_editor.py`: no establecer
     `NEIVA_BAKE_MESHES`, para hornear **todas** las secciones. Comprobar el
     informe nuevo de `Saved/NeivaBake/` y
     `Content/Data/neiva-landmarks-baked.json`: ambos deben indicar
     `complete: true`, `assetCompilationBarrierCompleted: true` y el hash del
     `Content/Data/neiva-landmarks.json` actual. Un plan offline o una prueba
     parcial no activa el conjunto completo.

   Los dos scripts también admiten `-ExecutePythonScript=<ruta absoluta>` en
   procesos separados del editor completo; el launcher actual no expone una
   opción para ejecutarlos. En Linux, las sesiones automatizadas deben usar
   Xvfb privado y los límites de concurrencia locales indicados abajo. No usar
   `-NullRHI` ni el commandlet Python para sustituir estas importaciones.
   Véanse [importación CC0](../unreal/NeivaAbierta/Scripts/import_visual_assets.md)
   y [horneado](../unreal/NeivaAbierta/Scripts/BAKE-LANDMARKS.md).

4. Reabrir los recursos guardados y comprobar `/Game/Maps/Neiva` en una partida:
   personaje vestido, árboles y bancos, hotel/catedral, materiales, colisiones
   y controles. El log debe confirmar la carga de hitos con hash válido y las
   instancias de vegetación. Con la fuente revisada actualmente son 150 partes,
   149 Nanite, 71.311 triángulos, 15 árboles y seis bancos; contrastar siempre
   con los informes de la fuente que se está construyendo. Cerrar esa sesión
   antes de empaquetar.

5. Conservar `Content/NeivaAssets`, `Content/Maps` y el manifiesto de horneado
   generados, y crear el paquete:

```sh
python3 scripts/unreal.py package --engine /ruta/UE_5.5 --gpu nvidia \
  --virtual-display --max-build-actions 2 --shader-workers 2 --cook-processes 1
```

El comando repite preparación, compilación e importación base antes de UAT;
conserva los recursos adicionales ya generados. No sustituye los pasos 1–4.
Si cambia el JSON de hitos después del horneado, hay que repetirlo: el runtime
rechaza un manifiesto de otra fuente y vuelve a la geometría procedural.
Abrir después el **ejecutable empaquetado**, comprobar su log y conservar
capturas; el éxito del editor o de UAT por sí solo no valida esa partida.

Los ejemplos usan Linux con NVIDIA y `xvfb-run` disponible. `--virtual-display`
crea un Xvfb privado; los límites permiten dos acciones UBT, hasta dos workers
locales de shaders y un proceso de cook. No limitan la RAM; el número efectivo
de workers se comprueba en el log. `play --virtual-display` inicia una partida
de desarrollo. El motor, compilador y opciones de plataforma deben adaptarse
en Windows; los controles táctiles no equivalen a un paquete móvil validado.

## Datos y límites del modelo

`Scripts/prepare_project.py` valida el mapa, aplica primero `neiva-corrections.json`, después `neiva-survey.json`, el suplemento aprobado de 17.696 alturas estimadas y la revisión manual de un edificio, y escribe el resultado en `Content/Data/neiva.json`. Conserva los metadatos de procedencia de cada corrección. También valida y copia `SourceArt/landmarks/neiva-landmarks.json` a `Content/Data/`. La configuración de empaquetado incluye ese directorio como UFS y los materiales generados. `Content/Data/Licenses` recibe las atribuciones, licencias y manifiestos de recursos, con las modificaciones específicas del importador nativo. No se distribuyen copias innecesarias del mapa en Git. Para actualizar la cartografía, ejecuta primero el proceso de actualización descrito en la documentación de datos del repositorio y repite la copia.

La preparación genera también `Content/Data/neiva-environment.json` con las
posiciones estimadas de árboles y bancos, y copia `SourceArt/visual/manifest.json`
y `README.md` a `Content/Data/Licenses/visual/`. Estos archivos identifican los
originales CC0, autores, URLs, tamaños y SHA-256. `DefaultGame.ini` incluye
`/Game/NeivaAssets` en `DirectoriesToAlwaysCook` y `Data` en
`DirectoriesToAlwaysStageAsUFS`: cubren tanto los recursos visuales como sus
licencias y el manifiesto de horneado. La distribución externa debe conservar
también el subdirectorio `visual/` al copiar `Content/Data/Licenses` a
`Licenses/`; no copiar sólo los archivos de primer nivel. Esta revisión del
flujo conserva las licencias para cada paquete nuevo; no sustituye sus comprobaciones nativas.

El JSON expresa metros: X hacia el este, Z hacia el sur. El código convierte a centímetros de Unreal con **X = x × 100, Y = −z × 100, Z = altura × 100**. Lee `meta.spawn`, `meta.car` y `meta.carYaw` para colocar al jugador y al coche. El estudio ficticio se retiró de la partida 0.3; los metadatos históricos no implican que siga construido.

El mapa base combinado contiene **35.875 huellas de edificios** antes de las remociones documentadas del centro: 878 de OpenStreetMap y 34.997 añadidas desde Overture Maps, release `2026-08-19.0`. Las huellas añadidas proceden de detección automática y no deben interpretarse como mediciones de fachadas. `meta.sources` conserva las atribuciones de Overture, Microsoft ML Buildings y Google Open Buildings y sus licencias. La cartografía combinada es ODbL; se conserva además la atribución CC-BY-4.0 de Google Open Buildings.

Las huellas se extruyen y sus contornos cóncavos se triangulan por recorte de orejas. Las alturas provienen del campo `height`, que incluye estimaciones documentadas en los metadatos. El importador Unreal de esta versión usa el contorno exterior: los huecos interiores `holes` no se recortan todavía. En el mapa combinado hay **3 edificios con anillos interiores**; la validación y el log del importador informan de ellos. También pueden existir huecos en agua/parques, cuyo contorno exterior se dibuja en esta versión. El terreno es plano, los ríos son superficies visuales, y no hay simulación de natación, desniveles de puentes, tráfico autónomo ni interiores reales. Los nombres de barrios y puntos de interés permanecen disponibles en el JSON, pero no se convierten en fachadas, límites administrativos o edificios inventados.

Las **22 cubiertas OSM abiertas** se construyen como losa con grosor y columnas, sin muros que cierren el paso. Los soportes y sus alturas son estimados y se identifican así en los datos. Los tramos de vía confirmados como adoquinados usan el material de pavimento.

La exportación detallada revisada del centro contiene **47 secciones, 119.886 vértices y 71.311 triángulos**, más tres rótulos convertidos a `TextRenderComponent`. Las posiciones y normales originales se conservan al convertir los ejes; las UV pasan a U=u/tileU y V=1−v/tileV para adaptar el origen vertical de las imágenes de Three a Unreal; los cuatro IDs sólo sustituyen sus extrusiones después de validar todo el conjunto y localizar los materiales. El archivo y sus fuentes están en [SourceArt/landmarks](../unreal/NeivaAbierta/SourceArt/landmarks/README.md). El Palacio conserva el modelo bajo revisado, sin torre inventada. La geometría de plaza está incluida; los árboles y chorros animados del cliente anterior no se exportan.

El nuevo [flujo de horneado](../unreal/NeivaAbierta/Scripts/BAKE-LANDMARKS.md) **pasó en Unreal 5.5.4**: genera 150 recursos `StaticMesh`, de los cuales 149 usan Nanite y uno representa agua, conservando todos los triángulos. Una partida posterior del editor confirmó su carga desde disco, los tres rótulos y el hash de la fuente. Las normales, UV, colores y parámetros PBR se conservan; la compilación offline genera campos de distancia y tarjetas Lumen. El manifiesto sólo se publica después de completar las colas de compilación y guardar todos los recursos. Si falta algún recurso o cambia la fuente, se conserva la ruta procedural. Este horneado se entregó en 0.2 y se conserva en 0.3; no convierte el resto de la ciudad en Nanite.

### Importación de toda la ciudad y rendimiento

Por defecto se importan **todos** los edificios, sin límite silencioso. Se agrupan en componentes por sectores de **100 m dentro de 500 m del inicio y 500 m más lejos**, con un corte adicional al alcanzar aproximadamente **60.000 vértices triangulados** por componente. No se crea un actor por edificio. Cada sector tiene sus propios límites de renderizado y su colisión; las matrices temporales se liberan después de construir cada fragmento. La generación inicial sigue siendo síncrona y puede tardar en una máquina real.

La división en sectores y las cuentas del archivo exportado son datos estructurales, **no mediciones de memoria, tiempo de carga ni FPS**. Los datos, mallas de CPU/GPU y colisiones siguen ocupando memoria; la división en sectores no equivale a World Partition ni a streaming de contenido.

Las caras procedurales usan el orden horario que requiere Unreal; las normales
de iluminación conservan su orientación exterior. Esto corrige las superficies
de colisión invertidas de la ciudad y de los hitos importados. La corrección
pasó la compilación C++, las pruebas geométricas y las partidas del editor y del
paquete independiente. Las tangentes se calculan por índice en tiempo lineal,
sin fusionar bordes ni recalcular las normales originales.

El wrapper `Jugar-Neiva.sh` pasa los dos bias direccionales de Virtual Shadow Maps
a **0.5** mediante argumentos INI del proceso. Reduce la resolución de sombras
para disminuir su trabajo sobre la geometría procedural. Los avisos de cola VSM
siguen visibles en capturas durante la conducción de la prueba B; no se dan por
resueltos porque sólo aparezca una entrada de arranque en el log. El nuevo
horneado divide los conjuntos densos de los hitos y permite que sus recursos
usen Nanite; las losas y cornisas largas conservan sus límites reales. Los
sectores procedurales del resto de la ciudad siguen produciendo avisos VSM en
la nueva partida de revisión: no se da el problema por resuelto. La comparación
visual actual evalúa también iluminación sin el relleno directo aproximado;
hornear los cuatro hitos no sustituye la validación de toda la iluminación.

Para una vista previa más ligera, el actor `NeivaCity` expone `BuildingRadiusMeters`: **0 carga todo**. También se puede iniciar el juego/editor con `-NeivaBuildingRadius=1500` para seleccionar edificios cuyo centro está a 1.500 m del punto inicial. El HUD muestra el número cargado frente al total y el radio activo. Ese límite permanece fijo durante la sesión: **no carga sectores nuevos al caminar**. Los cuatro hitos detallados y el resto de superficies geográficas permanecen cargados. `-NeivaBuildingTileMeters=`, `-NeivaBuildingFarTileMeters=` y `-NeivaBuildingFineRadius=` controlan las celdas cercanas, lejanas y el radio fino; los tamaños se acotan entre 100 y 2.000 m. Estos ajustes requieren verificación de rendimiento en el equipo final.

El coche usa un integrador arcade de paso fijo de 1/60 s, 20 m/s máximos hacia delante y 4,5 m/s marcha atrás; el reloj conserva el tiempo pendiente ante un frame largo. La colisión usa barrido de traslación de una caja invisible. Antes de girar se consulta el solapamiento de la rotación candidata; no se afirma que Unreal haga un barrido de rotación. Al salir se prueban ambos lados, suelo transitable y espacio para la cápsula; una salida bloqueada conserva al jugador dentro. El control cambia mediante `Possess` y el personaje queda detenido, oculto y sin colisión durante la conducción. El render usa el coche importado completo; sus ruedas quedan unidas a la malla y no giran independientemente en esta alfa Unreal. El humano usa el rig y las animaciones originales de Rocketbox, con bloqueo de raíz para que el movimiento proceda de CharacterMovement. Los cambios entre idle, walk y run son directos: quedan pendientes BlendSpace, IK y validación de pisada. La arquitectura fuera de los cuatro hitos continúa basada en huellas extruidas y necesita revisión artística y medición para una ciudad fotorealista. Activar Lumen por sí solo no produce fotorealismo: los componentes procedurales tampoco equivalen a mallas estáticas horneadas con Nanite y campos de distancia. Para producción, convierte sectores validados a Static Mesh, añade LOD/HLOD y mide iluminación y rendimiento sobre hardware real.

## Peatones y personalización

`PedestrianCount=8` solicita hasta ocho peatones con el mismo recurso humano, con variaciones de color; el límite configurable es 24. Se eligen caminos OSM `footway`, `pedestrian` o `path` cerca del inicio y tres recorridos simulados dentro del polígono pavimentado del Santander. La revisión nativa 0.3 confirmó ocho peatones creados, cinco dentro o cerca del parque. Se descartan posiciones sin suelo o ocupadas. `CharacterMovement` lleva el suelo y las colisiones; el actor envía input cada frame, camina a 1,25 m/s, espera en los extremos y vuelve por el mismo recorrido. Ante un obstáculo persistente invierte el recorrido sin teletransportarse. El HUD y el log informan de cuántos se pudieron crear. Es una población acotada: no hay navegación autónoma de toda la ciudad, tráfico ni conversaciones generativas.

C y V recorren cuatro colores del polo y de la bermuda. Una máscara RGB auditada separa tela de piel y conserva los pliegues del color original; cada personaje tiene su propia instancia de material. La selección del jugador se guarda con `USaveGame`, slot local `NeivaAppearance_v1`. No se cambian cuerpo, identidad, corte de prendas ni piezas de ropa. El canal de calzado está disponible como parámetro `ShoesTint`, pero no tiene selector en este HUD. La [auditoría de máscara](../unreal/NeivaAbierta/SourceArt/README.md) conserva hash, regiones de piel excluidas y generadores reproducibles. Se importa lineal, sin mipmaps, con filtrado nearest y compresión sin pérdidas de datos para evitar mezcla en las costuras; queda pendiente validar visualmente estas opciones en Unreal.

## Recursos realistas y contrato de importación

`Scripts/asset_plan.py` resuelve fuentes locales de `public/models`,
`public/textures` y `public/facades`. Valida presencia, cabeceras FBX/GLB,
escalas positivas y SHA-256 de los originales PBR/HDR antes de ejecutar
mutaciones en el editor. Selecciona `sourceMaps` del manifiesto: JPEG/PNG
originales para Unreal; las variantes WebP se reservan al cliente web.

| Fuente local | Asset generado | Uso |
| --- | --- | --- |
| `models/character/character.fbx` | `/Game/NeivaAssets/Models/Character/SK_Character` | Humano Rocketbox, rig original |
| `models/character/idle.fbx`, `walk.fbx`, `run.fbx` | `AN_Idle`, `AN_Walk`, `AN_Run` en la carpeta del personaje | Respiración, marcha y carrera originales, mismo Skeleton |
| `models/car/car.glb` | `/Game/NeivaAssets/Models/Car/SM_Car` | Coche detallado, jerarquía horneada antes de combinar piezas |
| `textures/*_{color,normal,arm}_1k.jpg` | `/Game/NeivaAssets/Materials/M_*` | Asfalto, yeso, ladrillo, pavimento, cubierta y terreno |
| `facades/neiva-residential.png` | Material `M_Facade`, atlas de 16 × 6,4 m | Fachadas generadas para volúmenes de hasta 6,4 m |
| `facades/neiva-upper.png` | Material `M_UpperFacade`, atlas de 9,6 × 6,4 m | Fachadas generadas de volúmenes más altos |
| `textures/sunny_sky_2k.hdr` | `/Game/NeivaAssets/Environment/T_sunny_sky_2k` | HDR importado; la partida actual captura SkyAtmosphere para el SkyLight |

Los nombres y dimensiones del atlas son convenciones artísticas del juego.
La procedencia está en [FACHADAS-GENERADAS.md](FACHADAS-GENERADAS.md),
[MATERIALES.md](MATERIALES.md) y [ACTORES.md](ACTORES.md). Las imágenes generadas
no documentan fachadas de direcciones reales. Los materiales Poly Haven son
CC0; Rocketbox tiene su licencia MIT de Microsoft; el coche conserva las
atribuciones CC-BY-4.0 y condiciones de marcas que figuran en su carpeta.

El color se importa como sRGB. ARM permanece lineal: R → oclusión ambiental,
G → rugosidad, B → metalicidad. Las normales OpenGL de Poly Haven invierten
el canal verde al importarse a Unreal. La convención de las normales Rocketbox
no está documentada en la fuente: `NEIVA_CHARACTER_NORMAL_OPENGL=1` es una
selección inicial revisable; usa `0` si la inspección en Unreal exige el sentido
opuesto. Los mapas especulares originales no se reinterpretan como rugosidad.
El pelo/cejas conserva el PNG con alfa y material Masked, umbral 0,45, doble cara.

Las UV de geometría procedural expresan un metro por unidad y se proyectan
según la normal dominante; las tangentes se calculan antes de cargar la malla.
Muros y cubiertas tienen secciones/materiales separados. Los normales y ARM
de yeso acompañan al color del atlas generado como acabado representativo.
El agua sigue siendo una superficie opaca simple, sin simulación volumétrica.
Los hitos usan materiales dedicados `M_Landmark_*`: color fotográfico multiplicado por el color lineal exportado, normales y ARM, UV escalada una sola vez por `uvTileMeters`. Los materiales de la ciudad genérica conservan sus atlas. Los materiales sólidos del centro conservan color, rugosidad y metalicidad. Esta alfa usa superficies opacas de doble cara; el vidrio y el agua no reproducen transmisión óptica ni refracción, y requieren revisión artística en el editor.

`[/Script/NeivaAbierta.NeivaVisualSettings]` en `Config/DefaultGame.ini` permite
cambiar las referencias del personaje, coche, cubemap y animaciones. Los campos
`CharacterRotation` y `CarRotation` ajustan el frente del recurso importado;
`CharacterHeightCm=180` y `CarLengthCm=420` fijan la escala desde sus bounds.
La importación FBX convierte ejes/unidades y fuerza frente X. El glTF conserva
sus transformaciones internas al combinarse: hay que verificar el sentido final
en el editor, sin trasladar un giro web a Unreal por suposición. `RunAnimation` apunta al clip de carrera original. Los clips se importan con `force_root_lock` y `ANIM_FIRST_FRAME`; el desplazamiento horizontal procede de `CharacterMovement`. Caminar usa 2 m/s y correr 5,4 m/s. El rig contiene 80 huesos ligados; los tres clips se rechazan si el Skeleton no coincide.

La segunda ejecución reutiliza las mallas y texturas importadas. Para volver
a importarlas tras cambiar fuentes, inicia el editor con
`NEIVA_REIMPORT_ASSETS=1`. Los grafos de materiales de `/Game/NeivaAssets/Materials`
se regeneran; guarda materiales personalizados fuera de ese espacio. Un resultado
con varias mallas cuando se esperaba una detiene el proceso y exige revisar la
importación; no se elige una pieza arbitraria del coche. El informe del editor
se escribe en `Saved/NeivaAssets-import.json`, excluido de Git.

El ensamblado utiliza la [API FBX de Epic para UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/FbxImportUI?application_version=5.5)
y [InterchangeManager](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeManager?application_version=5.5).
La [configuración de meshes de Interchange](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeGenericMeshPipeline?application_version=5.5)
expone la combinación de mallas estáticas; el horneado de jerarquía conserva
las posiciones relativas del modelo. La importación se ejecutó con Unreal
5.5.4 y pasó las comprobaciones de assets guardados y mapa nativo.
El GLB del coche declara 29 materiales y extensiones de barniz, transmisión,
iridiscencia, emisión, variantes y transformación UV. Su equivalencia visual
debe contrastarse con Interchange instalado: la importación de una malla no
certifica que todas esas extensiones se reproduzcan igual que en el cliente web.

## Google Maps 3D con Cesium: vista previa opcional

Google ofrece Photorealistic 3D Tiles mediante su Map Tiles API, y documenta Cesium for Unreal como renderizador compatible. No es una exportación de Street View ni una descarga libre de toda Neiva. **Neiva no figura dentro de los polígonos de superficie del visor oficial consultado el 7 de septiembre de 2026**; la revisión usó render vectorial y un control positivo. [Comprobación de cobertura](GOOGLE-COVERAGE.md). Los datos de Google conservan sus propios términos y atribuciones; no pasan a ser MIT u ODbL. [Integración oficial de Google](https://developers.google.com/maps/documentation/tile/use-renderer).

Se incluye una conexión real opcional para inspección dentro del editor:

1. Instala una versión de **Cesium for Unreal** compatible con tu versión del motor.
2. Ejecuta `python3 unreal/NeivaAbierta/Scripts/enable_cesium.py` y reinicia el editor. Este script solamente habilita el plugin instalado; no crea cuentas ni activa facturación.
3. Proporciona `GOOGLE_MAPS_API_KEY` mediante el entorno del proceso que inicia Unreal Editor. La cuenta debe tener la Map Tiles API habilitada y sus condiciones de uso resueltas. No escribas la clave en el código, en argumentos visibles o en archivos versionados.
4. Ejecuta `Scripts/preview_google_tiles.py` desde **Tools → Execute Python Script**. Crea una georreferencia en el origen real del JSON y conecta un `Cesium3DTileset` a `https://tile.googleapis.com/v1/3dtiles/root.json`. Activa los créditos en pantalla y la generación de colisiones. La altura elipsoidal inicial de **442 m es provisional** y se puede cambiar con `NEIVA_ELLIPSOID_HEIGHT`; necesita calibración con el terreno recibido.
5. Inspecciona la cobertura en el viewport. Ejecuta `Scripts/clear_google_preview.py` **antes de guardar el nivel**, porque la URL temporal del actor contiene la clave. La vista previa no se guarda automáticamente y no empaqueta datos de Google.

El script es una vista previa geográfica separada. Cesium usa por defecto ejes locales **este, sur, arriba**; el juego procedural usa **este, norte, arriba**. Antes de combinar ambas escenas hay que adaptar esa transformación, georreferenciar al personaje y al coche y ajustar el movimiento a la elevación real. No superpongas ambas mallas suponiendo que ya coinciden ni publiques una clave dentro de un `.umap`. El flujo de producción debe inyectar la conexión en runtime y mantener la atribución. [Guía de Cesium y créditos](https://cesium.com/learn/unreal/unreal-photorealistic-3d-tiles/), [API fuente de Cesium3DTileset](https://github.com/CesiumGS/cesium-unreal/blob/main/Source/CesiumRuntime/Public/Cesium3DTileset.h).

## Publicación Unreal y Pixel Streaming

Vercel aloja la ficha del proyecto y la edición web anterior. **Un ejecutable Unreal no se ejecuta dentro del hosting de Vercel**. Para jugar a la versión Unreal en navegador, incluido móvil, se necesita un host con GPU que ejecute el juego y la infraestructura de Pixel Streaming. La recepción local de vídeo VP8 del paquete independiente está comprobada; no hay un servicio público de streaming desplegado ni una prueba en teléfonos que acredite esta versión nativa.

1. Para una sesión local Linux, usa la carpeta completa de la alfa publicada. Para otras plataformas o cambios del proyecto, compila y valida un paquete nuevo.
2. El plugin estándar **Pixel Streaming de UE 5.5** ya está habilitado en el `.uproject`; no inicia ni contrata un servidor por sí solo. Compila y empaqueta con la instalación compatible.
3. Despliega la infraestructura oficial de señalización y su frontend de la **misma rama de versión del motor**. Configura HTTPS, conectividad WebRTC y TURN cuando la red lo necesite.
4. Prepara la infraestructura oficial y comprueba el plan. Sustituye la ruta del ejemplo por la raíz de la carpeta que contiene `Jugar-Neiva.sh`, `Linux/` y `neiva-build-report.json`:

   ```bash
   node scripts/pixel-streaming-local.mjs prepare
   node scripts/pixel-streaming-local.mjs doctor --codec VP8 --virtual-display \
     --render-offscreen --capture-fence --decouple-framerate
   node scripts/pixel-streaming-local.mjs start --package /ruta/al/paquete-validado \
     --codec VP8 --virtual-display --render-offscreen --capture-fence --decouple-framerate
   ```

   El CLI valida el informe, los binarios y los datos antes de iniciar. Prefiere
   `Jugar-Neiva.sh` en Linux cuando existe, conservando su perfil de sombras;
   para una salida UAT sin wrapper usa `Linux/NeivaAbierta.sh`. La elección se
   comprobó en la partida real `distribution-launch-01`.

   Esta configuración usa VP8 por software y una pantalla Xvfb privada de
   1280 × 720, con objetivo de 30 FPS. `--width` y `--height` ajustan ambas
   dimensiones. `--render-offscreen` evita presentar la imagen en una ventana
   de Xvfb; omitirlo conserva el modo virtual con ventana. Las pruebas de 0.2
   usaron esta opción a 1920 × 1080. El lanzador gestiona únicamente su juego
   y su Xvfb. `--codec H264` sigue siendo el
   valor predeterminado por compatibilidad; su ruta NVENC se congeló en un cuadro
   durante la prueba local con Firefox. Los flags de fence y desacople son
   explícitos; desacoplar exige fence. `doctor` y `--dry-run` no ejecutan Unreal.

5. Comprueba primero la sesión en el frontend oficial y después enlázala desde el sitio web. La resolución del stream, el bitrate y la interfaz táctil se deben probar en los dispositivos finales. `LaunchURL` se ejecuta en el servidor durante Pixel Streaming: para abrir el correo en el teléfono/navegador, el frontend necesita mostrar su propio enlace de contacto público o implementar un mensaje de interacción al cliente. El correo permanece visible en pantalla como alternativa.

El flujo local, la revisión fijada de infraestructura oficial y las mediciones VP8 están en [DISTRIBUCION.md](DISTRIBUCION.md). La señalización aislada no acredita vídeo; las pruebas del paquete citadas arriba incluyen proceso nativo, transmisión y controles. El estado de la copia descargada públicamente se registra por separado en esa página. No se ha contratado alojamiento GPU ni activado servicios de Google. [Documentación oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine), [infraestructura oficial](https://github.com/EpicGamesExt/PixelStreamingInfrastructure).

### Grabar el vídeo recibido sin recodificar

Con la partida y el reproductor local activos, Chrome instalado y `ffmpeg` y
`ffprobe` en PATH:

```bash
node scripts/inspect-unreal-stream.mjs --browser chrome --record-encoded --seconds 8
```

El observador abre su propio navegador sin usar el teclado, ratón o perfil del
escritorio. Copia los cuadros VP8 recibidos desde el primer cuadro clave y guarda
`stream-encoded.ivf`, `stream-encoded.webm`, dos PNG a resolución original y
`report.json` en una carpeta nueva de `artifacts/unreal-native/stream-observations/`.
El WebM conserva los datos comprimidos, su orden y las marcas de tiempo, incluidas
las repetidas; FFprobe comprueba cada cuadro después de cambiar el contenedor.
El IVF conserva los ticks RTP exactos; WebM cuantiza el tiempo a milisegundos.
No se reescala ni se añade audio. Incluye el arranque de la conexión y tiene
límites de 32 MiB y 60 segundos; `coveredObservation` indica si abarcó toda la
observación o se detuvo antes. Requiere VP8 y la API `createEncodedStreams` de
Chrome; no activa una recodificación alternativa si falla. En 0.3 se observaron
retrocesos durante el arranque que invalidan algunas grabaciones. La opción
`--record-after-warmup` es experimental: el codificador VP8 de UE 5.5 no consume
el flag que activa la petición de keyframe del frontend. Para el vídeo de esta
entrega se usa `--record` con MediaRecorder y se recodifican vídeo y audio,
normalizando la presentación a 30 FPS. Esa cadencia no reproduce una medición
de FPS originales; las PNG conservan la imagen nativa y no se hizo escucha humana.
[Diagnóstico y límites del grabador](CLIMA-DIALOGOS-0.3.md#grabación-de-evidencia-vp8).

Los FPS recibidos por WebRTC no equivalen a los FPS de renderizado nativo. El
[registro visual de 0.2](MEJORA-VISUAL-0.2.md) separa ambas mediciones. Para cerrar
normalmente un juego nativo después de capturarlo, puede añadirse `--quit-game`;
comprueba después la salida del proceso antes de cerrar su pantalla virtual.

## Validación disponible

La revisión 0.2 y su grabador pasaron **207 pruebas: 109 Node, 57 Python
de raíz y 41 Python de scripts Unreal**. Por separado, se completaron UHT,
compilación C++, importación y UAT, y se probaron partidas del ejecutable Linux.
Es un recuento histórico. La construcción, las partidas y las comprobaciones
de 0.3 se registran por separado en [unreal-03.json](../data/verification/unreal-03.json);
las pruebas portables no sustituyen las del ejecutable.

```bash
python3 unreal/NeivaAbierta/Scripts/prepare_project.py --check
python3 -m py_compile unreal/NeivaAbierta/Scripts/*.py
python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests -v
python3 -m unittest discover -s tests -p 'test_stage_map.py' -v
node --test tests/pixel-streaming.test.mjs
```

Las pruebas de tangentes cubren UV reflejadas, bordes separados, triángulos
degenerados y normales existentes. Las pruebas de orientación ejecutan los
generadores C++ de caras, extrusiones y calles, y comprueban los índices de los
hitos contra la convención de Unreal/Chaos. Las del lanzador comprueban códecs,
dimensiones, rechazo de paquetes incompletos y cierre de su propio Xvfb con
procesos inocuos; esas pruebas no ejecutan el juego.

Las pruebas cubren originales JPEG, hash de textura y máscara alterados, escala cero, ruta fuera de `public/`, clip ausente, descarga HTML disfrazada de GLB y escala de los dos atlas. Un ejecutable compilado con `g++ -std=c++17 -Wall -Wextra -Werror` prueba el mismo `NeivaMotion.h` del coche: trayectoria equivalente a 10/15/30/60/120 FPS, frenado, marcha atrás y conservación de tiempo pendiente. Las pruebas cartográficas validan la preparación de correcciones y el contrato de las mallas detalladas. Estos comandos comprueban estructura de datos, fuentes de arte y sintaxis Python; no sustituyen UnrealBuildTool, UnrealHeaderTool, pruebas del editor, verificación de APIs de plugins instalados ni pruebas visuales. La API de mallas utilizada corresponde a [UProceduralMeshComponent de Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent/CreateMeshSection/2?application_version=5.5). Los scripts de materiales usan la [API de MaterialEditingLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary).
