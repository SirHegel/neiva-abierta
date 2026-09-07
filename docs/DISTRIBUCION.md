# Ejecutable Unreal, descarga y transmisión

La entrega solicitada es **Unreal nativo**, con acceso gratuito para el jugador.
La edición Three.js 0.4 publicada en Vercel es una entrega anterior. No acredita
la ejecución de Unreal, ni se utiliza como sustituto de su ejecutable o captura.

## Estado del equipo y del acceso

Comprobado el 7 de septiembre de 2026: Linux, NVIDIA GeForce RTX 4050 Laptop
con 6.141 MiB de VRAM y controlador 595.84, además de Intel UHD. El flujo nativo
selecciona NVIDIA mediante variables de PRIME sólo para el proceso, sin alterar
la configuración del escritorio. No hay medición de FPS de Unreal.

No se encontró Unreal Editor ni UnrealBuildTool. La descarga oficial de Linux
redirige a autenticación de Epic y el repositorio privado del motor devuelve
404 para la cuenta GitHub conectada. Abrir Firefox no concede a un proceso nuevo
una sesión Epic. La solicitud de compartir el escritorio mediante el portal de
Ubuntu terminó cancelada. Tras una nueva indicación del usuario se obtuvo la
imagen de su ventana Firefox: Street View en 1760 Carrera 21. Las llamadas de
control de puntero y teclado fueron denegadas por el portal; compartir la imagen
no concedió control. La vista y sus límites constan en `data/field-survey.json`.

Posteriormente se resolvió la navegación sin usar controles del escritorio:
un Firefox independiente, sin ventana y con perfil nuevo, permite clics, giro
y avance en Street View mediante eventos virtuales. Se llegó al panorama exacto
del enlace del usuario en 1760 Carrera 21. Ese navegador no comparte la sesión
Epic ni las cookies del Firefox personal. [Navegación independiente](NAVEGACION-AISLADA.md).

Por tanto, **no hay compilación C++, paquete ejecutable ni vídeo de Unreal
validados**. El código de preparación, las pruebas sin motor y la señalización
se validan por separado. No se publica una captura Three.js como captura Unreal.

La dependencia oficial **v23 / clang 18.1.0** ya se descargó, se verificó y se
extrajo en la caché local. Son 1.483.760.275 bytes comprimidos, SHA-256
`048ad147d66e45b9dcfcbc986770f8df1ccbf94de11480877e72d2b3b1b48087`.
El ejecutable del compilador responde correctamente. **Este SDK no contiene
Unreal Editor y no acredita una compilación del juego.** Procede de la
[tabla de requisitos de Epic para UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/linux-development-requirements-for-unreal-engine?application_version=5.5).

También está disponible Xvfb en la caché local, extraído del paquete de Ubuntu
sin instalación administrativa. Se comprobó una pantalla virtual independiente
de 1280 × 720 mediante `xdpyinfo`; no se ha probado aún Unreal dentro de ella.

La revisión del importador corrigió los nombres de texturas bajo Interchange
5.5 y el destino de reimportación, valida que un HDR produzca un cubemap y
exige guardar también materiales y texturas dependientes del carro. Los errores
de guardado impiden generar el informe de importación satisfactoria. Las 16
pruebas de preparación nativa y 39 del lanzador/cartografía pasan sin el motor;
las siete regresiones nuevas emplean dobles de la API Python, no Unreal real.

## Construir y ejecutar

Instalar la distribución oficial de **UE 5.5** desde
[Epic para Linux](https://www.unrealengine.com/linux), o mediante el launcher
de Epic en Windows. El proyecto y la infraestructura están fijados a 5.5;
no se cambia la versión del motor sin compilar y revisar la migración.

```sh
python3 scripts/unreal.py doctor --engine /ruta/UE_5.5
python3 scripts/unreal.py package --engine /ruta/UE_5.5 --gpu nvidia
```

`package` valida y copia los datos, compila el editor, importa el arte local y
empaqueta mediante UAT. Usa el editor completo con `ExecutePythonScript`, que
termina después de ejecutar el script. Comprueba un informe de importación nuevo,
assets guardados, mapa nativo y binarios/datos del paquete; no acepta el informe
de una importación anterior como éxito de la actual. La salida se escribe en
un directorio nuevo bajo `artifacts/unreal-native/packages/`, sin borrar otra
compilación. `--dry-run` muestra los comandos; no acredita su ejecución.

Para abrir la partida de desarrollo después de importar:

```sh
python3 scripts/unreal.py play --engine /ruta/UE_5.5 --gpu nvidia
```

El paquete Linux incluye `Linux/NeivaAbierta.sh`. Se puede copiar la carpeta
completa a otro lugar del PC y ejecutarlo desde allí. No basta con copiar sólo
el binario: necesita sus datos y bibliotecas. En Windows, ejecutar el mismo flujo
con `python` en un equipo con UE y Visual Studio compatibles produce el paquete
Win64. **Este Linux no compila un ejecutable Windows mediante ese comando.**
Los requisitos mínimos del juego quedan pendientes de pruebas reales.

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
node scripts/pixel-streaming-local.mjs start --package artifacts/unreal-native/packages/FECHA
```

El segundo comando exige un paquete construido para el sistema actual. Ejecuta
Unreal con render fuera de pantalla, audio y codificación H.264, y sirve el
reproductor oficial en `http://127.0.0.1:8080`. La GPU del PC produce la imagen;
el navegador recibe vídeo y envía los controles. La resolución inicial es
1280 × 720 y el objetivo de transmisión es 30 FPS: **no son FPS medidos**.
`--width`, `--height` y `--port` permiten ajustar la sesión. En este equipo el
proceso Linux usa NVIDIA; no se prometen ajustes máximos con 6 GB de VRAM.

Sin `--package`, se puede probar sólo la señalización: muestra explícitamente
que no hay partida. Esa prueba respondió HTTP 200 y WebSocket con la lista de
streamers vacía. **No hubo vídeo ni conexión de un juego Unreal.** La evidencia
local está en `artifacts/unreal-native/streaming-check.json`.

Por defecto ambos puertos escuchan sólo en localhost. `--host 0.0.0.0` permite
acceder al reproductor desde la LAN; el puerto del juego sigue siendo local.
Hay un jugador por transmisión. Para Internet hacen falta HTTPS, acceso controlado
y conectividad WebRTC/STUN/TURN; el script no abre puertos del router ni publica
el escritorio. El PC debe permanecer encendido mientras transmite.

[Guía oficial de Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine?application_version=5.5).

## Publicación y costes comprobados

| Destino | Qué aloja | Estado de esta entrega |
| --- | --- | --- |
| GitHub | Código; Releases puede distribuir el paquete compilado | Fuente preparada; ejecutable pendiente de motor y prueba |
| Sitio personal en Vercel | Ficha y enlace a descargar; puede enlazar un reproductor alojado con GPU | No hay enlace de ejecutable hasta existir un artefacto validado |
| itch.io | Juego descargable sin coste de alojamiento | Alternativa comprobada; no se ha creado una cuenta ni publicado |
| Epic Games Store | Juego descargable gratuito para el jugador | Borrador local; sin envío ni pago |
| PC propio con Pixel Streaming | Render GPU y transmisión en navegador | Infraestructura comprobada; falta el juego compilado |

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

1. Instalar Epic/Unreal con acceso legítimo y ejecutar el flujo de compilación.
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
