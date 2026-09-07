# Neiva Abierta · proyecto Unreal Engine

El proyecto fuente está en `unreal/NeivaAbierta/NeivaAbierta.uproject`, preparado para **Unreal Engine 5.5**. Incluye código C++ original, personaje anónimo en tercera persona, coche arcade conducible, colisiones, calles y edificios procedurales a partir del mismo JSON que usa la web. Un estudio ficticio de **6 × 4 m, altura 3,5 m** permite abrir un correo a `alvarezruizj289@gmail.com` al acercarse y pulsar **E**. La página pública de Jhon es <https://jhonstevenalvarezruiz.vercel.app/hoja-de-vida/>.

**Estado comprobado:** validación del JSON compartido y sintaxis de los scripts Python. Unreal Editor, UnrealBuildTool y una GPU de Unreal no están instalados en el entorno de creación: **no hay compilación, prueba de juego Unreal ni ejecutable empaquetado verificados**. Las mallas y el avatar son una base procedural; no representan fachadas fotográficas ni un inventario completo de la ciudad.

## Abrir y jugar

1. Instala Unreal Engine 5.5 y su compilador C++ compatible. El motor se obtiene de Epic y no está incluido en la licencia MIT del repositorio.
2. Desde la raíz del repositorio, copia y valida el mapa:

   ```bash
   python3 unreal/NeivaAbierta/Scripts/prepare_project.py
   ```

3. Genera los archivos del proyecto con la integración de Unreal de tu sistema y compila el target **NeivaAbiertaEditor / Development Editor**. En Linux con una instalación del motor, el comando equivalente es:

   ```bash
   "$UE_ROOT/Engine/Build/BatchFiles/Linux/Build.sh" NeivaAbiertaEditor Linux Development \
     "$PWD/unreal/NeivaAbierta/NeivaAbierta.uproject" -WaitMutex
   ```

4. Abre el `.uproject`. En la primera apertura todavía no existe el mapa binario `/Game/Maps/Neiva`. Desde **Tools → Execute Python Script**, ejecuta `Scripts/bootstrap_editor.py`: crea el mapa vacío y los dos materiales PBR. El código del GameMode genera la ciudad al comenzar Play. El script crea un nivel únicamente si no existe; guarda tu nivel actual antes de ejecutarlo.
5. Cierra y vuelve a abrir el editor para que los componentes del personaje y coche carguen los materiales recién creados. Abre `/Game/Maps/Neiva` y pulsa **Play**.

| Acción | Control |
| --- | --- |
| Caminar / conducir | WASD o flechas |
| Mirar a pie | Ratón |
| Correr | Shift |
| Saltar / frenar el coche | Espacio |
| Entrar o salir del coche / contactar desde el estudio | E |
| Volver al punto de inicio / recuperar coche | R |
| Activar joysticks virtuales | T |
| Mando | Palanca izquierda mover, derecha mirar, botón inferior saltar, izquierdo interactuar |

El HUD incluye un botón táctil para interactuar. El mapeo de joysticks virtuales del motor se activa automáticamente en plataformas móviles y con T en escritorio. El cliente web publicado tiene su propia interfaz adaptable; **un paquete móvil nativo de Unreal no está compilado ni validado**. Lumen está configurado para escritorio y no debe asumirse compatible con un móvil nativo.

## Datos y límites del modelo

`Scripts/prepare_project.py` copia `public/data/neiva.json` a `Content/Data/neiva.json`. La configuración de empaquetado incluye ese directorio como UFS y los materiales generados. No se distribuyen copias innecesarias del mapa en Git. Para actualizar la cartografía, ejecuta primero el proceso de actualización descrito en la documentación de datos del repositorio y repite la copia.

El JSON expresa metros: X hacia el este, Z hacia el sur. El código convierte a centímetros de Unreal con **X = x × 100, Y = −z × 100, Z = altura × 100**. Lee `meta.spawn`, `meta.car`, `meta.carYaw` y `meta.studio` para mantener las mismas posiciones de juego que la web.

