# Hitos interpretados para Unreal

`neiva-landmarks.json` porta las mallas arquitectónicas originales ya existentes en `src/landmarks.js` y `src/civic-scene.js`: Catedral Inmaculada Concepción, ala baja del Palacio de Justicia, Hotel Neiva Plaza y Templo Colonial. Incluye el pavimento, mosaico de la fuente, agua plana, cobertizo y alcorques del espacio cívico. Son **modelos interpretados sobre huellas OSM**, no escaneos 3D, planos medidos ni una nueva verificación de fachadas.

La torre posterior del Palacio no se añade: la capa actual conserva `noGeometry:true`. La aguja de la Catedral conserva la altura total de 33 m del modelo más su desplazamiento de suelo de 0,035 m; la etiqueta OSM no se convierte en una medida certificada.

Regeneración desde la raíz del repositorio, sin navegador, WebGL ni red:

```sh
node scripts/export-unreal-landmarks.mjs
node --test tests/unreal-landmarks.test.mjs
```

El archivo contiene 45 secciones de malla, 177.774 vértices y 110.618 triángulos. La exportación combina vértices solamente cuando coinciden posición, normal y UV; conserva los bordes duros. Sus datos dependen de los generadores, datos cartográficos y revisión citados mediante SHA-256 en `provenance.sources`. Las pruebas regeneran el archivo y exigen igualdad de bytes; una fecha de ejecución aleatoria o UUID no altera el resultado.

## Contrato nativo

- `schemaVersion:1`, `origin:[-75.2809,2.9252]`, `replacesBuildingIds[]`: omitir las extrusiones genéricas de esos cuatro edificios al usar estas mallas.
- `meshes[]` lleva `positions`, `normals`, `uv` e `indices` planos. Las transformaciones de grupo están **ya aplicadas**. Son coordenadas mundiales Three.js en metros: X este, Y arriba, Z sur. En el importador Unreal, `(X,Y,Z)=(x,-z,y)*100`; normales `(nx,-nz,ny)`, normalizadas, sin multiplicar por 100. No volver a colocar cada sección en el centro de su huella. Conservar/comprobar el orden de triángulos según la convención de caras del consumidor Unreal.
- `buildingId` identifica cada hito; `null` corresponde al espacio cívico. `models[]` incluye límites y número de triángulos para comprobar escala y colocación.
- `material` es `brick`, `plaster`, `roof`, `pavement`, `metal`, `glass`, `water` o `solid`. `color` está en **RGB lineal**, no sRGB. `roughness`, `metalness`, `opacity`, `doubleSided` y `normalScale` conservan los parámetros de cada sección. `solid` y los demás materiales con `textured:false` usan color/material nativo sin añadirles una textura de ladrillo arbitraria.
- Para materiales fotográficos, `maps` apunta a los JPG originales del catálogo `public/textures/manifest.json`, importados por separado. UV conserva metros de los generadores: dividir una vez por `uvTileMeters`, sin aplicar el factor 100 del espacio Unreal. Los normales de las texturas originales usan OpenGL y el mapa ARM contiene AO/Rugosidad/Metal en R/G/B, según el catálogo.
- `textLabels[]` conserva tres textos originales, tamaño, colores y matriz mundial en orden de columnas Three.js. Requiere un componente nativo de texto. Sus píxeles Canvas no se exportan y se omiten los planos de rótulo para evitar carteles vacíos. Una matriz de transformación no es una textura.

Se excluyen los chorros animados de tipo `Points` y los árboles, que pertenecen a otro módulo. El agua exportada es una superficie estática: no demuestra que las partículas o la animación estén implementadas en Unreal. Las pruebas de Node verifican el archivo y las transformaciones; no sustituyen compilar y ejecutar el consumidor con Unreal Engine.

## Procedencia

Las huellas y geometría derivada conservan ODbL y la atribución cartográfica del archivo. El código de modelado original pertenece al proyecto MIT. Las fotografías de referencia de terceros **no se exportan** ni se relicencian. Las texturas representativas Poly Haven son CC0 y están documentadas por separado; tampoco son fotografías de estas fachadas de Neiva. Las proporciones interpretadas y la cobertura se explican en `docs/FIDELIDAD.md` y en las referencias de `provenance`.
