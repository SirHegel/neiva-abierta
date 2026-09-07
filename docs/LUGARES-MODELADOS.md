# Catedral Inmaculada Concepción

`src/landmarks.js` construye un modelo arquitectónico original de la Catedral próxima al Parque Santander. Se consultó la fotografía publicada por la [Diócesis de Neiva en su ficha de la Catedral](https://diocesisdeneiva.org/directorio/parroquias/Inmaculada-Concepcion---Catedral). La imagen se usó como referencia visual; **no se copia al repositorio, no se aplica a una fachada y no se redistribuye**.

El modelo interpreta elementos visibles: fachada de ladrillo, torre central y campanario, aguja roja con cruz, reloj, portales, ventanas ojivales y contraventanas, gabletes, contrafuertes, pináculos, zócalo, escalinata y cornisas. La nave y los corredores laterales tienen cubiertas inclinadas con material fotográfico de teja. La parte posterior y los detalles ocultos en la fotografía son interpretaciones de volumen; no se presentan como documentación del edificio.

La implantación utiliza la huella OSM `way/313286677`. El primer segmento de esa huella es el frente que mira hacia el Parque Santander. La altura total toma la etiqueta OSM de 33 m. Esa etiqueta y la fotografía **no constituyen un levantamiento medido**: posiciones de ventanas, proporciones de cuerpos, interiores y detalles ornamentales no están verificados con planos. El modelo es un exterior interpretable dentro del juego, sin interior recorrible.

## Integración

```js
import { buildCathedral, CATHEDRAL_OSM_ID } from './landmarks.js';

const footprint = city.buildings.find((building) => building.id === CATHEDRAL_OSM_ID);
const cathedral = buildCathedral(scene, footprint, materials);
```

La función añade y devuelve un `THREE.Group`. El renderizador general debe omitir la extrusión genérica de ese ID para evitar superposición. Las colisiones pueden seguir usando la huella OSM. El grupo conserva `userData.osmId`, referencia primaria, advertencia de interpretación, número de piezas y número de mallas combinadas.

Ladrillo, zócalo, cornisas y tejas usan los PBR CC0 descritos en [MATERIALES.md](MATERIALES.md), con UV en metros. Agujas pintadas, puertas y vidrio usan materiales físicos; reloj, manecillas y ornamentación son geometría propia. Las ventanas del frente y de las paredes laterales bajas tienen aberturas reales en las mallas; no se simulan exclusivamente con cuadrados pintados.

Las piezas se combinan por material para reducir llamadas de dibujo. El modelo no crea un actor u objeto individual permanente por ladrillo, hoja o detalle. La malla final recibe y proyecta sombras. Puede retirarse como un solo grupo y sus geometrías pueden liberarse mediante `dispose()` sobre las mallas; las texturas PBR compartidas pertenecen al cargador de materiales.

La versión inicial combina 325 piezas en 11 mallas y 41.259 vértices. Se comprobó la geometría finita, la altura total de 33 m y su carga en Chrome/WebGL con mapas PBR y sombras, sin errores de recursos o JavaScript. Esa prueba funcional no verifica las proporciones contra un levantamiento arquitectónico.
