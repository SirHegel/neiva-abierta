# Ejecutable Unreal, descarga y transmisión

La entrega solicitada es **Unreal nativo**, con acceso gratuito para el jugador.
La edición Three.js 0.4 publicada en Vercel es una entrega anterior. No acredita
la ejecución de Unreal, ni se utiliza como sustituto de su ejecutable o captura.

## Estado comprobado

El 7 de septiembre de 2026 se comprobó la instalación oficial de **Unreal
Engine 5.5.4 para Linux**, la compilación C++ del proyecto y la importación de
activos en el editor real. El informe local
`artifacts/unreal-native/first-native-20260907T162729Z/import-03-report.json`
registra `compiled: true`, `imported: true` y cero errores. Los informes y logs
locales están excluidos de Git.

La partida de desarrollo, ejecutada con `UnrealEditor -game` bajo Xvfb,
seleccionó Vulkan SM6 y una **NVIDIA GeForce RTX 4050 Laptop**, con 6.141 MiB
de VRAM y controlador 595.84. El log `editor-game-05.log`, en el mismo directorio,
registra **35.873/35.873 edificios cargados**, con radio de vista previa cero.
La selección de GPU usa variables PRIME del proceso y la pantalla virtual
evita utilizar el escritorio personal. Se corrigió la orientación de los
triángulos de suelo y edificios para la colisión de Unreal. La partida posterior
mantuvo al personaje sobre el suelo y permitió entrar al coche, avanzar, frenar
y salir. El log confirma entrada a las 17:29:49 UTC, desplazamiento del coche
de unos 4,8 m y salida a las 17:29:52 UTC. Esto comprueba esa secuencia concreta;
no certifica todas las colisiones e interacciones de la ciudad.

**Pixel Streaming recibió vídeo real VP8 de esa partida** a 1280 × 720.
El informe local `artifacts/unreal-native/stream-observations/observation-ZoB8NJ/report.json`
registra 557 cuadros decodificados durante 18,5574 s: **30,015 FPS recibidos**.
La grabación `stream.webm` del mismo directorio contiene 603 cuadros VP8,
dura unos 20,1 s y ocupa 3.496.469 bytes; SHA-256:
`7cb62e26527cfd57cd260000b55a4aed41e57299e9ac77cc87489fe2edd96552`.
Procede del vídeo WebRTC, sin capturar el escritorio. El observador registra
vídeo y eventos de entrada; el comando y log del motor acreditan por separado
la identidad de Unreal y el resultado de las interacciones.

Son mediciones breves de recepción local en Chrome 152, con render en GPU y
codificación VP8 por software; no son FPS de render ni un benchmark de toda
Neiva. H.264/NVENC quedó detenido en un cuadro durante la prueba de Firefox
y sigue pendiente de corrección. También apareció una advertencia de cola de
sombras Virtual Shadow Maps para geometría sin Nanite. **El paquete Linux está
en construcción y su ejecución independiente todavía no está validada.** No
hay requisitos mínimos del juego establecidos ni servicio público de streaming.

El SDK oficial v23 / clang 18.1.0 y Xvfb están disponibles localmente. Las
versiones de compilador y sistema se contrastan con la
[tabla de requisitos de Epic para UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/linux-development-requirements-for-unreal-engine?application_version=5.5).

## Construir y ejecutar

En otro equipo, instalar la distribución oficial de **UE 5.5.4** desde
[Epic para Linux](https://www.unrealengine.com/linux), o mediante el launcher
de Epic en Windows. El proyecto y la infraestructura están fijados a 5.5;
no se cambia la versión del motor sin compilar y revisar la migración.

```sh
python3 scripts/unreal.py doctor --engine /ruta/UE_5.5
python3 scripts/unreal.py import --engine /ruta/UE_5.5 --gpu nvidia \
  --virtual-display --max-build-actions 2 --shader-workers 2
python3 scripts/unreal.py package --engine /ruta/UE_5.5 --gpu nvidia \
  --virtual-display --max-build-actions 2 --shader-workers 2 --cook-processes 1
```

`package` valida y copia los datos, compila el editor, importa el arte local y
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

Cuando finalice el empaquetado Linux, su entrada será `Linux/NeivaAbierta.sh`.
Se debe comprobar antes de publicar. Se puede copiar la carpeta
completa a otro lugar del PC y ejecutarlo desde allí. No basta con copiar sólo
el binario: necesita sus datos y bibliotecas. En Windows, ejecutar el mismo flujo
con `python` en un equipo con UE y Visual Studio compatibles produce el paquete
Win64. **Este Linux no compila un ejecutable Windows mediante ese comando.**
Los requisitos mínimos del juego quedan pendientes de pruebas reales.

La descarga Linux incluirá el lanzador
[`publishing/linux/Jugar-Neiva.sh`](../publishing/linux/Jugar-Neiva.sh) en la raíz,
junto a la carpeta `Linux/` completa. Solicita Vulkan y selecciona NVIDIA mediante
PRIME sólo para el proceso del juego cuando `nvidia-smi` confirma su disponibilidad;
`NEIVA_GPU=default` conserva la selección normal del sistema. La
[`plantilla de instrucciones`](../publishing/linux/README-distribucion.md) se
copiará como `README.md`; el
[`aviso de Unreal`](../publishing/linux/UNREAL-AVISO.txt) irá a `Licenses/` junto
a las atribuciones legibles de `Content/Data/Licenses`. Se incluirán también los
metadatos cartográficos y sus límites de cobertura. Estos archivos preparan la
distribución; no sustituyen la prueba del paquete independiente antes de publicarlo.

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
ni una partida. Cuando exista una carpeta de paquete verificada, sustituir
`/ruta/al/paquete-validado` por su ruta real y ejecutar:

```sh
node scripts/pixel-streaming-local.mjs start --package /ruta/al/paquete-validado \
  --codec VP8 --virtual-display --capture-fence --decouple-framerate
```

`start --package` exige el informe, los binarios y los datos de un paquete
construido para el sistema actual. El comando anterior abre Unreal en una
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
La evidencia de vídeo real procede de la observación VP8 descrita arriba,
con una partida de desarrollo. Debe repetirse con el paquete que se distribuya.

Por defecto ambos puertos escuchan sólo en localhost. `--host 0.0.0.0` permite
acceder al reproductor desde la LAN; el puerto del juego sigue siendo local.
Hay un jugador por transmisión. Para Internet hacen falta HTTPS, acceso controlado
y conectividad WebRTC/STUN/TURN; el script no abre puertos del router ni publica
el escritorio. El PC debe permanecer encendido mientras transmite.

[Guía oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine?application_version=5.5).

## Publicación y costes comprobados

| Destino | Qué aloja | Estado de esta entrega |
| --- | --- | --- |
| GitHub | Código; Releases puede distribuir el paquete compilado | C++ compilado y activos importados; paquete descargable pendiente |
| Sitio personal en Vercel | Ficha y enlace a descargar; puede enlazar un reproductor alojado con GPU | No hay enlace de ejecutable hasta existir un artefacto validado |
| itch.io | Juego descargable sin coste de alojamiento | Alternativa comprobada; no se ha creado una cuenta ni publicado |
| Epic Games Store | Juego descargable gratuito para el jugador | Borrador local; sin envío ni pago |
| PC propio con Pixel Streaming | Render GPU y transmisión en navegador | Vídeo VP8 y conducción comprobados en la partida de desarrollo; sin servicio público |

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

## Cierre de una versión descargable

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
