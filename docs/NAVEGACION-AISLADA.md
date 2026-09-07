# Firefox independiente para revisar referencias

`scripts/isolated-firefox.mjs` abre Firefox **sin ventana**, con un perfil nuevo
y controles virtuales mediante WebDriver BiDi. Permite trabajar mientras el
usuario usa el teclado y mouse del escritorio. Requiere Node 24, las dependencias
del repositorio y Firefox instalado; no instala otro navegador.

```sh
node scripts/isolated-firefox.mjs
```

El proceso recibe un objeto JSON por línea en su entrada estándar. Por ejemplo:

```json
{"id":"abrir","action":"goto","url":"https://www.google.com/maps/@?api=1&map_action=pano&pano=CIC3DQzywCxaSxfLXZIXOA&heading=186.21&pitch=-39.58&fov=75"}
{"id":"leer","action":"inspect"}
{"id":"avanzar","action":"key","key":"ArrowUp","durationMs":150}
{"id":"mirar","action":"move","x":1000,"y":450}
{"action":"down"}
{"action":"move","x":420,"y":450,"steps":24}
{"action":"up"}
{"id":"cerrar","action":"quit"}
```

Las coordenadas de entrada son píxeles del viewport virtual de 1440 × 900.
La respuesta a un evento confirma su envío; una nueva lectura o captura permite
comprobar su efecto después de que la página termine de renderizar. La herramienta
no recorre automáticamente una ciudad ni descarga conjuntos de panoramas.

El perfil es exclusivo de cada ejecución. No abre el perfil personal, importa
cookies ni hereda las variables `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY` o
`DBUS_SESSION_BUS_ADDRESS`. No usa portales de control, dispositivos de entrada
Linux ni eventos globales. Al cerrar, termina su navegador y elimina sólo su
perfil temporal. Esto separa las entradas; CPU, memoria y conexión siguen siendo
recursos compartidos del PC. No es una máquina virtual.

Las capturas locales se guardan por defecto en `artifacts/isolated-browser/`, excluido de
Git. Son evidencias temporales para inspección; no se publican imágenes de Maps
con el juego. Una sesión nueva también exige iniciar sesión por separado en
servicios que lo requieran: no proporciona acceso a Epic.

## Comprobación del 7 de septiembre de 2026

Con Firefox 154.0.1 se entró en Street View desde el trazado azul de Carrera 21.
Se visualizaron **1734 Cra. 21** y **1760 Cra. 21**, ambas fechadas **agosto de
2024**. El segundo panorama coincide con `CIC3DQzywCxaSxfLXZIXOA`, el identificador
del último enlace del usuario. Se giró la cámara mediante arrastre virtual y se
abrió también el encuadre original mediante el enlace de arriba. Con la herramienta
reutilizable, `ArrowUp` mantenida 150 ms cambió de 1760 a 1734 Cra. 21 después
de enfocar el panorama con un arrastre.

La comprobación de proceso confirmó `--headless`, perfil independiente y ausencia
de las cuatro variables del escritorio. Una página local de prueba recibió el
clic, texto, arrastre y una pulsación sostenida de 169 ms para la solicitud de
150 ms. Se rechazaron capturas fuera de `artifacts/` y sobrescrituras. Cinco
sesiones comprobaron cierre por `quit`, fin de entrada, `SIGTERM`, `SIGHUP` y
rotura de la salida (`EPIPE`): en todas
terminó Firefox y se eliminó su perfil. La [verificación registrada](../data/verification/isolated-firefox.json)
separa estas pruebas de la revisión de Maps. El registro visual está en
[`data/field-survey.json`](../data/field-survey.json). No se obtuvieron dimensiones
físicas, ni se completó la reconstrucción de la ciudad. Unreal sigue necesitando
el motor instalado para compilar, ejecutar y transmitir el juego.
