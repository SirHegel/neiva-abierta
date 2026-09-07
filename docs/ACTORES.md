# Personaje y automóvil detallados

`src/actors.js` carga modelos reales con `FBXLoader` y `GLTFLoader` desde `public/models/`. No usa CDN ni genera sustitutos de cubos o cápsulas. Si un modelo falla, la promesa de carga falla para que la interfaz pueda informar del error.

```js
import { loadActors } from './actors.js';
const actors = await loadActors();
const character = actors.makeCharacter();
const car = actors.makeCar('#bd9646');
scene.add(character, car);
// En cada fotograma: delta en segundos y velocidad del personaje en m/s.
actors.updateCharacter(character, delta, movingSpeed);
```

El origen de cada grupo está a nivel de los pies/ruedas, con Y hacia arriba y el frente hacia **+Z**. El personaje mide **1,8 m** en su pose de referencia. El coche mide **1,8 m de ancho × 4,2 m de largo**, con una altura resultante de **1,2607 m**. Los grupos externos conservan posiciones y rotaciones independientes para el controlador del juego.

## Personaje sin nombre

Se utiliza `Male_Adult_01` de **Microsoft Rocketbox**: adulto con polo, pantalón corto y zapatos, geometría facial y texturas de piel/ropa/cabello. Es un personaje de la biblioteca, no una representación de Jhon. El FBX contiene **81 huesos** y una malla de 7.440 triángulos; su esqueleto se duplica mediante `SkeletonUtils.clone` para que cada instancia pueda animarse por separado.

El mismo repositorio publica los clips `m_walk_neutral.max.fbx` y `m_idle_breathe_01.max.fbx`, de 1,0667 s y 2,7333 s. Se adaptan por nombres de huesos coincidentes: se mantienen las longitudes del personaje y la oscilación vertical de la cadera, se elimina el desplazamiento horizontal del hueso raíz y se mezclan caminar/respirar según la velocidad. No se sustituye la animación por movimientos de piezas primitivas.

Las texturas TGA originales se convirtieron a JPEG de calidad 94 para color/normales. El cabello conserva alfa en PNG y WebP sin pérdida; la web carga WebP y se conserva PNG para importadores nativos. Los materiales de la web usan las texturas originales con iluminación PBR y rugosidad configurada. Los mapas especulares originales convertidos se conservan como fuente adicional, pero no se reinterpretan como mapas de rugosidad.

**Licencia afirmativa:** MIT, copyright Microsoft 2020. La biblioteca indica explícitamente que los avatares se publican bajo MIT desde diciembre de 2020. [Repositorio oficial y condiciones](https://github.com/microsoft/Microsoft-Rocketbox), [licencia exacta](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/LICENSE.md). La copia local está en `public/models/character/LICENSE-ROCKETBOX.txt`.

## Automóvil

**Car Concept**, del repositorio oficial **Khronos glTF Sample Assets**, contiene carrocería curva, interior, asientos, volante, cristales, faros, llantas y frenos. El GLB tiene **97 mallas y 213.347 triángulos**, con materiales físicos, clearcoat, transmisión y texturas. `makeCar` mantiene compartidas las geometrías y texturas; cuando se solicita otro color, duplica únicamente los materiales de pintura que cambia.

El autor acreditado del modelo y sus texturas es **Eric Chadwick, Darmstadt Graphics Group GmbH, 2024**. La versión procede de un modelo inicial CC0 de Unity Fan adaptado por el autor acreditado. El GLB original se conserva sin modificaciones; el código normaliza su escala y permite cambiar la pintura en runtime.

**Licencia afirmativa:** CC-BY-4.0, con condiciones separadas para los logotipos/marcas que aparecen en el propio modelo. Se conservan las atribuciones y las condiciones específicas de Khronos. [Modelo y documentación oficial](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept), [licencia exacta](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/9429648735279342b4c32b8745f7904196607379/Models/CarConcept/LICENSE.md), [metadatos de autoría](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/9429648735279342b4c32b8745f7904196607379/Models/CarConcept/metadata.json).

Las instancias comparten recursos, pero cada coche sigue dibujando su geometría. No conviene crear tráfico masivo con este nivel de detalle. El entorno de reflexión debe configurarse en el renderizador principal para que la pintura y los cristales respondan a la iluminación; el módulo de actores no modifica la escena ni el renderer.

## Procedencia y comprobación

`public/models/sources.json` contiene fecha de descarga, URLs originales, commits fuente, tamaños y SHA-256 de archivos originales y derivados. `public/models/ATTRIBUTION.txt` reúne los créditos para distribuir junto al juego. La licencia MIT del código propio no reemplaza la licencia CC-BY del automóvil.

Se comprobó la carga local en Chrome/WebGL, se inspeccionaron capturas con el personaje detenido y caminando, y se verificó que los huesos se animan sin mover el grupo externo. También se comprobó que dos personajes conservan esqueletos independientes, que dos coches comparten geometría y que las dimensiones finales coinciden con el contrato. La prueba no produjo errores JavaScript. Estas comprobaciones no equivalen a pruebas de Unreal ni garantizan FPS en todos los teléfonos.
