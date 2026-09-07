# Neiva Abierta · proyecto Unreal Engine

El proyecto fuente está en `unreal/NeivaAbierta/NeivaAbierta.uproject`, preparado para **Unreal Engine 5.5**. Incluye código C++ original, personaje anónimo en tercera persona, coche arcade conducible, peatones que recorren caminos OSM, colores de ropa persistentes, colisiones, calles y edificios procedurales a partir del mismo JSON que usa la web. Un estudio ficticio de **6 × 4 m, altura 3,5 m** permite abrir un correo a `alvarezruizj289@gmail.com` al acercarse y pulsar **E**. La página pública de Jhon es <https://jhonstevenalvarezruiz.vercel.app/hoja-de-vida/>.

**Estado comprobado:** validación del JSON compartido, recursos artísticos locales, sintaxis Python y pruebas de un ejecutable C++17 que compila el integrador independiente usado por el coche. Unreal Editor y UnrealBuildTool no están disponibles en el entorno de creación: **no hay compilación, prueba de juego Unreal ni ejecutable empaquetado verificados**. La preparación ahora importa un humano con esqueleto y un coche detallado, materiales PBR fotográficos y fachadas generadas. El C++ ya no construye un avatar ni un coche con cubos. Se incluyen también las mallas detalladas de Catedral, Palacio de Justicia, Hotel Neiva Plaza y Colonial. Las fachadas siguen siendo interpretaciones, sin inventario fotográfico completo de la ciudad.

La búsqueda local no encontró Unreal Editor, UnrealBuildTool ni la toolchain de Epic. El equipo sí tiene **NVIDIA RTX 4050 Laptop, 6.141 MiB de VRAM**, además de Intel UHD; `nvidia-smi` identifica el controlador 595.84. La presencia de esa GPU no acredita rendimiento ni acceso al motor. La descarga oficial de Linux exige autenticación de Epic. El estado de acceso y el flujo reproducible de empaquetado están en [DISTRIBUCION.md](DISTRIBUCION.md).

## Abrir y jugar

El flujo automatizado es `python3 scripts/unreal.py package --engine /ruta/UE_5.5 --gpu nvidia`; comprueba la instalación, prepara datos, compila el editor, importa y empaqueta. `doctor` informa de prerrequisitos y `play` inicia el juego preparado. Sin motor, estos comandos fallan explícitamente. Los pasos manuales equivalentes son:

1. Instala Unreal Engine 5.5 y su compilador C++ compatible. El motor se obtiene de Epic y no está incluido en la licencia MIT del repositorio.
2. Desde la raíz del repositorio, copia y valida el mapa:

   ```bash
   python3 unreal/NeivaAbierta/Scripts/prepare_project.py
   python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
   ```

3. Genera los archivos del proyecto con la integración de Unreal de tu sistema y compila el target **NeivaAbiertaEditor / Development Editor**. En Linux con una instalación del motor, el comando equivalente es:

   ```bash
   "$UE_ROOT/Engine/Build/BatchFiles/Linux/Build.sh" NeivaAbiertaEditor Linux Development \
     "$PWD/unreal/NeivaAbierta/NeivaAbierta.uproject" -WaitMutex
   ```

4. Abre el `.uproject`, con los plugins Interchange, Interchange Editor, Python y Editor Scripting Utilities disponibles para UE 5.5. En la primera apertura todavía no existe el mapa binario `/Game/Maps/Neiva`. Desde **Tools → Execute Python Script**, ejecuta `Scripts/bootstrap_editor.py`: valida los archivos antes de modificar assets, importa materiales/modelos y crea el mapa únicamente si falta. Guarda tu nivel actual antes de ejecutar el script.
5. Abre `/Game/Maps/Neiva` y pulsa **Play**. El GameMode genera la ciudad y los actores cargan el arte en `BeginPlay`. Comprueba escala, orientación, suelo, materiales y reproducción del esqueleto. Si falta un recurso, el log da su ruta; no lo sustituye por un avatar/coche de bloques.

