# Mejora visual 0.2: evidencia y trabajo pendiente

La versión 0.2 está **en desarrollo: todavía no está empaquetada ni publicada**. Este documento recoge pruebas del 7 y 8 de septiembre de 2026 UTC en Unreal Engine 5.5.4, ejecutando `UnrealEditor -game` en Linux con Vulkan SM6. La evidencia histórica de la alfa 0.1.0 conserva su alcance y no acredita esta nueva versión.

El registro estructurado está en [unreal-visual-upgrade.json](../data/verification/unreal-visual-upgrade.json). Contiene hashes, fechas, métricas y referencias a los artefactos locales. Las rutas `artifacts/` y `Saved/` son evidencias de trabajo; su inclusión en el registro no significa que estén publicadas.

## Cambios comprobados

- **Personaje:** se guardaron los materiales PBR de cuerpo, cabeza y transparencias con sus texturas y máscara de ropa. Otro proceso del Editor volvió a abrir la malla y verificó las asignaciones persistidas. Las capturas nativas posteriores muestran piel y ropa; no se ha validado cada combinación de apariencia.
- **Parque:** se importaron una jacaranda y un banco modular de Poly Haven, con licencia CC0, materiales y colisión. El registro nativo confirma **15 árboles y 6 bancos** colocados. Las posiciones, alturas y elección de especie son interpretadas; no constituyen un inventario de Parque Santander. Fuentes: [jacaranda](https://polyhaven.com/a/jacaranda_tree), [banco modular](https://polyhaven.com/a/modular_street_seating).
- **Hotel Neiva Plaza:** los dos frentes usados como referencia tienen tratamientos diferenciados, tres hileras de habitaciones, galería superior abierta, esquina ocre maciza y huecos profundos. Se mantienen la huella OSM y los **19,8 m estimados**. Se eliminaron tapas interiores coplanares que duplicaban triángulos durante la conversión nativa.
- **Catedral:** las hojas inferiores de las puertas se separan del vidrio y la tracería superiores; el frontón central ya no tapa la ojiva. Se mantienen la huella y la silueta de **33 m nominales de OSM**, más el desplazamiento vertical de 0,035 m del modelo. Los detalles no son medidas de campo.

La geometría detallada se exportó con **47 secciones y 71.311 triángulos**. El bake completo produjo **150 partes StaticMesh, 149 con Nanite**, y tres rótulos nativos. La compilación de activos terminó antes de guardar el resultado; el juego confirmó después la carga de esos conteos y el hash de origen. Esto corresponde a los hitos y superficies cívicas detalladas: **no significa que las 35.873 huellas de la ciudad estén convertidas a Nanite**.

SHA-256 de la geometría exportada: `93306e220a0863a274eb1992f7e4bfd8024ed493180c38015bc9cd046e4912fd`.

Las referencias y parámetros interpretados del hotel y la Catedral se detallan en [HITOS-REVISION-VISUAL.md](HITOS-REVISION-VISUAL.md). Las dos vistas siguientes no sustituyen una revisión frontal completa de ambos edificios.

## Imágenes nativas observadas

Las observaciones `on4WtW` —19:29:02 UTC— y `mjWR8q` —19:31:14 UTC— contienen cuadros originales de **1920 × 1080**, obtenidos del vídeo WebRTC del juego, sin reescalado ni edición visual. La primera incluye la secuencia de conducción y un WebM VP8 de 3.549.226 bytes; la segunda gira la vista hacia el parque. El proceso y los estados del personaje se contrastan con el registro nativo: el navegador por sí solo no identifica el motor ni valida la jugabilidad.

- [Cuadro de juego después de la ruta](../artifacts/unreal-native/stream-observations/observation-on4WtW/after-native.png).
- [Vista hacia el parque](../artifacts/unreal-native/stream-observations/observation-mjWR8q/after-native.png).

El personaje y los árboles ya aparecen en la ejecución nativa. En estas capturas históricas A siguen visibles avisos de solapamiento de páginas VSM; las fachadas del fondo repiten el mismo patrón y el dosel del parque sigue siendo más escaso que en las fotografías de referencia. No se presenta esta revisión como calidad AAA, calidad comparable a Cyberpunk ni reconstrucción idéntica de Neiva.

Las pruebas posteriores conservan otros cuadros originales 1080p:

- [B2 después de caminar y conducir](../artifacts/unreal-native/stream-observations/observation-bV5OxL/after-native.png), observación iniciada el **8 de septiembre, 05:10:36 UTC**. El personaje aparece vestido junto al hotel; el aviso VSM sigue visible.
- [B4 mirando hacia el parque](../artifacts/unreal-native/stream-observations/observation-yxNIeO/after-native.png), **05:17:16 UTC**. Se ven personaje, árboles y bancos; no hay aviso VSM en este cuadro. Permanecen fachadas genéricas repetidas y una copa más escasa que la referencia.

La hora de inicio del observador no equivale a la hora exacta de cada cuadro. Los informes, hashes y comandos se conservan por sesión. B2 y B4 recibieron vídeo continuo; estas dos observaciones no generaron un WebM.

## Rendimiento medido en A

Se recomputaron los promedios de `FrameTime` directamente desde los CSV del motor. La ejecución A usó 1080p, escala de render del 100 %, límite configurado de 30 FPS, ventana en pantalla virtual privada y transmisión VP8. Son muestras cortas de un solo equipo, no resultados del futuro paquete 0.2.

| Muestra | Frames analizados | FrameTime medio | RenderThread medio | GPUTime medio |
| --- | ---: | ---: | ---: | ---: |
| A con cliente de transmisión | 396 | **52,14 ms** | 51,06 ms | **19,44 ms** |
| A sin cliente conectado | 300, después de omitir 60 iniciales | **49,17 ms** | 48,72 ms | 20,05 ms |

Los tiempos medios de frame equivalen a aproximadamente **19,18 y 20,34 frames por segundo**, respectivamente. La tasa recibida por WebRTC en `on4WtW` fue de 20,23 frames decodificados por segundo; es otra métrica y no se usa como medida del renderizador. `GPUTime` no es el tiempo total del frame, y `RenderThreadTime` incluye esperas. Estas muestras no prueban 60 FPS, no aíslan causalmente el coste de transmitir vídeo y no permiten deducir consumo de VRAM.

CSV usados: `Saved/Profiling/CSV/Profile(20260907_142907).csv` y `Profile(20260907_143529).csv`, bajo el proyecto Unreal. El manifiesto registra sus hashes y los resúmenes completos.

## Prueba B inicial fallida

La prueba B combinó `-RenderOffScreen` con sectores urbanos de 100 m. El registro llegó a anunciar 5.513 secciones de edificios y tres peatones, pero terminó con **código 139 antes de obtener un cuadro de juego verificable**. Vulkan produjo la aserción `ResourceIndex < State.MaxDescriptorCount` para `VK_DESCRIPTOR_TYPE_UNIFORM_TEXEL_BUFFER`.

La fuente local de UE 5.5 define por defecto **64 × 1024 descriptores** para ese tipo de recurso. Se trata de un límite del conjunto de descriptores, no de una medición de VRAM agotada. No se atribuye la causa exclusivamente al modo offscreen. B no aporta un benchmark válido ni confirma el funcionamiento de los peatones adicionales. Las ejecuciones corregidas B2 y B4 siguientes se registran separadamente; este fallo no se reescribe como éxito.

## B2 y B4: sectores corregidos y ejecución offscreen

Ambas sesiones cargaron **35.873 edificios en 682 secciones**: sectores de **100 m cerca del inicio y 500 m lejos**, con radio fino de 500 m. Son 567 edificios procedurales en la zona cercana y 35.302 en la lejana. No se afirma que toda la ciudad funcione subdividida a 100 m. El log confirma además los 150 hitos horneados, 15 árboles, seis bancos y **3 de 8 peatones solicitados**; los puntos bloqueados se omitieron. Esto comprueba su creación en una partida real, no el recorrido individual completo de cada peatón.

B2 usó `-RenderOffScreen`, Vulkan SM6, 1920 × 1080, escala del 100 %, límite de 30 FPS y transmisión VP8. La observación `bV5OxL` se contrastó con el log nativo: caminata, entrada al coche, desplazamiento de **4,800 m**, velocidad del coche a cero tras frenar, salida y retorno al modo `WALKING`. El coche pasó de `X=-87740; Y=8250; Z=70` a `X=-87293.950; Y=8427.312; Z=70` cm de Unreal. El envío de teclas por sí solo no se contó como prueba. Los avisos VSM persistieron en B2.

B4 mantuvo esa configuración de render y fijó los sesgos de resolución de sombras direccionales, estático y en movimiento, en **0,5**. La vista al parque registró yaw 145° y pitch −5° en `NeivaState`. El log completo de B4 y la captura revisada no contienen el aviso VSM; esto no demuestra que haya desaparecido en todas las rutas de la ciudad.

Los valores siguientes se recomputaron desde los CSV del motor, conservando todas las filas numéricas:

| Muestra | Frames | Límite configurado | FrameTime medio | FrameTime p95 | GPU/Total medio |
| --- | ---: | ---: | ---: | ---: | ---: |
| B2 con caminata/conducción | 613 | 30 FPS | **33,3448 ms** | 34,2638 ms | **17,7389 ms** |
| B4 mirando al parque | 362 | 30 FPS | **34,0319 ms** | 41,4260 ms | **17,1223 ms** |
| B4, muestra posterior de vista fija | 694 | 60 FPS | **17,7711 ms** | 22,9893 ms | **Excluido: contador inconsistente** |

La columna `GPUTime` vale cero en las tres muestras offscreen y **no es una medición válida de coste GPU**. En la última muestra, también se excluye `GPU/Total`: abundan valores de 0,061 ms y su resultado no es coherente como temporización GPU. Los resúmenes conservan los contadores originales para auditoría; no se usan esos ceros para anunciar una mejora de GPU.

Los tiempos medios de frame equivalen a **29,99 / 29,38 / 56,27 FPS derivados**, respectivamente. La prueba de límite 60 corresponde a `observation-kK4sYS`, iniciada a las 05:19:37 UTC, y a `Profile(20260908_001944).csv`. Fue una vista fija breve, no una prueba de conducción sostenida a 60 FPS. WebRTC siguió configurado para 30 FPS y recibió 29,89 FPS: esa tasa no limita ni mide directamente el render nativo. Los cambios de cámara, sectores, modo de presentación y sombras impiden atribuir toda la diferencia respecto de A a un único factor.

B4 terminó mediante el comando nativo **Quit**, con código **0**, salida registrada en el log, ningún fallo fatal observado y ningún miembro restante del grupo de procesos propio. El recibo `editor-game-visual-B4/termination-verified.json` se comprobó a las 05:21:38 UTC. Esta salida se diferencia del cierre del wrapper B2, que no acreditó por sí solo la terminación del motor.

El monitor `vram-B4.csv` contiene 120 muestras de memoria total de la GPU: **133 MiB** al inicio, máximo **4.491 MiB** durante arranque/observación y **4.156 MiB** al final del intervalo; tras salir volvió a 133 MiB. Son lecturas de toda la tarjeta, no memoria exclusiva del proceso ni una inferencia desde FPS. No establecen requisitos mínimos ni rendimiento en otros dispositivos.

## B3: fallo de memoria conservado

Entre B2 y B4, B3 terminó con **código 139 antes de obtener un cuadro verificable**. El log registra `Out of memory on Vulkan`, intentando una asignación de 128 MB. Al arrancar, el presupuesto reportado para el heap de GPU era **1.506,88 MB**, frente a **5.527,81 MB** en B2; B4 arrancó después con unos 5.527 MB y 133 MiB de memoria ocupada en el monitor.

En esa transición se detectó que terminar el wrapper de B2 no garantizaba que el motor anterior hubiera salido. Es un riesgo de cierre que se documenta, **no prueba suficiente para atribuirle por sí solo el fallo B3**. B4 completó la ejecución con los mismos argumentos de lanzamiento que B3. No se culpa al ajuste de sombras ni se declara resuelta de forma general cualquier falta de memoria.

## Validación y fases pendientes

El último conjunto previo al empaquetado pasó **103 pruebas Node, 41 pruebas Python de los scripts nativos y 57 pruebas Python de la raíz: 201 en total**. Incluyen reproducción byte a byte de los hitos, orientación de triángulos, conservación de normales/UV y comprobaciones de topología. `npm run build` también pasó para el prototipo web anterior; no acredita un paquete Unreal. Los logs `node-tests-final-20260908.log`, `native-python-final-20260908.log` y `root-python-20260908-final.log` están bajo `artifacts/visual-upgrade/`. No se suman otra vez las pruebas históricas de la alfa 0.1.0.

| Fase | Estado acreditado por esta revisión |
| --- | --- |
| Materiales del personaje guardados y reabiertos | Verificado |
| Importación de árbol/banco y bake completo de hitos | Verificado |
| Imágenes 1080p y CSV nativos de A | Verificado |
| Sectores cercanos de 100 m / lejanos de 500 m y modo offscreen | Verificados en B2/B4; el fallo inicial B se conserva |
| Tres peatones creados en una partida; recorrido completo de cada uno | Creación verificada; recorridos individuales pendientes |
| Caminata, coche, avance, freno y salida de B2 | Verificados por log y cuadros |
| Vista fija B4 con límite 60; salida nativa ordenada | Muestra y salida verificadas; 60 FPS sostenidos no demostrados |
| Empaquetado y ejecución del paquete 0.2 | **No verificados** |
| Descarga pública y despliegue del sitio para 0.2 | **No verificados** |

## Límite principal de fidelidad

Las alturas 20/30/20/30/25 m de los objetos OSM llamados «1»–«5» proceden de etiquetas actuales de la fuente, no de semillas del generador. Sin embargo, carecen de procedencia de medición; «4» declara 30 m y dos niveles. También existen otros casos dudosos, como «edif3», con 17 m y dos niveles. Se mantienen como conflictos por revisar; no se reemplazan por alturas inventadas.

El patrón repetido de ventanas sí procede de un atlas ficticio generado para el juego, aplicado a las paredes de edificios altos. Su apariencia no acredita las fachadas reales. Antes de sustituir esos bloques deben verificarse huellas, niveles, cubierta y frentes concretos con fuentes adecuadas. Mejorar dos hitos y añadir árboles no resuelve la identidad del resto de la ciudad.
