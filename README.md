# Neiva Abierta

**Alfa Unreal 0.3.0 para Linux x86_64.** Explora Neiva a pie o en coche,
con un personaje anónimo, ocho peatones y conversaciones con siete clips de
voz sintética sobre Jhon y sus servicios. La lluvia llega por ciclos y las
superficies se mojan y secan gradualmente. Creada y empaquetada con
**Unreal Engine 5.5.4**.

[Descargar gratis la alfa Linux 0.3](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.3.0-linux-alpha)

La copia pública se descargó sin credenciales y pasó **19 comprobaciones de
juego y seis de integridad**, con cierre normal. Se revisó a 1080p en una
RTX 4050 Laptop con límite de 30 FPS; no es un benchmark sin límite.
El archivo preparado es `Neiva-Abierta-Unreal-0.3.0-Linux-x64.tar.gz`.
[Estado del paquete](data/verification/unreal-03.json) ·
[Comprobación de la descarga](data/verification/unreal-03-download.json).

Extrae el archivo completo y, desde la carpeta extraída, ejecuta:

```sh
./Jugar-Neiva.sh
```

Conserva `Linux/` junto al lanzador. No necesitas instalar el editor para jugar.
Se requiere Linux x86_64 con GPU y controlador Vulkan; los requisitos mínimos
no están establecidos. **No hay ejecutables Windows, macOS ni móviles de esta
entrega.** [Estado de plataformas](docs/PLATAFORMAS.md).

**Controles:** WASD para caminar o conducir; ratón para mirar; Shift para
correr; Espacio para saltar o frenar; E para conversar, entrar o salir del coche;
1–4 o botones para elegir tema; C/V para cambiar colores de ropa; R para volver
al inicio; Esc/P para pausar. E/Esc/P cierran primero una conversación activa.

La versión 0.3 añade **17.696 alturas estimadas de Google Research 2023 y una
revisión manual separada**, con procedencia conservada; se retiró el edificio
ficticio. El contacto de Jhon está en los diálogos. La ciudad conserva 35.873
huellas y cuatro hitos interpretados. **No es una réplica idéntica ni una ciudad
con calidad visual AAA:** hay fachadas y alturas estimadas, terreno plano e
interiores pendientes. Los avisos VSM tampoco se consideran resueltos.
[Reconstrucción y límites](docs/RECONSTRUCCION-0.3.md) ·
[Clima y diálogos](docs/CLIMA-DIALOGOS-0.3.md).