| Acción | Control |
| --- | --- |
| Caminar / conducir | WASD o flechas |
| Mirar a pie o en el coche | Ratón |
| Correr | Shift |
| Saltar / frenar el coche | Espacio |
| Entrar o salir del coche / contactar desde el estudio | E |
| Volver al punto de inicio / recuperar coche | R |
| Cambiar color del polo / de la bermuda | C / V y botones del HUD |
| Activar joysticks virtuales | T |
| Mando | Palanca izquierda mover, derecha mirar, botón inferior saltar, izquierdo interactuar |

El HUD incluye botones táctiles para interactuar y cambiar los dos colores de ropa. El mapeo de joysticks virtuales del motor se activa automáticamente en plataformas móviles y con T en escritorio. **Un paquete móvil nativo de Unreal no está compilado ni validado**; la vía prevista para teléfonos es recibir vídeo de Unreal mediante Pixel Streaming. Lumen está configurado para escritorio y no debe asumirse compatible con un móvil nativo.

## Datos y límites del modelo

`Scripts/prepare_project.py` valida el mapa, aplica primero `neiva-corrections.json` y después `neiva-survey.json`, y escribe el resultado en `Content/Data/neiva.json`. Conserva los metadatos de procedencia de cada corrección. También valida y copia `SourceArt/landmarks/neiva-landmarks.json` a `Content/Data/`. La configuración de empaquetado incluye ese directorio como UFS y los materiales generados. `Content/Data/Licenses` recibe las atribuciones, licencias y manifiestos de recursos, con las modificaciones específicas del importador nativo. No se distribuyen copias innecesarias del mapa en Git. Para actualizar la cartografía, ejecuta primero el proceso de actualización descrito en la documentación de datos del repositorio y repite la copia.

El JSON expresa metros: X hacia el este, Z hacia el sur. El código convierte a centímetros de Unreal con **X = x × 100, Y = −z × 100, Z = altura × 100**. Lee `meta.spawn`, `meta.car`, `meta.carYaw` y `meta.studio` para mantener las mismas posiciones de juego que la web.

El mapa base combinado contiene **35.875 huellas de edificios** antes de las remociones documentadas del centro: 878 de OpenStreetMap y 34.997 añadidas desde Overture Maps, release `2026-08-19.0`. Las huellas añadidas proceden de detección automática y no deben interpretarse como mediciones de fachadas. `meta.sources` conserva las atribuciones de Overture, Microsoft ML Buildings y Google Open Buildings y sus licencias. La cartografía combinada es ODbL; se conserva además la atribución CC-BY-4.0 de Google Open Buildings.

Las huellas se extruyen y sus contornos cóncavos se triangulan por recorte de orejas. Las alturas provienen del campo `height`, que incluye estimaciones documentadas en los metadatos. El importador Unreal de esta versión usa el contorno exterior: los huecos interiores `holes` no se recortan todavía. En el mapa combinado hay **3 edificios con anillos interiores**; la validación y el log del importador informan de ellos. También pueden existir huecos en agua/parques, cuyo contorno exterior se dibuja en esta versión. El terreno es plano, los ríos son superficies visuales, y no hay simulación de natación, desniveles de puentes, tráfico autónomo ni interiores reales. Los nombres de barrios y puntos de interés permanecen disponibles en el JSON, pero no se convierten en fachadas, límites administrativos o edificios inventados.

Las **22 cubiertas OSM abiertas** se construyen como losa con grosor y columnas, sin muros que cierren el paso. Los soportes y sus alturas son estimados y se identifican así en los datos. Los tramos de vía confirmados como adoquinados usan el material de pavimento.

La exportación detallada del centro contiene **45 mallas, 177.774 vértices y 110.618 triángulos**, más tres rótulos convertidos a `TextRenderComponent`. Las posiciones y normales originales se conservan al convertir los ejes; las UV pasan a U=u/tileU y V=1−v/tileV para adaptar el origen vertical de las imágenes de Three a Unreal; los cuatro IDs sólo sustituyen sus extrusiones después de validar todo el conjunto y localizar los materiales. El archivo y sus fuentes están en [SourceArt/landmarks](../unreal/NeivaAbierta/SourceArt/landmarks/README.md). El Palacio conserva el modelo bajo revisado, sin torre inventada. La geometría de plaza está incluida; los árboles y chorros animados del cliente anterior no se exportan.

