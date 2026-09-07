# Neiva Abierta

Una interpretación jugable de Neiva, Huila, Colombia. Acceso gratuito, personaje
sin nombre, caminata en tercera persona, un carro conducible, tráfico ambiental,
mapa con destinos y un pequeño estudio ficticio para contactar a Jhon Steven
Álvarez Ruiz. Controles de teclado y controles táctiles para celular.

[Jugar en Vercel](https://neiva-abierta.vercel.app/) ·
[Sala de juegos y Bloquitos](https://jhonstevenalvarezruiz.vercel.app/juegos/)

## Alcance de esta versión

La edición web usa Three.js/WebGL 2 y funciona como sitio estático en Vercel.
Las calles, parques y huellas de edificios proceden de datos abiertos. Las
fachadas, alturas ausentes, árboles decorativos, montañas y vehículos se generan
como una interpretación visual. El suelo del juego es plano. No es una réplica
fotográfica ni un levantamiento completo de cada barrio e interior de Neiva.
El estudio mide 6 × 4 × 3,5 metros de juego y no representa una dirección real.

El repositorio incluye también un proyecto C++ para Unreal Engine 5.5, con
Lumen, ciudad procedural, personaje, vehículo, interacción y controles táctiles.
Su código no se ha compilado: Unreal no estaba instalado en el entorno de
construcción. [Preparación y límites de Unreal](docs/UNREAL.md).

Google Photorealistic 3D Tiles puede conectarse mediante Cesium para Unreal.
Se incluye una preparación opcional que requiere plugin, clave API, facturación
y verificar la cobertura real de Neiva. No se han extraído imágenes, mallas ni
fachadas de Google Maps/Street View; los datos de Google no se redistribuyen
bajo la licencia del juego. Publicar Unreal interactivo en navegador requiere
además un servidor GPU y Pixel Streaming; Vercel aloja la edición web.

## Jugar

| Acción | Computador | Celular |
| --- | --- | --- |
| Caminar / conducir | WASD o flechas | Palanca izquierda |
| Mirar | Arrastrar sobre la ciudad | Deslizar sobre la ciudad |
| Correr | Shift | Mantener ⇧ |
| Subir / bajar del carro, visitar estudio | E o botón contextual | E |
| Frenar carro | Espacio | Soltar acelerador |
| Mapa y viaje a un destino | M o Mapa | Mapa |
| Pausar / continuar | Esc o menú | Menú |

El carro dorado es conducible. Los demás vehículos son tráfico ambiental de
recorrido simple; no son una simulación vial completa. Los edificios tienen
colisión de huella; el estudio abre un panel de servicios. Las demás fachadas
no tienen interiores. El botón Inicio recupera una posición transitable.

Hay tres luces del día, calidad gráfica ajustable y descarga de una foto del
recorrido. Los lugares visitados se guardan sólo en localStorage del dispositivo;
si ese almacenamiento no está disponible, se puede seguir jugando. Cambiar de
pestaña limpia las entradas y pausa el juego. No hay cuentas ni multijugador.

## Desarrollo

Node.js 24, npm y un navegador WebGL 2.

```sh
npm ci
npm test
npm run build
npm run dev
```

Abre `http://localhost:4173`. La compilación genera `dist/` y no depende de CDN,
claves ni peticiones externas durante la partida. Las dependencias están fijadas
en `package-lock.json`. `npm run data` actualiza la cartografía: requiere red y
respeta los límites del proveedor. Consulta el pipeline y las fechas en
[MAPAS.md](docs/MAPAS.md). Los datos se sirven con la aplicación y se pueden
descargar dentro del juego.

## Modelo, rendimiento y verificación

Coordenadas locales en metros, X este y Z sur, con origen geográfico declarado
en `public/data/neiva.json`. La proyección equirectangular es una aproximación
local; la precisión posicional de las huellas y alturas estimadas es desconocida.
El juego conserva IDs y procedencia para consultar y sustituir datos.

La velocidad a pie es 3,2 m/s y al correr 6,3 m/s; el carro limita avance a
24 m/s y reversa a 7 m/s. Son parámetros de juego, no medidas del tráfico real.
Las colisiones se consultan con índice espacial y el movimiento se subdivide
cada 0,35 m para impedir atravesar una pared por un salto temporal. Un cuadro
procesa como máximo 50 ms: en equipos lentos la simulación se ralentiza.

La geometría está agrupada por celdas y material. Tiempo y memoria de carga
O(V), para V vértices; consultas de colisión O(K·P), K polígonos locales y P
vértices medios. Las pruebas incluyen paredes delgadas a alta velocidad,
patios, salida obstruida del carro, proyección y validez del mapa. El rendimiento
real depende de GPU, resolución y cobertura visible; no se afirma una tasa de
fotogramas sin medición en el dispositivo.

Umbral funcional: cero errores JavaScript, movimiento comprobable, entrada/salida
del vehículo, panel de contacto accesible y cero desbordamiento horizontal a
320/390 px. Las comprobaciones de navegador se ejecutan con
`node scripts/check-browser.mjs` contra un servidor local. Consulte el resultado
de la ejecución en la entrega; Unreal requiere su validación independiente.

## Licencias y fuentes

Código original: [MIT](LICENSE). Three.js: MIT. Unreal Engine conserva la
licencia de Epic y no está incluido. Datos y atribuciones: [MAPAS.md](docs/MAPAS.md).
El código abierto del juego no cambia la licencia de los proveedores externos.
