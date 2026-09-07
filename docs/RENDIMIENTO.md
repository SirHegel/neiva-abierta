# Rendimiento de la edición web 0.4

La edición 0.4 reduce el trabajo de renderizado y mantiene el tiempo de movimiento aunque baje la frecuencia de imagen. **El Intel probado todavía no ofrece una experiencia a 30 o 60 FPS**. Los modelos detallados, materiales y sombras cercanos siguen presentes; la resolución de Auto puede bajar para ahorrar trabajo de GPU.

## Medición en el juego completo

Se midieron intervalos reales de `requestAnimationFrame`, CPU de la función de cuadro completa y CPU de `update`. No son tiempos de una llamada aislada a `renderer.render`. Chrome ejecutó WebGL 2 mediante `ANGLE (Intel, Mesa Intel(R) UHD Graphics (ADL-S GT0.5), OpenGL ES 3.2)`, en modo headless con GPU, viewport de 1440 × 960. No se utilizó SwiftShader ni `gl.finish`.

Cada caso guarda todas sus muestras en JSON. La escena se calentó antes de medir diez segundos: 1,2 s en la primera captura 0.3 y 6,5 s en la captura final 0.4, para que Auto estabilizara su resolución. Esto y la carga de otras aplicaciones impiden atribuir cada diferencia de FPS únicamente al código.

| Caso | 0.3: FPS observados | 0.4: FPS observados | CPU/cuadro 0.3 → 0.4 | Draws/cuadro 0.3 → 0.4 |
| --- | ---: | ---: | ---: | ---: |
| Después de lluvia, quieto | 17,54 | 18,07 | 21,56 → 10,21 ms | 808 → 236 |
| Después de lluvia, caminando | 17,43 | 15,35 | 22,72 → 12,59 ms | 805 → 422 |
| Despejado, quieto | 16,53 | 18,57 | 19,47 → 9,92 ms | 571 → 227 |

En Auto, 0.3 dibujaba con DPR 1 y 0.4 terminó en DPR 0,7: **1008 × 672 píxeles internos**, escalados al mismo viewport. Los tiempos CPU se redujeron; los FPS no mejoraron en todos los casos. En la caminata 0.4 se recorrieron 20,0667 m durante 10,033 s de simulación, a 2 m/s, aunque sólo se presentaron unas quince imágenes por segundo. El anterior límite de tiempo por cuadro hacía más lento el movimiento cuando caían los FPS.

Se conservó el punto inicial, la orientación y la entrada W de cada caso. La entrada se mantiene durante el calentamiento; las posiciones alcanzadas difieren entre versiones. La nueva conducción encontró una colisión cerca de `[-787, -119]` antes de terminar el caso. Sus 18,61 FPS **no representan una comparación de conducción continua**. Una prueba intermedia que conservaba la simulación anterior dio 12,08 → 16,42 FPS en conducción y redujo 1808 → 486 draws; es un diagnóstico del render anterior a integrar la nueva física, no el resultado final de conducción.

Archivos: [captura 0.3](../data/performance/performance-before.json), [render intermedio](../data/performance/performance-render-first.json), [captura final 0.4](../data/performance/performance-after.json). Incluyen hashes SHA-256 de los módulos usados para construir cada bundle temporal. Los assets públicos se mantuvieron; 0.4 además aplica las correcciones de cubiertas abiertas y la nueva simulación/mapa.

## Diagnóstico de GPU

Una prueba adyacente empleó `EXT_disjoint_timer_query_webgl2` alrededor del render dentro del bucle normal. Las consultas se leyeron después, sin bloquear con `gl.finish`; se descartaron muestras disjuntas. En el mismo ángulo quieto, el render intermedio obtuvo 44,60 ms GPU y 11,05 ms CPU por cuadro, frente a 91,63 ms GPU y 24,43 ms CPU del bundle 0.3. **Las resoluciones eran diferentes: DPR 0,7 y DPR 1**, respectivamente. Se conservaron los agregados, no las consultas individuales, en [el diagnóstico GPU](../data/performance/performance-gpu-diagnostic.json). Este resultado ayuda a localizar el límite de GPU; no equivale a un benchmark con idéntica resolución ni a un FPS prometido.