### Importación de toda la ciudad y rendimiento

Por defecto se importan **todos** los edificios, sin límite silencioso. Se agrupan en componentes de malla por sectores de **500 m**, con un corte adicional al alcanzar aproximadamente **60.000 vértices triangulados** por componente. No se crea un actor por edificio. Cada sector tiene sus propios límites de renderizado y su colisión; las matrices temporales se liberan después de construir cada fragmento. La generación inicial sigue siendo síncrona y puede tardar en una máquina real.

La división en sectores y las cuentas del archivo exportado son datos estructurales, **no mediciones de memoria, tiempo de carga ni FPS**. Los datos, mallas de CPU/GPU y colisiones siguen ocupando memoria; la división en sectores no equivale a World Partition ni a streaming de contenido.

Para una vista previa más ligera, el actor `NeivaCity` expone `BuildingRadiusMeters`: **0 carga todo**. También se puede iniciar el juego/editor con `-NeivaBuildingRadius=1500` para seleccionar edificios cuyo centro está a 1.500 m del punto inicial. El HUD muestra el número cargado frente al total y el radio activo. Ese límite permanece fijo durante la sesión: **no carga sectores nuevos al caminar**. Los cuatro hitos detallados y el resto de superficies geográficas permanecen cargados. `BuildingTileSizeMeters` permite variar el tamaño de sector entre 100 y 2.000 m. Estos ajustes requieren verificación de rendimiento en el equipo final.

El coche usa un integrador arcade de paso fijo de 1/60 s, 20 m/s máximos hacia delante y 4,5 m/s marcha atrás; el reloj conserva el tiempo pendiente ante un frame largo. La colisión usa barrido de traslación de una caja invisible. Antes de girar se consulta el solapamiento de la rotación candidata; no se afirma que Unreal haga un barrido de rotación. Al salir se prueban ambos lados, suelo transitable y espacio para la cápsula; una salida bloqueada conserva al jugador dentro. El control cambia mediante `Possess` y el personaje queda detenido, oculto y sin colisión durante la conducción. El render usa el coche importado completo; sus ruedas quedan unidas a la malla y no giran independientemente en esta preparación Unreal. El humano usa el rig y las animaciones originales de Rocketbox, con bloqueo de raíz para que el movimiento proceda de CharacterMovement. Los cambios entre idle, walk y run son directos: quedan pendientes BlendSpace, IK y validación de pisada. La arquitectura fuera de los cuatro hitos continúa basada en huellas extruidas y necesita revisión artística y medición para una ciudad fotorealista. Activar Lumen por sí solo no produce fotorealismo: los componentes procedurales tampoco equivalen a mallas estáticas horneadas con Nanite y campos de distancia. Para producción, convierte sectores validados a Static Mesh, añade LOD/HLOD y mide iluminación y rendimiento sobre hardware real.

## Peatones y personalización

`PedestrianCount=8` solicita hasta ocho peatones con el mismo recurso humano, con variaciones de color; el límite configurable es 24. Se eligen caminos OSM `footway`, `pedestrian` o `path` cerca del inicio. Se descartan posiciones sin suelo o ocupadas. `CharacterMovement` lleva el suelo y las colisiones; el actor envía input cada frame, camina a 1,25 m/s, espera en los extremos y vuelve por el mismo recorrido. Ante un obstáculo persistente invierte el recorrido sin teletransportarse. El HUD y el log informan de cuántos se pudieron crear. Es una población acotada: no hay navegación autónoma de toda la ciudad, tráfico ni conversaciones generativas.

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
| `textures/sunny_sky_2k.hdr` | `/Game/NeivaAssets/Environment/T_sunny_sky_2k` | Cubemap del SkyLight |

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
Los hitos usan materiales dedicados `M_Landmark_*`: color fotográfico multiplicado por el color lineal exportado, normales y ARM, UV escalada una sola vez por `uvTileMeters`. Los materiales de la ciudad genérica conservan sus atlas. Los materiales sólidos del centro conservan color, rugosidad y metalicidad. Esta primera preparación usa superficies opacas de doble cara; el vidrio y el agua no reproducen transmisión óptica ni refracción, y requieren revisión artística en el editor.

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
las posiciones relativas del modelo. Estas llamadas están preparadas según
la documentación, pendientes de ejecución con la instalación real del motor.
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