[Ficha del proyecto y vídeo](https://jhonstevenalvarezruiz.vercel.app/proyectos/neiva-abierta/#descarga-unreal) ·
[Juegos: Neiva Abierta y Bloquitos](https://jhonstevenalvarezruiz.vercel.app/juegos/).
La ficha se adapta a móvil; el ejecutable es para Linux. El vídeo de revisión
0.3 incluye audio y se recodifica desde MediaRecorder a 30 FPS; esa cadencia
no mide el rendimiento original. Las PNG conservan la captura nativa.
No se realizó una prueba auditiva humana.

Para reconstruir esta versión, sigue el
[orden de importación y horneado](docs/UNREAL.md#orden-completo-desde-un-clon-limpio).
`scripts/unreal.py package` ejecuta la importación base, clima y voces; los
árboles y bancos CC0 y el horneado de hitos requieren los pasos previos
indicados. [Proyecto y controles](docs/UNREAL.md) ·
[Distribución, tamaño y SHA-256](docs/DISTRIBUCION.md) ·
[Consulta aislada de referencias](docs/NAVEGACION-AISLADA.md).

### Historial de la alfa 0.2

La [descarga anterior 0.2](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.2.0-linux-alpha)
se verificó por tamaño y hash y se ejecutó a 1080p en una RTX 4050 Laptop.
Su muestra del parque promedió 21,14 ms por cuadro (47,31 FPS derivados) con
límite de 60. **Esa medición pertenece a 0.2, no a 0.3 ni a otros equipos.**
[Recibo histórico](data/verification/unreal-visual-download.json) ·
[Mejoras y mediciones de 0.2](docs/MEJORA-VISUAL-0.2.md).

## Prototipo web anterior 0.4 · Three.js

La descripción, captura, controles y mediciones web siguientes corresponden
al prototipo Three.js 0.4. Sus pruebas no acreditan el ejecutable Unreal.

Una interpretación jugable de Neiva, Huila, Colombia. Acceso gratuito, personaje
sin nombre, caminata en tercera persona, un carro conducible, tráfico ambiental,
mapa con destinos y un pequeño estudio ficticio para contactar a Jhon Steven
Álvarez Ruiz. Controles de teclado y controles táctiles para celular.

[Jugar al prototipo web anterior](https://neiva-abierta.vercel.app/) ·
[Sala de juegos y Bloquitos](https://jhonstevenalvarezruiz.vercel.app/juegos/)

![Captura del prototipo Three.js 0.4: personaje en el Santander, Catedral, hotel y fuente](public/preview.webp)

## Alcance del prototipo web 0.4

La edición web usa Three.js/WebGL 2 y funciona como sitio estático en Vercel.
Las calles, parques y huellas de edificios proceden de datos abiertos. Las
alturas ausentes, fachadas y árboles son una interpretación visual. La edición
0.4 usa un personaje humano animado de Microsoft Rocketbox, el automóvil
Car Concept de Khronos, mapas PBR fotográficos de Poly Haven, iluminación HDR,
sombras solares y fachadas de apariencia fotográfica generadas con IA. La
Catedral de la Inmaculada Concepción tiene una malla arquitectónica específica
con arcos, torre, reloj y cubiertas. El Palacio de Justicia, el Hotel Neiva Plaza
y el Templo Colonial tienen modelos específicos apoyados en referencias del
centro; el Santander incorpora pavimento, fuente de mosaico y vegetación densa.
La [revisión de fidelidad](docs/FIDELIDAD.md) registra las fuentes y los detalles
todavía estimados. Se corrigieron dos extrusiones residenciales sin respaldo
dentro del parque y el material de Calle 7 en su borde sur. El resto de edificios
conserva huellas cartográficas y recibe fachadas, aleros y tejados representativos.
La edición 0.4 corrige 22 cubiertas abiertas que se interpretaban como edificios
cerrados (14 asociadas a gasolineras); conserva sus huellas y estima los soportes.
Se repara además una huella cuyo redondeo había introducido un autocruce.
El suelo del juego es plano. No es una réplica
fotográfica ni un levantamiento completo de cada barrio e interior de Neiva.
El estudio mide 6 × 4 × 3,5 metros de juego y no representa una dirección real.

La alfa Unreal descargable tiene sus propios controles y pruebas, descritos
al inicio de esta página y en [UNREAL.md](docs/UNREAL.md). La captura y las
funciones de esta sección pertenecen al prototipo web anterior.

Google Photorealistic 3D Tiles puede conectarse mediante Cesium para Unreal.
Se incluye una preparación opcional que requiere plugin, clave API, facturación
y verificar la cobertura real de Neiva. No se han extraído imágenes, mallas ni
fachadas de Google Maps/Street View; los datos de Google no se redistribuyen
bajo la licencia del juego. Publicar Unreal interactivo en navegador requiere
además un servidor GPU y Pixel Streaming; Vercel aloja la edición web.

## Controles del prototipo web 0.4

| Acción | Computador | Celular |
| --- | --- | --- |
| Caminar / conducir | WASD o flechas | Palanca izquierda |
| Mirar | Mover el mouse, sin mantener clic | Deslizar sobre la ciudad |
| Correr | Mantener Shift | Tocar Correr para activar/desactivar |
| Observar un lugar, subir / bajar del carro, visitar estudio | E o botón contextual | E |
| Frenar carro | Espacio | Mantener Freno |
| Mapa, guía y viaje directo | M o Mapa | Mapa |
| Medidas y fuente del edificio que miras | I | Ver edificio (⌕) |
| Pausar / continuar | Esc o menú | Menú |
| Sensibilidad | C o ajustes | Ajustes |
| Pantalla completa | F | Ajustes, cuando el navegador lo admita |

Entrar a la ciudad solicita la captura del mouse mediante Pointer Lock. Escape
suelta el cursor y pausa; continuar vuelve a capturarlo con un gesto del usuario.
Los diálogos también liberan el mouse. Si el navegador deniega la captura, la
cámara sigue el mouse sobre el canvas sin arrastrar, y un clic reintenta la captura.

El carro dorado es conducible. Los demás vehículos son tráfico ambiental de
recorrido simple; no son una simulación vial completa. Los edificios tienen
colisión de huella; las cubiertas abiertas bloquean sólo sus soportes estimados; el estudio abre un panel de servicios. Las demás fachadas
no tienen interiores. El botón Inicio recupera una posición transitable.

Hay tres luces del día, ambiente seco o después de lluvia (tecla L), reflejos
locales en charcos, calidad gráfica ajustable y descarga de una foto del
recorrido. Elegir un destino activa una guía de dirección y distancia en línea recta.
Observar una parada exige acercarse a pie y pulsar E; pasar cerca ya no suma
visitas. La acción Viajar del mapa sigue ofreciendo traslado directo. El
inspector I muestra área y dimensiones de la huella, procedencia y altura
representada, identificando las estimaciones. Su enlace a Street View abre
Google Maps para comparar la referencia disponible, sin incorporarla al juego.
Las observaciones se guardan sólo en localStorage del dispositivo (clave v2);
si ese almacenamiento no está disponible, se puede seguir jugando. Cambiar de
pestaña limpia las entradas y pausa el juego. No hay cuentas ni multijugador.

## Desarrollo del prototipo web

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

## Modelo, rendimiento y verificación del prototipo web

Coordenadas locales en metros, X este y Z sur, con origen geográfico declarado
en `public/data/neiva.json`. La proyección equirectangular es una aproximación
local; la precisión posicional de las huellas y alturas estimadas es desconocida.
El juego conserva IDs y procedencia para consultar y sustituir datos.

La velocidad a pie es 2 m/s y al correr 5,4 m/s; las animaciones de espera,
caminata y carrera se mezclan según el desplazamiento efectivo. El carro limita avance a
20 m/s y reversa a 4,5 m/s, con dirección gradual y frenada de 10 m/s². Son parámetros de juego, no medidas del tráfico real.
Las colisiones se consultan con índice espacial y el movimiento se subdivide
cada 0,35 m para impedir atravesar una pared por un salto temporal. La simulación usa pasos fijos de 1/60 s e interpola las posiciones al dibujar.
Elimina el antiguo límite de 50 ms por cuadro, que ralentizaba el desplazamiento
por debajo de 20 FPS. Un cuadro puede procesar 120 pasos; un exceso queda como
tiempo pendiente y se muestra en el diagnóstico, sin descartarlo. La pausa y
la pérdida de foco reinician el reloj. [Dinámicas y pruebas](docs/JUGABILIDAD.md).

La geometría está agrupada por celdas y material. La edición 0.4 limita el
detalle y las sombras por distancia, conserva matrices de elementos estáticos
y adapta la resolución en Auto según intervalos reales entre cuadros. Los
reflejos usan una captura local y los menús se dibujan hasta 15 veces por
segundo sin contar esa pausa como lentitud de GPU. El minimapa cachea hasta
16 mosaicos (4 MiB de píxeles) y el atlas se dibuja una vez por tamaño. La vía
más cercana se resuelve mediante un índice exacto de segmentos.
[Rendimiento medido y límites](docs/RENDIMIENTO.md). Tiempo y memoria de carga
O(V), para V vértices; consultas de colisión O(K·P), K polígonos locales y P
vértices medios. Las pruebas incluyen paredes delgadas a alta velocidad,
patios, salida obstruida del carro, proyección y validez del mapa. El rendimiento
real depende de GPU, resolución y cobertura visible; no se afirma una tasa de
fotogramas sin medición en el dispositivo.

[Actores y licencias](docs/ACTORES.md) · [Materiales](docs/MATERIALES.md) ·
[Fachadas generadas y prompts](docs/FACHADAS-GENERADAS.md) ·
[Catedral](docs/LUGARES-MODELADOS.md) · [Revisión del centro](docs/FIDELIDAD.md) ·
[Clima y reflejos](docs/CLIMA.md).

Umbral funcional: cero errores JavaScript, movimiento comprobable, entrada/salida
del vehículo, panel de contacto accesible y cero desbordamiento horizontal a
320/390 px. Las comprobaciones de navegador se ejecutan con
`HEADLESS=1 node scripts/check-browser.mjs` contra un servidor local (Chrome
con GPU habilitada). Consulte el resultado
de la ejecución en la entrega; Unreal requiere su validación independiente.

## Licencias y fuentes

Código original: [MIT](LICENSE). Three.js: MIT. Unreal Engine conserva la
licencia de Epic: la descarga nativa incorpora su runtime, no el editor ni el
código fuente del motor. Datos y atribuciones: [MAPAS.md](docs/MAPAS.md).
Personaje Microsoft Rocketbox: MIT; automóvil Car Concept de Eric Chadwick,
Darmstadt Graphics Group GmbH, 2024: CC BY 4.0, con sus condiciones de marcas
conservadas. Materiales y HDR de Poly Haven: CC0. Las [voces sintéticas](public/audio/dialogue/README.md) conservan su procedencia y ficha de origen. Atribuciones también disponibles
en `Licenses/` dentro de la descarga nativa y en Sobre este mundo del prototipo
web. El código abierto del juego no cambia
la licencia de los proveedores externos.