El mapa combinado contiene **35.875 huellas de edificios**: 878 de OpenStreetMap y 34.997 añadidas desde Overture Maps, release `2026-08-19.0`. Las huellas añadidas proceden de detección automática y no deben interpretarse como mediciones de fachadas. `meta.sources` conserva las atribuciones de Overture, Microsoft ML Buildings y Google Open Buildings y sus licencias. La cartografía combinada es ODbL; se conserva además la atribución CC-BY-4.0 de Google Open Buildings.

Las huellas se extruyen y sus contornos cóncavos se triangulan por recorte de orejas. Las alturas provienen del campo `height`, que incluye estimaciones documentadas en los metadatos. El importador Unreal de esta versión usa el contorno exterior: los huecos interiores `holes` no se recortan todavía. En el mapa combinado hay **3 edificios con anillos interiores**; la validación y el log del importador informan de ellos. También pueden existir huecos en agua/parques, cuyo contorno exterior se dibuja en esta versión. El terreno es plano, los ríos son superficies visuales, y no hay simulación de natación, desniveles de puentes, tráfico autónomo ni interiores reales. Los nombres de barrios y puntos de interés permanecen disponibles en el JSON, pero no se convierten en fachadas, límites administrativos o edificios inventados.

### Importación de toda la ciudad y rendimiento

Por defecto se importan **todos** los edificios, sin límite silencioso. Se agrupan en componentes de malla por sectores de **500 m**, con un corte adicional al alcanzar aproximadamente **60.000 vértices triangulados** por componente. No se crea un actor por edificio. Cada sector tiene sus propios límites de renderizado y su colisión; las matrices temporales se liberan después de construir cada fragmento. La generación inicial sigue siendo síncrona y puede tardar en una máquina real.

El análisis del JSON actual, sin ejecutar Unreal, contabiliza **604 sectores ocupados** y un máximo teórico de **1.415.055 vértices triangulados** para muros y cubiertas. Son cuentas de geometría, **no mediciones de memoria, tiempo de carga ni FPS**. Los datos, mallas de CPU/GPU y colisiones siguen ocupando memoria; la división en sectores no equivale a World Partition ni a streaming de contenido.

Para una vista previa más ligera, el actor `NeivaCity` expone `BuildingRadiusMeters`: **0 carga todo**. También se puede iniciar el juego/editor con `-NeivaBuildingRadius=1500` para seleccionar edificios cuyo centro está a 1.500 m del punto inicial. El HUD muestra el número cargado frente al total y el radio activo. Ese límite permanece fijo durante la sesión: **no carga sectores nuevos al caminar**. El resto de superficies geográficas permanece cargado. `BuildingTileSizeMeters` permite variar el tamaño de sector entre 100 y 2.000 m. Estos ajustes requieren verificación de rendimiento en el equipo final.

La colisión del coche es arcade, con barrido de una caja y salida lateral comprobada. Sus ruedas y el avatar usan geometría básica, sin rig ni animaciones esqueléticas. Se requiere trabajo artístico y medición adicional para una ciudad fotorealista. Activar Lumen por sí solo no produce fotorealismo: los componentes procedurales tampoco equivalen a mallas estáticas horneadas con Nanite y campos de distancia. Para producción, convierte sectores validados a Static Mesh, añade LOD/HLOD y mide iluminación y rendimiento sobre hardware real.

## Google Maps 3D con Cesium: vista previa opcional