Se comprobó también desactivar `preserveDrawingBuffer`, manteniendo escena y DPR 0,7: el intervalo medio fue 56,735 ms en ambos casos; GPU 46,13 ms activado y 46,31 ms desactivado. No hubo beneficio medido y se conservó la configuración original. El antialiasing y las sombras no se desactivaron para inflar el resultado.

## Cambios concretos

- La ciudad se conserva completa en datos/memoria, pero las celdas lejanas dejan de enviarse a la GPU. Auto utiliza 480 m de alcance en escritorio y 350 m en móvil, con niebla antes del límite. Los detalles de fachadas se dibujan hasta 125 m y los emisores de sombras hasta 105 m; la selección usa la distancia al volumen real de cada celda.
- Los árboles cercanos conservan sus ramas curvas y todas las hojas fotográficas. Los lejanos usan la misma forma de tronco con menos segmentos y una selección de las mismas hojas, sin sustituirlos por bloques. Se agrupa el mobiliario por material y celda.
- Se calculan una vez las matrices del escenario estático. Personaje, huesos, ruedas, vehículos, luz y marcador siguen siendo dinámicos.
- Alta desactiva `alphaToCoverage` en el follaje porque su destino de postproceso no tiene MSAA; se eliminan los puntos blancos comprobados en la revisión visual. Auto conserva su cobertura del canvas multisample.
- Auto usa vidrio fino transparente con reflejos PBR e interior visible. Calidad alta restaura la transmisión física del coche, que necesita otro pase de la escena. AO sólo se activa en calidad alta.
- Los charcos reflejan geometría real cercana en un objetivo compartido: Auto usa 256 px en escritorio o 192 px en móvil; alta usa 512 px. Se actualizan hasta cuatro veces por segundo al mover la cámara y una vez por segundo si permanece quieta; alta en GPU dedicada puede alcanzar diez. Se omite la captura fuera del campo visual y se excluyen elementos distantes mediante límites precalculados.
- La luz se ancla a una cuadrícula de 2 m para reutilizar sombras cuando nada cercano se mueve. Con actores en movimiento las sombras se refrescan hasta 30 veces por segundo; no se elimina la sombra del personaje.
- Auto mide intervalos reales y baja su escala en pasos de 0,1 hasta 0,7 en escritorio o 0,65 en móvil. Sólo sube después de varias ventanas rápidas. Los menús a 15 FPS no se interpretan como una GPU lenta. Las calidades ligera y alta mantienen su resolución fija.
- La simulación avanza a pasos de 1/60 s y conserva el tiempo acumulado. El mapa usa tiles cacheados y consultas espaciales; una consulta local medida examinó 8 de 35.370 segmentos.

## Reproducir

Se necesita Node 24, las dependencias del proyecto y Chrome con acceso a la GPU. `CHROME_PATH` permite indicar otra ruta. El constructor exige un directorio de salida vacío y copia los assets para congelarlos.
El bundle de pruebas incluye accesos internos sólo para fijar posición/entrada y medir; **no debe publicarse**.

```sh
node scripts/performance-build.mjs /tmp/neiva-performance
python3 -m http.server 4175 --directory /tmp/neiva-performance
```

En otra terminal:

```sh
node scripts/performance-browser.mjs local http://localhost:4175
```

El resultado se escribe en `artifacts/performance-local.json`. Comprueba el campo `gpu`: una GPU de software o una GPU diferente hace la comparación inadecuada. Para comparar revisiones, prepara un bundle temporal independiente de cada revisión antes de editar y conserva también sus assets; no compares con una página que reconstruye código durante la prueba. No ejecutes dos navegadores de benchmark simultáneamente.

## Límites

Estos resultados proceden de un único equipo compartido y un recorrido corto. No miden teléfonos reales, todas las zonas de Neiva ni sesiones largas. La reducción de resolución puede suavizar letras y detalle fino. Las transiciones entre niveles de detalle son discretas. El suelo conserva la altimetría plana de esta versión y las fachadas no documentadas continúan siendo interpretaciones.

Unreal Engine no está instalado ni se ha compilado aquí. Su proyecto fuente y la integración opcional de datos 3D no convierten automáticamente la cartografía en fachadas reales ni garantizan mejor rendimiento. Una edición Unreal requiere herramientas del motor, pruebas propias y, para Pixel Streaming, un servidor con GPU; Vercel sirve esta edición web.
