# Verificación de la edición 0.4

Comprobaciones del 7 de septiembre de 2026. La edición corrige el reloj de
movimiento, añade aceleración y frenado graduales, observación explícita,
guía de destinos, consulta de medidas y procedencia por edificio y una capa
que conserva 22 cubiertas abiertas. Los cambios gráficos reducen trabajo de
CPU/GPU; el equipo integrado probado sigue limitado a unos 15–19 FPS.

## Datos, simulación y código

- 73 pruebas Node aprobadas: cartografía, colisiones, cámara, reloj fijo,
  aceleración, frenado, observaciones, índices, caché, procedencia y render.
- 7 pruebas Python de preparación de arte para Unreal aprobadas. No compilan
  ni ejecutan el motor, que no está instalado en este entorno.
- Se conserva el SHA-256 del archivo base: `e0ac42dbc49921439f80fb25081a7c9760e80c8296e835f48b0229135788f846`.
  La capa estructural mantiene 22 huellas y aplica colisión a 86 soportes
  estimados. Once accesos viales antes bloqueados son transitables en la prueba.
  Un autocruce debido al redondeo se repara desde el anillo Overture original.
- Caminar/correr y conducir/girar/frenar conservan trayectorias iguales a
  15/30/60/120 FPS, con diferencia máxima permitida de `10⁻⁸ m`. El reloj
  conserva tiempo pendiente y se reinicia al pausar; no reproduce tiempo oculto.
- Frenar desde 12 m/s a 10 m/s² recorre 7,2 m, con tolerancia `10⁻⁶ m`.
  Las colisiones no añaden velocidad ni dejan impulso acumulado contra paredes.
- El índice de vías coincide con la búsqueda exhaustiva en 204 consultas del
  recorte real revisado. Las consultas locales recorren una fracción de sus
  35.370 segmentos, respetando el orden de desempate.
- El minimapa no repinta geometría con caché caliente; conserva como máximo
  16 mosaicos, 4 MiB de píxeles. El atlas reutiliza hasta dos tamaños.
- El inspector distingue huella y altura estimada; un `height` de OSM tampoco
  se anuncia como medido. Un rayo bajo una cubierta abierta puede llegar al
  edificio de detrás: sólo la losa y sus soportes interceptan la consulta.

## Navegador integrado

La batería `HEADLESS=1 node scripts/check-browser.mjs` terminó con código 0,
Chrome y GPU Intel real. El [resultado completo](../data/verification/browser-0.4.json)
conserva controles, estados, medidas, URL de Street View y errores por viewport.

| Comprobación | Resultado |
| --- | --- |
| Escritorio 1440 × 960 | Versión `0.4-adaptive-city`, movimiento 2,00 m/s y carrera 5,40 m/s |
| Mouse | Captura nativa, movimiento sin botón, Esc pausa y libera; sensibilidad y pantalla completa |
| Pausa | La posición no avanza aunque se mantenga W; continuar reinicia las entradas |
| Automóvil | Entrar, acelerar, frenar de 5,00 a unos 0,17 m/s y bajar en un punto libre |
| Guía | Elegir destino conserva la posición; distancia en línea recta y dirección visibles |
| Observación | Pasar cerca no registra progreso; E abre las fichas de Palacio, Colonial y Santander con fuentes |
| Inspector | Muestra el edificio observado, medidas cartográficas y enlace oficial de Street View con posición y orientación |
| Mapa | Viajes válidos, caché de mosaicos caliente y atlas reutilizado |
| Móvil emulado 320 y 390 × 844 | Palanca, carrera, cámara táctil, mapa, guía, observación, viajes y estudio |
| Controles móviles | Dimensiones comprobadas de al menos 44 px, dentro del viewport; desbordamiento horizontal cero |
| Contacto y captura | Panel de servicios y enlace mailto inspeccionados; PNG descargado; no se envía correo |
| Errores | Cero errores JavaScript/console.error y cero respuestas HTTP ≥400 en los tres recorridos |

Dos rechazos nativos por ráfaga de solicitudes de Pointer Lock activaron el
fallback previsto. Se comprobó que el mouse sigue mirando sin botón y que
un clic posterior recupera la captura; no se fuerza una recaptura automática.
[Chromium documentó la corrección de su limitador en agosto de 2026](https://chromium.googlesource.com/chromium/src/third_party/+/044cd9be23eca0c909c7a0c60c047ab7e1a669f1%5E%21/).

La cámara táctil se verifica mediante un deslizamiento continuo de seis pasos
que dura unos 210 ms. Un salto sintético instantáneo de 48 píxeles suprimía el
clic nativo posterior en Chrome; la traza mostró eventos táctiles y liberación
de captura correctos. No se añadieron listeners alternativos al juego ni
reintentos ciegos para ocultar ese resultado del generador de gestos.

La revisión visual adicional corrigió puntos blancos en el follaje de calidad
Alta: `alphaToCoverage` se mantenía activo en un destino del compositor sin
MSAA. Alta utiliza ahora recorte alfa normal; Auto conserva la cobertura del
canvas con MSAA. En la misma cámara y región de follaje de 215.000 píxeles,
los casi blancos pasaron de 21.484 a cero al cambiar únicamente esa propiedad
([diagnóstico](../data/verification/foliage-0.4.json)). Se verificaron la vuelta a
Auto y capturas de Alta en seco y después de lluvia. La imagen pública
`public/preview.webp` es una captura real de Alta, 1440 × 960, convertida a
WebP sin retoque; no implica que ese modo mantenga FPS altos en el equipo probado.

La emulación comprueba tamaños y entradas, no potencia de teléfonos físicos.
La [medición completa de rendimiento](RENDIMIENTO.md) publica muestras y límites:
CPU por cuadro menor, resolución Auto reducida y FPS sin mejora universal.
No se afirma hiperrealismo ni reconstrucción idéntica de todos los barrios.
El terreno sigue plano y las fachadas no documentadas son interpretaciones.

## Reproducir

```sh
npm ci
npm test
npm run build
python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests -v
python3 -m http.server 4173 --directory dist
```

Con ese servidor en otra terminal:

```sh
HEADLESS=1 node scripts/check-browser.mjs
```

Para la publicación:

```sh
HEADLESS=1 GAME_TEST_URL=https://neiva-abierta.vercel.app GAME_TEST_ARTIFACT_DIR=artifacts/production-0.4 node scripts/check-browser.mjs
```

El runner escribe capturas y JSON en `artifacts/`, excluido de Git. La copia
local verificada del JSON está versionada arriba. Los resultados de producción
se contrastan después de publicar. El proyecto Unreal requiere compilación y
validación propias; Vercel ejecuta la edición Three.js/WebGL.
