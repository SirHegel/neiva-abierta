# Ejecutable Unreal, descarga y transmisión

La [alfa Unreal 0.2.0 para Linux x86_64](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.2.0-linux-alpha)
ya se puede descargar gratis. Está compilada y empaquetada con **Unreal Engine
5.5.4** e incluye el runtime necesario para jugar sin instalar el editor.

## Descargar y jugar

Descarga `Neiva-Abierta-Unreal-0.2.0-Linux-x64.tar.gz` desde la release, extrae
el archivo completo y ejecuta desde la carpeta extraída:

```sh
./Jugar-Neiva.sh
```

Mantén la carpeta `Linux/`, los datos y las licencias junto al lanzador.
Se requiere Linux x86_64 con sesión gráfica y GPU/controlador Vulkan.
No hay ejecutables de esta versión para Windows, Android o iOS ni requisitos
mínimos del juego establecidos. Los [controles nativos](UNREAL.md#abrir-y-jugar)
incluyen WASD, ratón, Shift, Espacio, E, C/V, R y Esc/P.

El archivo publicado ocupa **741.359.235 bytes**. Su SHA-256 es:

```text
2fd09f22b18a790f44876a5b87ae1a0e50d517c17853c1df831d0fd8821d7c5d
```

La release incluye `SHA256SUMS`. El código compilado corresponde a
[`3d42c1f7ab113544f90a2934fcb52b8797f32143`](https://github.com/SirHegel/neiva-abierta/commit/3d42c1f7ab113544f90a2934fcb52b8797f32143).
Se omiten únicamente los archivos externos `.debug`; se conservan binarios,
bibliotecas, contenedores de datos y atribuciones.
La copia pública se descargó sin autenticación, coincidió por tamaño y hash,
y abrió con salida normal. Cámara, pausa y vehículo pasaron las comprobaciones
registradas en el [recibo 0.2](../data/verification/unreal-visual-download.json).
Las mejoras, capturas 1080p y métricas nativas están en
[MEJORA-VISUAL-0.2.md](MEJORA-VISUAL-0.2.md).

## Estado comprobado

El historial siguiente corresponde a la **alfa 0.1.0 anterior**; sus cifras y
pruebas se conservan separadas de la descarga 0.2 indicada arriba.

El 7 de septiembre de 2026 pasaron la compilación C++, la importación de activos
y el flujo UAT de cook, staging, empaquetado y archivo para Linux. UAT terminó
con `ExitCode=0` y `BUILD SUCCESSFUL`. El
[extracto de logs del paquete](../data/verification/unreal-package-log.txt)
identifica los procesos y conserva las líneas relevantes de la ejecución real.

El ejecutable independiente cargó **35.873/35.873 edificios** en 604 componentes,
con Vulkan SM6 y una **NVIDIA GeForce RTX 4050 Laptop**, 6.141 MiB de VRAM y
controlador 595.84. En `packaged-game-01` se comprobaron suelo estable, movimiento
de cámara sin mantener botones del ratón y pausa/reanudación. La prueba
`packaged-game-02-shadow-b` confirmó entrada al coche, avance de unos 4,8 m,
freno y salida. Son pruebas de esas interacciones y trayectos concretos; no
certifican todas las colisiones o fachadas de Neiva.

Pixel Streaming recibió vídeo real VP8 del paquete a **1280 × 720**.
La observación local `observation-j14FY9/report.json` registró 558 cuadros
nuevos durante 18,6192 s: **29,969 FPS recibidos**. El log nativo confirma por
separado la conducción. Los informes del observador sólo acreditan vídeo y
envío de entradas; no identifican por sí solos el motor ni validan jugabilidad.

La prueba `distribution-launch-01` utilizó la carpeta final de distribución:
el CLI prefirió `Jugar-Neiva.sh` y el proceso recibió sus dos ajustes de sombras.
La observación `observation-2iDY5v` recibió 89 cuadros en 3,1622 s, unos 28,145 FPS.
Ese chequeo breve confirma apertura y continuidad de vídeo; no es un benchmark
ni un recorrido completo. Logs y observaciones completos permanecen bajo
`artifacts/unreal-native/`, excluido de Git; el extracto enlazado conserva la
evidencia pública disponible.

El código pasó **178 pruebas automatizadas: 99 Node, 57 Python de raíz y
22 Python de los scripts Unreal**. Las pruebas de código, la construcción UAT
y las observaciones de partida son verificaciones distintas. Las tasas anteriores
miden vídeo decodificado localmente en Chrome 152, no FPS del render ni rendimiento
garantizado en otros equipos. No hay servicio público de Pixel Streaming.

### Sombras y límites pendientes

El lanzador fija `r.Shadow.Virtual.ResolutionLodBiasDirectional=0.5` y
`r.Shadow.Virtual.ResolutionLodBiasDirectionalMoving=0.5` mediante argumentos
INI del proceso, antes del primer frame. Es un perfil de menor resolución de
sombras para reducir el trabajo de las mallas procedurales; sacrifica nitidez.
**Los avisos VSM no están resueltos:** vuelven a verse en capturas de entrada,
conducción y salida del coche de la prueba B. Un único mensaje de arranque en
el log no demuestra que el problema haya desaparecido. La división de fachadas
y el horneado a StaticMesh/Nanite siguen pendientes.

La recepción H.264/NVENC quedó congelada en pruebas anteriores; VP8 es la ruta
con vídeo continuo comprobado. El terreno es plano, muchas alturas y fachadas
son interpretaciones y las ruedas no giran separadas de la malla del coche.
La [revisión de fidelidad](FIDELIDAD.md) explica las carencias del modelo.

### Registro previo del editor

Antes del paquete se verificaron la instalación oficial, la importación
`import-03-report.json` y la partida `UnrealEditor -game` registrada como
`editor-game-05.log`. Esa partida también confirmó suelo y conducción;
`observation-ZoB8NJ` recibió 557 cuadros en 18,5574 s. Es evidencia histórica
del editor, distinta de las partidas posteriores del ejecutable. El SDK oficial
v23 / clang 18.1.0 y Xvfb se prepararon para construir y probar sin usar el
escritorio personal. [Requisitos de Epic para UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/linux-development-requirements-for-unreal-engine?application_version=5.5).

## Construir y ejecutar

En otro equipo, instalar la distribución oficial de **UE 5.5.4** desde
[Epic para Linux](https://www.unrealengine.com/linux), o mediante el launcher
de Epic en Windows. El proyecto y la infraestructura están fijados a 5.5;
no se cambia la versión del motor sin compilar y revisar la migración.

Para incluir la mejora visual 0.2 desde un clon limpio, completar primero el
[orden de descarga, importación CC0 y horneado completo](UNREAL.md#orden-completo-desde-un-clon-limpio).
Los comandos siguientes describen la automatización base; **`import` y
`package` ejecutan sólo `bootstrap_editor.py`**, no `import_visual_assets.py`
ni `bake_landmarks_editor.py`. Esos dos scripts deben terminar dentro del editor
antes del comando `package`. Los recursos generados no están en Git.

```sh
python3 scripts/unreal.py doctor --engine /ruta/UE_5.5
python3 scripts/unreal.py import --engine /ruta/UE_5.5 --gpu nvidia \
  --virtual-display --max-build-actions 2 --shader-workers 2
# Antes de package: importar los recursos CC0 y hornear todos los hitos
# dentro del editor, siguiendo UNREAL.md; comprobar sus informes y cerrarlo.
python3 scripts/unreal.py package --engine /ruta/UE_5.5 --gpu nvidia \
  --virtual-display --max-build-actions 2 --shader-workers 2 --cook-processes 1
```

`package` valida y copia los datos, compila el editor, importa el arte base y
empaqueta mediante UAT. Usa el editor completo con `ExecutePythonScript`, que
termina después de ejecutar el script. Comprueba un informe de importación nuevo,
assets guardados, mapa nativo y binarios/datos del paquete; no acepta el informe
de una importación anterior como éxito de la actual. La salida se escribe en
un directorio nuevo bajo `artifacts/unreal-native/packages/`, sin borrar otra
compilación. `--dry-run` muestra los comandos; no acredita su ejecución.

`--virtual-display` utiliza Xvfb privado en Linux. `--max-build-actions 2`
limita las acciones paralelas de UBT; `--shader-workers 2` limita los workers
locales de shaders durante importación y cook; `--cook-processes 1` selecciona
un proceso de cook. Son límites de concurrencia, no cotas de RAM ni garantías
de duración. El log del motor debe confirmar el número efectivo de workers.

Para abrir la partida de desarrollo después de importar:

```sh
python3 scripts/unreal.py play --engine /ruta/UE_5.5 --gpu nvidia --virtual-display
```

La salida nativa de UAT utiliza `Linux/NeivaAbierta.sh`; la descarga publicada
la abre mediante `Jugar-Neiva.sh`. Se puede copiar la carpeta
completa a otro lugar del PC y ejecutarla desde allí. No basta con copiar sólo
el binario: necesita sus datos y bibliotecas. En Windows, ejecutar el mismo flujo
con `python` en un equipo con UE y Visual Studio compatibles produce el paquete
Win64. **Este Linux no compila un ejecutable Windows mediante ese comando.**
Los requisitos mínimos del juego quedan pendientes de pruebas reales.

La descarga Linux incluye el lanzador
[`publishing/linux/Jugar-Neiva.sh`](../publishing/linux/Jugar-Neiva.sh) en la raíz,
junto a la carpeta `Linux/` completa. Solicita Vulkan y selecciona NVIDIA mediante
PRIME sólo para el proceso del juego cuando `nvidia-smi` confirma su disponibilidad;
`NEIVA_GPU=default` conserva la selección normal del sistema. La
[`plantilla de instrucciones`](../publishing/linux/README-distribucion.md) se
copia como `README.md`; el
[`aviso de Unreal`](../publishing/linux/UNREAL-AVISO.txt) se incluye en `Licenses/` junto
a las atribuciones legibles de `Content/Data/Licenses`. Incluye también los
metadatos cartográficos y sus límites de cobertura. Para nuevas versiones, esta
preparación debe acompañarse de las pruebas del paquete que se vaya a publicar.

Fuentes: [flujo Linux de Epic](https://dev.epicgames.com/documentation/unreal-engine/linux-development-quickstart-for-unreal-engine),
[Python en el editor](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python?application_version=5.5)
y [empaquetado con UAT](https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine).

## Ver la imagen del juego en navegador

Se preparó y compiló la infraestructura oficial de
[Epic Pixel Streaming](https://github.com/EpicGamesExt/PixelStreamingInfrastructure/tree/c3e3abea6590a19e1c0ab4d2954efd6a1d949db3),
revisión `c3e3abea6590a19e1c0ab4d2954efd6a1d949db3` de la rama UE5.5. No se incluye
el código de Unreal Engine en el repositorio ni se requiere una cuenta para
descargar esta infraestructura MIT.

```sh
node scripts/pixel-streaming-local.mjs prepare
node scripts/pixel-streaming-local.mjs doctor --codec VP8 --virtual-display \
  --capture-fence --decouple-framerate
```

`doctor` comprueba la infraestructura y muestra el plan sin abrir un servidor
ni una partida. Sustituye `/ruta/al/paquete-validado` por la raíz de la carpeta
completa de distribución, que contiene `neiva-build-report.json`, y ejecuta:

```sh
node scripts/pixel-streaming-local.mjs start --package /ruta/al/paquete-validado \
  --codec VP8 --virtual-display --capture-fence --decouple-framerate
```

`start --package` exige el informe, los binarios y los datos de un paquete
construido para el sistema actual. Después de esa validación, en Linux prefiere
`Jugar-Neiva.sh` si existe en la raíz y conserva su perfil de sombras; para una
salida UAT sin ese wrapper utiliza `Linux/NeivaAbierta.sh`. La preferencia se
comprobó también con la distribución real. El comando anterior abre Unreal en una
ventana dentro de Xvfb privado en Linux y sirve el reproductor oficial en
`http://127.0.0.1:8080`. No usa `RenderOffScreen` en ese modo. La GPU produce la
imagen y VP8 se codifica por software; el navegador recibe vídeo y envía controles.
La pantalla virtual y el juego comparten la resolución inicial de **1280 × 720**;
`--width` y `--height` cambian ambas. El objetivo configurado es 30 FPS mediante
`PixelStreamingWebRTCFps` y `t.MaxFPS`; no garantiza esa recepción en otros equipos.

`--codec` admite `H264` y `VP8`; H264 conserva el valor predeterminado por
compatibilidad, pero **VP8 es la configuración con recepción comprobada aquí**.
`--capture-fence` y `--decouple-framerate` son opciones explícitas, desactivadas
por defecto; la segunda exige la primera en UE 5.5. Sin `--virtual-display`
se conserva el modo `RenderOffScreen`, disponible para Windows y Linux. El
modo virtual requiere `xvfb-run`, Xvfb y `xauth`, en PATH o en
`~/.cache/neiva-unreal-display/usr/bin`. Al cerrar la sesión, el lanzador termina
el juego y su propia pantalla virtual. No modifica el entorno del escritorio.

`--port` y `--streamer-port` cambian los puertos del reproductor y del juego;
deben ser distintos. `--gpu nvidia` exige NVIDIA; `auto` la selecciona cuando
está disponible. No se prometen ajustes máximos con 6 GB de VRAM.

Sin `--package`, se puede probar sólo la señalización. Esa comprobación aislada
respondió HTTP 200 y WebSocket con la lista de streamers vacía, según
`artifacts/unreal-native/streaming-check.json`. **No acredita recepción de vídeo.**
La evidencia de vídeo real procede de las partidas del paquete descritas arriba;
la señalización vacía no sustituye esas pruebas.

Por defecto ambos puertos escuchan sólo en localhost. `--host 0.0.0.0` permite
acceder al reproductor desde la LAN; el puerto del juego sigue siendo local.
Hay un jugador por transmisión. Para Internet hacen falta HTTPS, acceso controlado
y conectividad WebRTC/STUN/TURN; el script no abre puertos del router ni publica
el escritorio. El PC debe permanecer encendido mientras transmite.

[Guía oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine?application_version=5.5).

## Publicación y costes comprobados

| Destino | Qué aloja | Estado de esta entrega |
| --- | --- | --- |
| GitHub | Código y ejecutable compilado | [Alfa Linux 0.2.0 pública](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.2.0-linux-alpha) |
| Sitio personal en Vercel | Ficha y enlace de descarga | [Sala de juegos](https://jhonstevenalvarezruiz.vercel.app/juegos/); el ejecutable se aloja en GitHub |
| itch.io | Juego descargable sin coste de alojamiento | Alternativa comprobada; no se ha creado una cuenta ni publicado |
| Epic Games Store | Juego descargable gratuito para el jugador | Borrador local; sin envío ni pago |
| PC propio con Pixel Streaming | Render GPU y transmisión en navegador | Vídeo VP8 y controles comprobados con el paquete; sin servicio público |

[itch.io no cobra por crear la página y subir contenido](https://itch.io/docs/creators/faq).
Su herramienta [butler limita el paquete a 30 GB sin comprimir](https://itch.io/docs/butler/pushing.html).
No equivale a una GPU gratuita en la nube. Las pruebas de nube consultadas son
[Eagle: 60 minutos en total](https://www.eagle3dstreaming.com/pricing) y
[Arcware: 60 minutos durante 15 días](https://www.arcware.com/pricing), con sus
límites de almacenamiento, resolución y concurrencia. No se contrataron servicios.

[Epic exige registro y una cuota de 100 USD por juego](https://store.epicgames.com/distribution?lang=es-ES),
además de acuerdos y revisión. Fijar el precio para jugadores en cero no elimina
ese trámite. El envío debe describir lo que el ejecutable realmente hace.
El borrador revisable está en `publishing/epic/store-draft.json`; no representa
un producto creado ni aprobado en el portal. No se envían datos fiscales,
bancarios ni pagos desde estos scripts.

## Proceso para nuevas versiones descargables

1. Completar el empaquetado con la instalación oficial de Unreal 5.5.4 y
   verificar el informe, los binarios y los datos producidos por esa ejecución.
2. Probar la carpeta empaquetada: inicio, caminar/correr, cámara, coche, peatones,
   personalización, colisiones y cierre. Medir carga y rendimiento en GPU real.
3. Obtener una captura y una grabación del ejecutable; revisar que representen
   el juego entregado. No usar imágenes de Cyberpunk/GTA ni renders promocionales
   como evidencia del juego.
4. Crear el archivo descargable con todo el paquete y sus atribuciones. Calcular
   SHA-256, subirlo a GitHub Releases y descargarlo de nuevo para comparar el hash.
5. Enlazar ese artefacto en Juegos y comprobar la descarga pública desde el sitio.
6. Cuando exista Win64 validado y la cuenta de desarrollador esté disponible,
   completar la ficha y enviar a revisión de Epic con precio cero.

La ciudad completa idéntica y el nivel visual de las referencias siguen siendo
objetivos no alcanzados. [Fidelidad y levantamiento pendiente](FIDELIDAD.md).