Google ofrece Photorealistic 3D Tiles mediante su Map Tiles API, y documenta Cesium for Unreal como renderizador compatible. No es una exportación de Street View ni una descarga libre de toda Neiva. **La disponibilidad de fotogrametría de Neiva no se ha confirmado con una clave activa**. Los datos de Google conservan sus propios términos y atribuciones; no pasan a ser MIT u ODbL. [Integración oficial de Google](https://developers.google.com/maps/documentation/tile/use-renderer).

Se incluye una conexión real opcional para inspección dentro del editor:

1. Instala una versión de **Cesium for Unreal** compatible con tu versión del motor.
2. Ejecuta `python3 unreal/NeivaAbierta/Scripts/enable_cesium.py` y reinicia el editor. Este script solamente habilita el plugin instalado; no crea cuentas ni activa facturación.
3. Proporciona `GOOGLE_MAPS_API_KEY` mediante el entorno del proceso que inicia Unreal Editor. La cuenta debe tener la Map Tiles API habilitada y sus condiciones de uso resueltas. No escribas la clave en el código, en argumentos visibles o en archivos versionados.
4. Ejecuta `Scripts/preview_google_tiles.py` desde **Tools → Execute Python Script**. Crea una georreferencia en el origen real del JSON y conecta un `Cesium3DTileset` a `https://tile.googleapis.com/v1/3dtiles/root.json`. Activa los créditos en pantalla y la generación de colisiones. La altura elipsoidal inicial de **442 m es provisional** y se puede cambiar con `NEIVA_ELLIPSOID_HEIGHT`; necesita calibración con el terreno recibido.
5. Inspecciona la cobertura en el viewport. Ejecuta `Scripts/clear_google_preview.py` **antes de guardar el nivel**, porque la URL temporal del actor contiene la clave. La vista previa no se guarda automáticamente y no empaqueta datos de Google.

El script es una vista previa geográfica separada. Cesium usa por defecto ejes locales **este, sur, arriba**; el juego procedural usa **este, norte, arriba**. Antes de combinar ambas escenas hay que adaptar esa transformación, georreferenciar el avatar/estudio y ajustar el movimiento a la elevación real. No superpongas ambas mallas suponiendo que ya coinciden ni publiques una clave dentro de un `.umap`. El flujo de producción debe inyectar la conexión en runtime y mantener la atribución. [Guía de Cesium y créditos](https://cesium.com/learn/unreal/unreal-photorealistic-3d-tiles/), [API fuente de Cesium3DTileset](https://github.com/CesiumGS/cesium-unreal/blob/main/Source/CesiumRuntime/Public/Cesium3DTileset.h).

## Publicación Unreal y Pixel Streaming

Vercel publica el cliente web de este repositorio. **Un ejecutable Unreal no se ejecuta dentro del hosting de Vercel**. Para jugar a la versión Unreal en navegador, incluido móvil, se necesita un host con GPU que ejecute el juego y la infraestructura de Pixel Streaming. No se ha desplegado ese servidor.

1. Verifica el proyecto en Unreal y empaqueta una build Windows o Linux desde el editor.
2. Habilita el plugin **Pixel Streaming** compatible con UE 5.5, recompila y empaqueta de nuevo. No está activado por defecto para no agregar un servicio externo a la base local.
3. Despliega la infraestructura oficial de señalización y su frontend de la **misma rama de versión del motor**. Configura HTTPS, conectividad WebRTC y TURN cuando la red lo necesite.
4. En el host GPU, inicia el ejecutable con una URL de señalización que hayas configurado, por ejemplo:

   ```bash
   ./NeivaAbierta.sh -RenderOffscreen -ForceRes -ResX=1920 -ResY=1080 \
     -PixelStreamingURL=ws://127.0.0.1:8888
   ```

5. Comprueba primero la sesión en el frontend oficial y después enlázala desde el sitio web. La resolución del stream, el bitrate y la interfaz táctil se deben probar en los dispositivos finales. `LaunchURL` se ejecuta en el servidor durante Pixel Streaming: para abrir el correo en el teléfono/navegador, el frontend necesita mostrar su propio enlace de contacto público o implementar un mensaje de interacción al cliente. El correo permanece visible en pantalla como alternativa.

La cuenta GPU, sus gastos y los servicios de Google no se han creado ni activado. [Documentación oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine), [infraestructura oficial](https://github.com/EpicGamesExt/PixelStreamingInfrastructure).

## Validación disponible

```bash
python3 unreal/NeivaAbierta/Scripts/prepare_project.py --check
python3 -m py_compile unreal/NeivaAbierta/Scripts/*.py
```

Estos comandos comprueban estructura de datos y sintaxis Python; no sustituyen UnrealBuildTool, UnrealHeaderTool, pruebas del editor, verificación de APIs de plugins instalados ni pruebas visuales. La API de mallas utilizada corresponde a [UProceduralMeshComponent de Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent/CreateMeshSection/2?application_version=5.5). Los scripts de materiales usan la [API de MaterialEditingLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary).
