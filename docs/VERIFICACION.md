# Verificación de la edición 0.3

Revisión del 7 de septiembre de 2026, hora de Colombia. La edición incorpora
una capa de revisión del centro, modelos específicos del Palacio de Justicia,
Hotel Neiva Plaza y Templo Colonial, corrección de la aguja de la Catedral,
pavimento y fuente del Santander, vegetación más densa, carrera animada,
Pointer Lock, ajustes de sensibilidad y ambiente después de lluvia.

## Comprobaciones de datos y código

- 30 pruebas Node aprobadas: cartografía, física, aplicación no destructiva de
  la revisión urbana y nueve casos de cámara/captura de mouse.
- 7 pruebas Python del contrato de importación de arte para Unreal aprobadas.
  El contrato comprueba fuentes e importación prevista; no compila Unreal.
- SHA-256 del mapa base conservado. Las dos exclusiones residenciales afectan
  también las colisiones. Sólo el segmento de Calle 7 frente al Santander cambia
  a adoquín. Las alturas corregidas conservan la altura original y se marcan
  como estimadas.
- Geometría cívica comprobada sin coordenadas, normales ni UV no finitas; 38
  mallas y 45 árboles entre parque y plazoleta. La aguja mantiene la altura
  nominal OSM de 33 m, que no equivale a una medida verificada.
- Raycast posterior del Templo Colonial: la tapa bajo el tejado recibe el rayo
  a 3 m, donde antes existía una abertura accidental.
- La fuente comparte su contorno irregular entre render y colisión, sin una
  barrera circular mayor que el vaso. Los postes de la cubierta y los troncos
  cívicos tienen colisión; el centro de la cubierta permanece transitable.
- Fuentes y hashes del HDR cubierto y la animación de carrera verificados.
  El automóvil mantiene sus 213.347 triángulos y reduce sus mallas de 97 a 45.

## Recorrido integrado en navegador

`HEADLESS=1 node scripts/check-browser.mjs` terminó con código 0 contra el
build local. El renderer efectivo fue Intel UHD, sin render por software.

| Comprobación | Resultado observado |
| --- | --- |
| Escritorio 1440 × 960 | Carga inicial 12.379 ms; versión `0.3-wet-city` |
| Mouse | Captura real al entrar; giro sin pulsar; Esc pausa y libera |
| Carrera | 2 m/s caminando, 5,4 m/s corriendo |
| Automóvil | Entrada, avance, frenado de 5,76 a 0,34 m/s y salida segura |
| Menús | Mapa, sensibilidad, clima, calidad, hora y pantalla completa |
| Destinos revisados | Lista de los cuatro edificios; viaje a Palacio y Colonial sin quedar dentro de colisiones |
| Contacto y foto | Panel del estudio, enlace mailto y PNG descargado; ningún correo enviado |
| Móvil emulado 320 × 844 y 390 × 844 | Palanca, carrera 5,4 m/s, botón de carrera, cámara táctil, estudio y viajes |
| Controles móviles | Todos los comprobados dentro de pantalla y de al menos 44 px; desbordamiento horizontal 0 |
| Errores no controlados y recursos fallidos | 0 errores JavaScript/console.error y 0 respuestas HTTP ≥400 en los tres recorridos |

Las cargas móviles observadas fueron 7.161 y 7.172 ms, respectivamente, en
el mismo equipo, sin limitar red ni emular potencia de un teléfono. Son una
observación por tamaño. Los resultados detallados están en
`artifacts/browser-results.json`, con capturas de escritorio y móvil.

## Diagnóstico gráfico

Los shaders de asfalto mojado y reflexión planar se compilaron sin errores JS/GL
con Chrome y GPU Mesa Intel UHD Graphics ADL-S GT0.5. Las capturas del canvas
comprueban que los charcos reflejan geometría de la escena. El pase se programa
antes del render principal para evitar contaminar la refracción del automóvil.

Un diagnóstico aislado a 1440 × 960, DPR 1 y calidad Auto tomó doce muestras por
ambiente con espera de finalización de GPU: media de 16,13 ms en seco y 22,43 ms
después de lluvia. Las capturas de reflexión produjeron picos de 38–45 ms.
Son muestras de una escena durante la integración, no una medición completa de
la partida final ni una garantía de FPS. La simulación, el HUD y la carga tienen
costes adicionales. Auto omite AO en GPU integrada y móvil; Alta lo activa.

Los teléfonos se comprueban mediante emulación de entrada táctil y viewport;
no se han probado dispositivos físicos. La reconstrucción conserva un suelo
plano, tráfico de recorridos simples y exteriores interpretados. Estas pruebas
no certifican una réplica exacta de cada barrio, fachada o interior.

## Reproducir

```sh
npm ci
npm test
npm run build
python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests -v
```

Con `dist/` servido en el puerto 4173:

```sh
node scripts/check-browser.mjs
```

Contra el deployment público:

```sh
GAME_TEST_URL=https://neiva-abierta.vercel.app node scripts/check-browser.mjs
```

El script escribe capturas y resultados en `artifacts/`, excluido de Git.
Necesita Chrome. `HEADLESS=1` activa los argumentos de GPU que se comprobaron
con Intel UHD en este entorno; el script registra el renderer efectivo. Esa
configuración no garantiza aceleración en otro equipo. Pointer Lock se verifica
por `document.pointerLockElement` y movimientos reales del mouse del navegador,
no mediante una bandera simulada.

La batería distingue un rechazo nativo por exceso de solicitudes de un fallo
de la aplicación. [Chromium documentó una corrección de su limitador el
31 de agosto de 2026](https://chromium.googlesource.com/chromium/src/third_party/+/044cd9be23eca0c909c7a0c60c047ab7e1a669f1%5E%21/).
Ante ese rechazo concreto, se comprueba que mover el mouse sin botón sigue
girando la cámara y que un clic posterior recupera la captura. No se desactiva
la protección del navegador ni se fuerza una recaptura automática.

El proyecto C++ de Unreal sigue sin compilar en este entorno. La publicación
Vercel corresponde a la edición Three.js/WebGL.