El script es una vista previa geográfica separada. Cesium usa por defecto ejes locales **este, sur, arriba**; el juego procedural usa **este, norte, arriba**. Antes de combinar ambas escenas hay que adaptar esa transformación, georreferenciar el avatar/estudio y ajustar el movimiento a la elevación real. No superpongas ambas mallas suponiendo que ya coinciden ni publiques una clave dentro de un `.umap`. El flujo de producción debe inyectar la conexión en runtime y mantener la atribución. [Guía de Cesium y créditos](https://cesium.com/learn/unreal/unreal-photorealistic-3d-tiles/), [API fuente de Cesium3DTileset](https://github.com/CesiumGS/cesium-unreal/blob/main/Source/CesiumRuntime/Public/Cesium3DTileset.h).

## Publicación Unreal y Pixel Streaming

Vercel aloja la ficha del proyecto y la edición web anterior. **Un ejecutable Unreal no se ejecuta dentro del hosting de Vercel**. Para jugar a la versión Unreal en navegador, incluido móvil, se necesita un host con GPU que ejecute el juego y la infraestructura de Pixel Streaming. No se ha desplegado ese servidor.

1. Verifica el proyecto en Unreal y empaqueta una build Windows o Linux desde el editor.
2. El plugin estándar **Pixel Streaming de UE 5.5** ya está habilitado en el `.uproject`; no inicia ni contrata un servidor por sí solo. Compila y empaqueta con la instalación compatible.
3. Despliega la infraestructura oficial de señalización y su frontend de la **misma rama de versión del motor**. Configura HTTPS, conectividad WebRTC y TURN cuando la red lo necesite.
4. En el host GPU, inicia el ejecutable con una URL de señalización que hayas configurado, por ejemplo:

   ```bash
   ./NeivaAbierta.sh -RenderOffscreen -ForceRes -ResX=1920 -ResY=1080 \
     -AudioMixer -PixelStreamingURL=ws://127.0.0.1:8888
   ```

5. Comprueba primero la sesión en el frontend oficial y después enlázala desde el sitio web. La resolución del stream, el bitrate y la interfaz táctil se deben probar en los dispositivos finales. `LaunchURL` se ejecuta en el servidor durante Pixel Streaming: para abrir el correo en el teléfono/navegador, el frontend necesita mostrar su propio enlace de contacto público o implementar un mensaje de interacción al cliente. El correo permanece visible en pantalla como alternativa.

El flujo local, la revisión fijada de infraestructura oficial y sus comprobaciones están en [DISTRIBUCION.md](DISTRIBUCION.md). La prueba de señalización sin motor no produjo vídeo de Unreal. No se ha contratado alojamiento GPU ni activado servicios de Google. [Documentación oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine), [infraestructura oficial](https://github.com/EpicGamesExt/PixelStreamingInfrastructure).

## Validación disponible

```bash
python3 unreal/NeivaAbierta/Scripts/prepare_project.py --check
python3 -m py_compile unreal/NeivaAbierta/Scripts/*.py
python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests -v
python3 -m unittest discover -s tests -p 'test_stage_map.py' -v
```

Las pruebas cubren originales JPEG, hash de textura y máscara alterados, escala cero, ruta fuera de `public/`, clip ausente, descarga HTML disfrazada de GLB y escala de los dos atlas. Un ejecutable compilado con `g++ -std=c++17 -Wall -Wextra -Werror` prueba el mismo `NeivaMotion.h` del coche: trayectoria equivalente a 10/15/30/60/120 FPS, frenado, marcha atrás y conservación de tiempo pendiente. Las pruebas cartográficas validan la preparación de correcciones y el contrato de las mallas detalladas. Estos comandos comprueban estructura de datos, fuentes de arte y sintaxis Python; no sustituyen UnrealBuildTool, UnrealHeaderTool, pruebas del editor, verificación de APIs de plugins instalados ni pruebas visuales. La API de mallas utilizada corresponde a [UProceduralMeshComponent de Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent/CreateMeshSection/2?application_version=5.5). Los scripts de materiales usan la [API de MaterialEditingLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary).
